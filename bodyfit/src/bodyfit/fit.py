"""Fit Anny to a turn scan.

The phone stands still and the person turns. So every frame sees the same body
(one shape, one pose) under its own rigid transform: a yaw about the vertical
axis plus a translation. We optimise all of that jointly with ICP: each depth
point is pulled onto the nearest model triangle.

Adam does the coarse work (it copes with bad initial associations), L-BFGS
tightens it. Anny's shape space is low-dimensional and has near-equivalent
parameter combinations, so the parametric fit stalls ~1 mm from the surface;
real bodies aren't exactly in that space either. A final "detail" step adds a
smooth per-vertex displacement along the normals (Laplacian-regularised), which
is what the measurements are taken on.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

import numpy as np
import torch
from scipy.spatial import cKDTree

from .capture import Capture
from .model import PHENOTYPES, POSE_BONES, BodyModel, Shape, age_param
from .pointcloud import all_points
from .turn import estimate_yaws, vision_yaws


@dataclass
class Stage:
    iters: int  # Adam steps, or L-BFGS rounds (each with fresh point samples)
    lr: float
    sigma: float  # robust loss scale, metres
    max_dist: float  # ignore associations further than this
    shape: bool  # also optimise local measure changes + pose (phenotypes always on)
    lbfgs: bool = False


STAGES = (
    Stage(iters=80, lr=0.03, sigma=0.05, max_dist=0.30, shape=False),
    Stage(iters=200, lr=0.02, sigma=0.015, max_dist=0.08, shape=True),
    Stage(iters=6, lr=1.0, sigma=0.01, max_dist=0.03, shape=True, lbfgs=True),
)

# Vision's body orientation is good to roughly ±10°.
HINT_SIGMA = math.radians(10.0)
HINT_WEIGHT = 0.05
POSE_PRIOR = 1e-4
CHANGE_PRIOR = 1e-5
# Far from convergence, only trust matches to triangles that face the camera.
FACING_FILTER_ABOVE = 0.05


@dataclass
class DetailStage:
    iters: int = 150
    lr_mm: float = 0.3
    lr_rigid: float = 2e-4
    sigma_mm: float = 20.0
    max_dist_mm: float = 20.0
    smooth: float = 0.5  # weight on the squared Laplacian of the displacement
    shrink: float = 1e-4  # weight pulling unobserved regions back to the parametric surface
    points_per_frame: int = 800


DETAIL = DetailStage()


@dataclass
class FitResult:
    shape: Shape
    pose_rotvec: np.ndarray  # (len(POSE_BONES), 3)
    yaw: np.ndarray  # (N,) per used frame
    translation: np.ndarray  # (N,3)
    frames_used: list[int]
    rest_vertices: np.ndarray  # A-pose (with detail): for designing on
    posed_vertices: np.ndarray  # as scanned (with detail): measure on this
    displacement_mm: np.ndarray  # (V,) detail along the normals
    posed_joints: np.ndarray
    rest_joints: np.ndarray
    residual_mm: float  # median |point-to-surface| in the last iteration
    seconds: float
    log: list = field(default_factory=list)


def fit(
    capture: Capture,
    model: BodyModel | None = None,
    points_per_frame: int = 250,
    seed: int = 0,
    verbose: bool = False,
    stages: tuple[Stage, ...] = STAGES,
    detail: DetailStage | None = DETAIL,
    age_years: float | None = None,
    fixed_phenotypes: dict[str, float] | None = None,
    init: dict | None = None,
) -> FitResult:
    """Fit the body model to a capture.

    `age_years` (asked in the app) pins Anny's age parameter: without it, age,
    height and proportions trade off and the fit settles ~1 cm too big.
    `fixed_phenotypes` pins other phenotypes the same way. `init` (for tests) overrides start values: phenotypes,
    changes, pose_rotvec, yaw, translation.
    """
    t_start = time.time()
    model = model or BodyModel()
    torch.manual_seed(seed)
    fixed = dict(fixed_phenotypes or {})
    if age_years is not None:
        fixed["age"] = age_param(age_years)
    prob = _Problem(capture, model, points_per_frame, seed, fixed)
    p = prob.initial_params(init)

    log = []
    for si, st in enumerate(stages):
        groups = [{"params": [p["yaw"], p["trans"]], "lr": st.lr}, {"params": [p["ph"]], "lr": st.lr * 2}]
        if st.shape:
            groups += [{"params": [p["ch"]], "lr": st.lr * 2}, {"params": [p["pose"]], "lr": st.lr}]

        if st.lbfgs:
            flat = [t for g in groups for t in g["params"]]
            for it in range(st.iters):
                sample = prob.sample(points_per_frame * 2)
                opt = torch.optim.LBFGS(flat, lr=st.lr, max_iter=20, line_search_fn="strong_wolfe")

                def closure():
                    opt.zero_grad()
                    loss, _ = prob.loss(p, st, sample)
                    loss.backward()
                    return loss

                opt.step(closure)
                with torch.no_grad():
                    loss, res = prob.loss(p, st, sample)
                log.append({"stage": si, "iter": it, "loss": loss.item(), "residual_mm": res})
                if verbose:
                    print(f"stage {si} lbfgs {it} loss {loss.item():.5f} residual {res:.2f} mm")
            continue

        opt = torch.optim.Adam(groups)
        sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=st.iters, eta_min=st.lr * 0.1)
        for it in range(st.iters):
            opt.zero_grad()
            loss, res = prob.loss(p, st, prob.sample(points_per_frame))
            loss.backward()
            opt.step()
            sched.step()
            if it % 25 == 0 or it == st.iters - 1:
                log.append({"stage": si, "iter": it, "loss": loss.item(), "residual_mm": res})
                if verbose:
                    print(f"stage {si} it {it:3d} loss {loss.item():.4f} residual {res:.2f} mm")

    with torch.no_grad():
        ph, ch = prob.phenotypes(p), torch.tanh(p["ch"])
        out = model.forward(ph, ch, p["pose"])
    posed, rest = out["vertices"][0], out["rest_vertices"][0]
    disp = torch.zeros(len(posed))
    if detail is not None and detail.iters > 0:
        disp, res = prob.refine_detail(posed, p, detail, verbose)
        log.append({"stage": "detail", "residual_mm": res})
    with torch.no_grad():
        posed = posed + 1e-3 * disp[:, None] * _vertex_normals(posed, prob.faces)
        rest = rest + 1e-3 * disp[:, None] * _vertex_normals(rest, prob.faces)
    return FitResult(
        shape=model.shape_from_tensors(ph, ch),
        pose_rotvec=p["pose"][0].detach().numpy(),
        yaw=p["yaw"].detach().numpy(),
        translation=p["trans"].detach().numpy(),
        frames_used=prob.keep,
        rest_vertices=rest.numpy(),
        posed_vertices=posed.numpy(),
        displacement_mm=disp.numpy(),
        posed_joints=out["joints"][0].numpy(),
        rest_joints=out["rest_joints"][0].numpy(),
        residual_mm=log[-1]["residual_mm"],
        seconds=time.time() - t_start,
        log=log,
    )


class _Problem:
    def __init__(self, capture: Capture, model: BodyModel, points_per_frame: int, seed: int,
                 fixed_phenotypes: dict[str, float] | None = None):
        self.model = model
        fixed = fixed_phenotypes or {}
        self.fixed_mask = torch.tensor([[k in fixed for k in PHENOTYPES]])
        self.fixed_values = torch.tensor([[fixed.get(k, 0.5) for k in PHENOTYPES]], dtype=torch.float32)
        self.rng = np.random.default_rng(seed)
        self.faces = torch.as_tensor(model.faces, dtype=torch.long)
        self.adj, self.adj_ok = _vertex_faces(model.faces)

        clouds = all_points(capture)
        self.keep = [i for i, c in enumerate(clouds) if len(c) >= 200]
        if len(self.keep) < 8:
            raise ValueError(f"only {len(self.keep)} usable frames")
        self.clouds = [torch.tensor(clouds[i], dtype=torch.float32) for i in self.keep]
        hints = [capture.frames[i].yaw_hint for i in self.keep]
        if all(h is not None for h in hints):
            yaws = np.unwrap(np.asarray(hints, dtype=np.float64))
        else:  # real scans: from Vision's body pose if the app sent it, else from depth alone
            body = self._average_body(fixed_phenotypes)
            kept = [clouds[i] for i in self.keep]
            yaws = vision_yaws(capture, kept, body, self.keep)
            if yaws is None:
                yaws = estimate_yaws(kept, body)
        self.have_hints = True
        self.yaw_hint = torch.tensor(yaws, dtype=torch.float32)

    def _average_body(self, fixed) -> np.ndarray:
        ph = torch.tensor([[(fixed or {}).get(k, 0.5) for k in PHENOTYPES]], dtype=torch.float32)
        with torch.no_grad():
            return self.model.forward(ph, torch.zeros(1, len(self.model.change_labels)))["vertices"][0].numpy()

    def initial_params(self, init: dict | None) -> dict[str, torch.Tensor]:
        n = len(self.clouds)
        centroids = torch.stack([c.mean(0) for c in self.clouds])
        # Visible points lie on the camera-facing side; the body centre is ~10 cm further away.
        trans = centroids + 0.10 * torch.nn.functional.normalize(centroids, dim=-1)
        p = {
            "ph": torch.zeros(1, 6),
            "ch": torch.zeros(1, len(self.model.change_labels)),
            "pose": torch.zeros(1, len(POSE_BONES), 3),
            "yaw": self.yaw_hint.clone(),
            "trans": trans,
        }
        with torch.no_grad():  # Anny's origin is near the pelvis, not at the mesh centre
            out = self.model.forward(self.phenotypes(p), torch.tanh(p["ch"]), p["pose"])
            p["trans"] -= out["vertices"][0].mean(0)
        if init:
            f32 = lambda x: torch.as_tensor(np.asarray(x), dtype=torch.float32)
            p["ph"] = torch.logit(f32(init["phenotypes"]).reshape(1, -1).clamp(1e-4, 1 - 1e-4))
            p["ch"] = torch.atanh(f32(init["changes"]).reshape(1, -1).clamp(-0.999, 0.999))
            p["pose"] = f32(init["pose_rotvec"]).reshape(1, -1, 3)
            p["yaw"] = f32(init["yaw"])[self.keep]
            p["trans"] = f32(init["translation"])[self.keep]
        assert p["yaw"].shape == (n,)
        return {k: v.clone().requires_grad_(True) for k, v in p.items()}

    def phenotypes(self, p) -> torch.Tensor:
        ph = torch.sigmoid(p["ph"])
        return torch.where(self.fixed_mask, self.fixed_values, ph)

    def sample(self, per_frame: int) -> torch.Tensor:
        """(N,S,3) random points from every frame."""
        return torch.stack([c[self.rng.integers(0, len(c), per_frame)] for c in self.clouds])

    def residuals(self, verts, p, p_w, max_dist, facing_filter):
        """Signed point-to-surface distances (metres) of usable points."""
        per_frame = p_w.shape[1]
        rot = _rot_z(p["yaw"])  # (N,3,3) body → world
        p_b = torch.einsum("nsk,nkj->nsj", p_w - p["trans"][:, None], rot).reshape(-1, 3)
        cam_b = torch.einsum("nk,nkj->nj", -p["trans"], rot).repeat_interleave(per_frame, 0)

        # Exact distance to the triangles around the nearest vertex.
        _, nn = cKDTree(verts.detach().numpy()).query(p_b.detach().numpy())
        tri = verts[self.faces[self.adj[nn]]]  # (M,K,3,3)
        signed, normal = _point_triangle(p_b[:, None], tri[..., 0, :], tri[..., 1, :], tri[..., 2, :])
        dist = torch.where(self.adj_ok[nn], signed.detach().abs(), torch.inf)
        best = dist.argmin(-1, keepdim=True)
        r = signed.gather(1, best)[:, 0]
        ok = r.detach().abs() < max_dist
        if facing_filter:
            n_best = normal.gather(1, best[..., None].expand(-1, 1, 3))[:, 0]
            ok &= ((cam_b - p_b) * n_best).sum(-1).detach() > 0
        return r[ok]

    def loss(self, p: dict, st: Stage, p_w: torch.Tensor) -> tuple[torch.Tensor, float]:
        out = self.model.forward(self.phenotypes(p), torch.tanh(p["ch"]), p["pose"])
        r = self.residuals(out["vertices"][0], p, p_w, st.max_dist, st.max_dist > FACING_FILTER_ABOVE)
        data = _robust(r, st.sigma).mean()

        yaw = p["yaw"]
        reg = CHANGE_PRIOR * p["ch"].pow(2).mean() + POSE_PRIOR * p["pose"].pow(2).mean()
        reg = reg + 1e-2 * (yaw[2:] - 2 * yaw[1:-1] + yaw[:-2]).pow(2).mean()
        reg = reg + (p["trans"][1:] - p["trans"][:-1]).pow(2).sum(-1).mean()
        if self.have_hints:  # side-on frames can otherwise slip into a wrong yaw
            reg = reg + HINT_WEIGHT * ((yaw - self.yaw_hint) / HINT_SIGMA).pow(2).mean()
        return data + reg, float(r.detach().abs().median()) * 1000

    def refine_detail(self, base, p, st: DetailStage, verbose=False) -> tuple[torch.Tensor, float]:
        """Per-vertex displacement (mm) along the normals of the parametric fit."""
        base = base.detach()
        normals = _vertex_normals(base, self.faces)
        lap = _laplacian(self.faces, len(base))
        # Frame transforms stay free: a slightly-too-big parametric body and frames
        # shifted away from the camera fit almost equally well, and only with the
        # displacement free can the optimiser slide out of that valley.
        rigid = {k: p[k].detach().clone().requires_grad_(True) for k in ("yaw", "trans")}
        disp = torch.zeros(len(base), requires_grad=True)
        opt = torch.optim.Adam([{"params": [disp], "lr": st.lr_mm},
                                {"params": list(rigid.values()), "lr": st.lr_rigid}])
        res = float("nan")
        for it in range(st.iters):
            opt.zero_grad()
            verts = base + 1e-3 * disp[:, None] * normals
            r_mm = 1e3 * self.residuals(verts, rigid, self.sample(st.points_per_frame), st.max_dist_mm * 1e-3, False)
            ld = torch.sparse.mm(lap, disp[:, None])[:, 0]
            loss = _robust(r_mm, st.sigma_mm).mean() + st.smooth * ld.pow(2).mean() + st.shrink * disp.pow(2).mean()
            loss.backward()
            opt.step()
            res = float(r_mm.detach().abs().median())
            if verbose and (it % 25 == 0 or it == st.iters - 1):
                print(f"detail it {it:3d} loss {loss.item():.5f} residual {res:.2f} mm, |disp| p95 "
                      f"{float(disp.detach().abs().quantile(0.95)):.1f} mm")
        with torch.no_grad():
            p["yaw"].copy_(rigid["yaw"])
            p["trans"].copy_(rigid["trans"])
        return disp.detach(), res


def _vertex_normals(vertices: torch.Tensor, faces: torch.Tensor) -> torch.Tensor:
    tri = vertices[faces]
    fn = torch.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0], dim=-1)
    vn = torch.zeros_like(vertices).index_add_(0, faces.reshape(-1), fn.repeat_interleave(3, dim=0))
    return torch.nn.functional.normalize(vn, dim=-1)


def _laplacian(faces: torch.Tensor, n: int) -> torch.Tensor:
    """Sparse uniform graph Laplacian: (L x)_i = x_i - mean of i's neighbours."""
    e = torch.cat([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    e = torch.unique(torch.cat([e, e.flip(1)]), dim=0)
    deg = torch.bincount(e[:, 0], minlength=n).float()
    w = -1.0 / deg[e[:, 0]]
    idx = torch.cat([e.T, torch.arange(n).repeat(2, 1)], dim=1)
    val = torch.cat([w, torch.ones(n)])
    return torch.sparse_coo_tensor(idx, val, (n, n)).coalesce()


def _rot_z(theta: torch.Tensor) -> torch.Tensor:
    c, s = torch.cos(theta), torch.sin(theta)
    z, o = torch.zeros_like(theta), torch.ones_like(theta)
    return torch.stack([c, -s, z, s, c, z, z, z, o], -1).reshape(*theta.shape, 3, 3)


def _robust(r: torch.Tensor, sigma: float) -> torch.Tensor:
    """Geman-McClure: quadratic near zero, flat for outliers."""
    r2 = r * r
    return r2 / (r2 + sigma * sigma)


def _vertex_faces(faces: np.ndarray) -> tuple[torch.Tensor, torch.Tensor]:
    """(V,K) indices of the faces around each vertex, padded, plus a validity mask."""
    lists = [[] for _ in range(faces.max() + 1)]
    for f, tri in enumerate(faces):
        for v in tri:
            lists[v].append(f)
    k = max(len(l) for l in lists)
    adj = np.zeros((len(lists), k), dtype=np.int64)
    ok = np.zeros((len(lists), k), dtype=bool)
    for v, l in enumerate(lists):
        adj[v, : len(l)] = l
        ok[v, : len(l)] = True
    return torch.from_numpy(adj), torch.from_numpy(ok)


def _point_triangle(p, a, b, c):
    """Signed distance from points to triangles (broadcast), and the unit face normals."""
    ab, ac, ap = b - a, c - a, p - a
    n = torch.nn.functional.normalize(torch.cross(ab, ac, dim=-1), dim=-1)
    d00, d01, d11 = (ab * ab).sum(-1), (ab * ac).sum(-1), (ac * ac).sum(-1)
    d20, d21 = (ap * ab).sum(-1), (ap * ac).sum(-1)
    denom = (d00 * d11 - d01 * d01).clamp_min(1e-12)
    v = (d11 * d20 - d01 * d21) / denom
    w = (d00 * d21 - d01 * d20) / denom
    inside = (v >= 0) & (w >= 0) & (v + w <= 1)
    plane = (ap * n).sum(-1)

    def seg(x, y):
        xy = y - x
        t = (((p - x) * xy).sum(-1) / (xy * xy).sum(-1).clamp_min(1e-12)).clamp(0, 1)
        return (p - x - t[..., None] * xy).norm(dim=-1)

    edge = torch.minimum(torch.minimum(seg(a, b), seg(b, c)), seg(c, a))
    dist = torch.where(inside, plane.abs(), edge)
    sign = torch.where(plane >= 0, 1.0, -1.0)
    return sign * dist, n
