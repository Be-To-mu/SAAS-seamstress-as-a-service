"use client";

import { useState } from "react";
import type { Layout, Placed } from "@/pattern/layout";
import type { Issue, Pt } from "@/pattern/types";

const path = (pts: Pt[], close = true) =>
  pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ") + (close ? " Z" : "");

function Arrow({ a, b }: { a: Pt; b: Pt }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const head = (p: Pt, s: number) =>
    `M${(p.x - s * (ux * 1.6 - uy * 0.7)).toFixed(2)} ${(p.y - s * (uy * 1.6 + ux * 0.7)).toFixed(2)} L${p.x.toFixed(2)} ${p.y.toFixed(2)} L${(p.x - s * (ux * 1.6 + uy * 0.7)).toFixed(2)} ${(p.y - s * (uy * 1.6 - ux * 0.7)).toFixed(2)}`;
  return (
    <g stroke="#475569" strokeWidth={0.12} fill="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <path d={head(a, -1)} />
      <path d={head(b, 1)} />
    </g>
  );
}

function PieceView({ item, tint, bad }: { item: Placed; tint: string; bad: boolean }) {
  const { panel, dx, dy } = item;
  const mv = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  const cx = (item.box.minX + item.box.maxX) / 2;
  // Small pieces get their label underneath so it does not sit on top of the grain line.
  const small = item.box.h < 14 || item.box.w < 16;
  const cy = small ? item.box.maxY + 3.2 : (item.box.minY + item.box.maxY) / 2;
  const fill = panel.fabric === "contrast" ? "#d9c9a8" : panel.fabric === "lining" ? "#e2e8f0" : tint;
  return (
    <g>
      <path d={path(item.cut)} fill="none" stroke="#94a3b8" strokeWidth={0.12} strokeDasharray="0.6 0.5" />
      <path d={path(item.sew)} fill={fill} fillOpacity={0.55} stroke={bad ? "#dc2626" : "#1e293b"} strokeWidth={bad ? 0.32 : 0.2} strokeLinejoin="round" />
      {panel.edges
        .filter((e) => e.kind === "fold")
        .map((e) => (
          <path key={e.id} d={path(e.pts.map(mv), false)} stroke="#2563eb" strokeWidth={0.45} fill="none" />
        ))}
      {panel.marks.map((m) => {
        const pts = m.pts.map(mv);
        if (m.kind === "button") return <circle key={m.id} cx={pts[0].x} cy={pts[0].y} r={0.9} fill="none" stroke="#1e293b" strokeWidth={0.15} />;
        if (m.kind === "notch") return <path key={m.id} d={path(pts, false)} stroke="#1e293b" strokeWidth={0.22} />;
        if (m.kind === "slit") return <path key={m.id} d={path(pts, false)} stroke="#be123c" strokeWidth={0.4} strokeLinecap="round" />;
        if (m.kind === "placement")
          return (
            <g key={m.id}>
              <path d={path(pts, false)} stroke="#0f766e" strokeWidth={0.15} strokeDasharray="0.8 0.5" fill="none" />
              {m.label && (
                <text x={(pts[0].x + pts[2].x) / 2} y={(pts[0].y + pts[2].y) / 2} fontSize={1.5} textAnchor="middle" fill="#0f766e">
                  {m.label}
                </text>
              )}
            </g>
          );
        return <path key={m.id} d={path(pts, false)} stroke="#64748b" strokeWidth={0.13} strokeDasharray="1 0.6" fill="none" />;
      })}
      {panel.grain.length === 2 && <Arrow a={mv(panel.grain[0])} b={mv(panel.grain[1])} />}
      <text x={cx} y={cy} fontSize={2.1} textAnchor="middle" fontWeight={600} fill="#0f172a" stroke="#fff" strokeWidth={0.6} paintOrder="stroke">
        {panel.name}
      </text>
      <text x={cx} y={cy + 2.6} fontSize={1.5} textAnchor="middle" fill="#334155" stroke="#fff" strokeWidth={0.5} paintOrder="stroke">
        cut {panel.cut.count}
        {panel.cut.onFold ? " on fold" : panel.cut.mirror ? " mirrored" : ""} · {panel.fabric}
      </text>
    </g>
  );
}

const ZOOMS = [1, 1.75, 2.5, 3.5];

export function PatternView({ layout, issues, tint }: { layout: Layout; issues: Issue[]; tint: string }) {
  const badPanels = new Set(issues.filter((i) => i.severity === "error" && i.panel).map((i) => i.panel));
  const [zoom, setZoom] = useState(0);
  const z = ZOOMS[zoom];
  return (
    <div className="patternbox">
      <div className="zoombar" aria-label="Zoom">
        <button type="button" className="ghost" onClick={() => setZoom((v) => Math.max(0, v - 1))} disabled={zoom === 0} aria-label="Zoom out">
          −
        </button>
        <span>{Math.round(z * 100)}%</span>
        <button type="button" className="ghost" onClick={() => setZoom((v) => Math.min(ZOOMS.length - 1, v + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in">
          +
        </button>
      </div>
      <div className="patternwrap">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="pattern"
          style={{ width: `${z * 100}%` }}
          role="img"
          aria-label="Sewing pattern pieces"
        >
          <rect x={0} y={0} width={layout.width} height={layout.height} fill="#ffffff" />
          {layout.placed.map((item) => (
            <PieceView key={item.panel.id} item={item} tint={tint} bad={badPanels.has(item.panel.id)} />
          ))}
          <g transform={`translate(${layout.width - 14} ${layout.height - 14})`}>
            <rect width={10} height={10} fill="none" stroke="#1e293b" strokeWidth={0.2} />
            <text x={5} y={5.5} fontSize={1.6} textAnchor="middle" fill="#1e293b">
              10 cm
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}
