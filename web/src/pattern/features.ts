import { opSchema, type Op, type OpInput } from "./ops";

export interface Feature {
  id: string;
  request: string;
  ops: Op[];
  /** "generated" came from Gemini, "template" is a hand-written fallback. */
  source: "generated" | "template";
}

/**
 * Hand-written reference feature: a side zip. The side seam edges run from the armpit (start)
 * down to the hem (end), so the opening starts half way down and stops 14% above the hem.
 */
export function sideZipOps(): Op[] {
  const ops: OpInput[] = [
    { op: "openSeam", seam: "side", from: 0.5, length: 0.36 },
    {
      op: "addPiece",
      id: "zip.guard",
      name: "Side zip guard",
      shape: "rect",
      height: 4,
      attach: { seam: "side.zip", side: "a" },
      count: 2,
    },
  ];
  return ops.map((o) => opSchema.parse(o));
}

/**
 * Reference feature: a two-piece hood. One side panel, drawn in profile (face opening on the left, back on the right),
 * cut twice as left and right, sewn together along the centre seam and to the top of the collar.
 * The join edge is roughly the right size; the operation scales it to fit exactly.
 */
export function hoodOps(to: { panel: string; edge: string }[] = [{ panel: "collar", edge: "top" }]): Op[] {
  const ops: OpInput[] = [
    {
      op: "addShape",
      id: "hood",
      name: "Hood side",
      edges: [
        { id: "neck", pts: [[0, 36], [8, 37.5], [17, 37.5], [26, 36]] },
        { id: "centre", pts: [[26, 36], [30, 26], [31, 14], [27, 5], [19, 0.5], [11, 0], [5, 2]] },
        { id: "face", pts: [[5, 2], [1.5, 9], [0, 20], [0, 28], [0, 36]] },
      ],
      join: { edge: "neck", to },
      mirrorSeams: ["centre"],
      count: 2,
      mirror: true,
    },
  ];
  return ops.map((o) => opSchema.parse(o));
}

/** Description of the operations, used verbatim in the prompt for generation. */
export const OP_CATALOG = `Operations (JSON objects, applied in order):

openSeam   { "op": "openSeam", "seam": <seam id>, "from": 0-1, "length": 0-1 }
  Leaves part of a sewn seam open (for a zip, vent or placket). "from" and "length" are fractions of the seam length,
  measured from the START of the edge (see each edge's start and end in the garment description). Minimum opening 8 cm.
  Creates a new seam called "<seam id>.zip" for the opening and adds zip stop notches.

addSlit    { "op": "addSlit", "panel": <panel id>, "at": {"x": 0-1, "y": 0-1}, "length": cm, "angle": degrees, "id": <optional name> }
  Cuts an opening into the middle of a panel (welt pocket, zipped pocket). "at" is the centre of the opening as
  fractions of the panel's bounding box (0,0 top-left). It must stay at least 1 cm inside the panel's edge.

addPiece   { "op": "addPiece", "id": <new id>, "name": <label>, "shape": "rect"|"flap"|"bag", "width": cm, "height": cm,
             "attach": {"panel","edge"} | {"panel","mark"} | {"seam","side":"a"|"b"},
             "place": {"panel","x": 0-1,"y": 0-1}, "count": number, "fabric": "shell"|"contrast"|"lining" }
  Adds a new pattern piece (pocket, flap, bag, facing, zip guard). With "attach", the piece's top edge is sewn to that
  edge, mark or seam side and the piece takes exactly that width (do not set width). Without "attach", "width" is required.
  "place" draws an outline of where the piece sits on a panel; x and y are the top-left corner as fractions of the
  panel's bounding box. "count" is how many to cut in total.

addShape   { "op": "addShape", "id": <new id>, "name": <label>, "edges": [ {"id": <edge id>, "pts": [[x,y], ...], "fold": true? }, ... ],
             "join": {"edge": <one of the new edges>, "to": [{"panel","edge"}, ...]},
             "mirrorSeams": [<edge ids>], "count": number, "mirror": true|false, "fabric": "shell"|"contrast"|"lining" }
  Draws a NEW piece that none of the ready-made shapes can make (a hood, a yoke, a storm collar, a shaped facing).
  Only use it when addPiece cannot do the job. Units are cm, y points DOWN. Draw the finished outline as 3 to 6 named edges,
  each a list of [x, y] points, chained end to start; the last edge must end where the first begins. Use 4 to 12 points on
  curves so they look smooth. Draw the piece at a realistic size and shape, in profile or as it lies flat.
  "join" names the one edge that is sewn to the coat and the coat edges it is sewn to. The code scales the whole piece so that
  edge matches exactly, so get the SHAPE right and the join edge roughly the right length (within 40%).
  "mirrorSeams" lists edges that are sewn to their own mirror copy (such as the centre seam of a two-piece hood).
  A hood is sewn to the neckline: the "join" names the neckline edges listed in the garment description (the collar's top edge, or
  the neckband's bottom edge, or the front and back neck edges together). The garment description says which fits this garment.

splitPanel { "op": "splitPanel", "panel": <panel id>, "axis": "horizontal"|"vertical", "at": 0.08-0.92, "fabric": "shell"|"contrast"|"lining" }
  Cuts one piece in two with a straight seam and sews the halves together again. Use it for yokes, panelling, colour-blocking
  and shaped hems. "at" is the position as a fraction of the piece's height (horizontal) or width (vertical), from the top or left.
  The pieces become "<panel>.upper" and "<panel>.lower" (horizontal) or "<panel>.left" and "<panel>.right" (vertical), and later
  operations must use those new ids. "fabric" applies to the lower or right piece only. The cut must cross the outline exactly
  twice and must not run through a pocket, opening or placement outline. Split the front and back at the same height for a
  matching design.

addNotch   { "op": "addNotch", "panel": <panel id>, "edge": <edge id>, "at": 0-1, "label": <optional> }
  Adds a matching mark on an edge.

offsetEdge { "op": "offsetEdge", "panel": <panel id>, "edge": <edge id>, "amount": cm }
  Moves an edge outward (positive) or inward (negative). Neighbouring edges stretch to follow. Moving an edge that is
  sewn to another one makes the seam mismatch unless the other side moves by the same amount.`;
