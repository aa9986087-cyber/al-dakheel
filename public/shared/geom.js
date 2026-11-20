// Geometry shared by client prediction and server validation: walkability, sliding collision, line of sight, vision rays.
import { WALKABLE, MAP } from "./map.js";
import { PLAYER_R } from "./config.js";

const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** Door rectangles currently closed, from a list of room ids. */
export function closedDoorRects(closedRooms) {
  if (!closedRooms || !closedRooms.length) return [];
  return MAP.doors.filter((d) => closedRooms.includes(d.room));
}

// Walkability grid (8px cells), built once: 0 = wall, 1 = fully walkable, 2 = on an edge (checked exactly).
// It turns the hot path (vision rays, collision, line of sight) into one array read instead of ~45 rectangle tests.
const CELL = 8;
let GRID = null, GW = 0, GH = 0;
function buildGrid() {
  GW = Math.ceil(MAP.width / CELL) + 1;
  GH = Math.ceil(MAP.height / CELL) + 1;
  GRID = new Uint8Array(GW * GH);
  for (const r of WALKABLE) {
    const x0 = Math.floor(r.x / CELL), x1 = Math.floor((r.x + r.w) / CELL);
    const y0 = Math.floor(r.y / CELL), y1 = Math.floor((r.y + r.h) / CELL);
    for (let cy = Math.max(0, y0); cy <= Math.min(GH - 1, y1); cy++) {
      for (let cx = Math.max(0, x0); cx <= Math.min(GW - 1, x1); cx++) {
        const i = cy * GW + cx;
        const full = cx * CELL >= r.x && (cx + 1) * CELL <= r.x + r.w && cy * CELL >= r.y && (cy + 1) * CELL <= r.y + r.h;
        if (full) GRID[i] = 1;
        else if (GRID[i] === 0) GRID[i] = 2;
      }
    }
  }
}

function walkableStatic(x, y) {
  if (!GRID) buildGrid();
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return false;
  const v = GRID[cy * GW + cx];
  if (v !== 2) return v === 1;
  for (const r of WALKABLE) if (inRect(r, x, y)) return true;
  return false;
}

export function isWalkable(x, y, doors = []) {
  if (!walkableStatic(x, y)) return false;
  for (let i = 0; i < doors.length; i++) if (inRect(doors[i], x, y)) return false;
  return true;
}

const OFFS = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)]);

/** Can a body of radius r stand at (x, y)? */
export function canStand(x, y, doors = [], r = PLAYER_R) {
  if (!isWalkable(x, y, doors)) return false;
  for (const [ox, oy] of OFFS) if (!isWalkable(x + ox * r, y + oy * r, doors)) return false;
  return true;
}

/** Move with wall sliding. Returns the new position. */
export function moveWithCollision(x, y, dx, dy, doors = [], r = PLAYER_R) {
  // Already stuck (e.g. a door shut on top of us): let the player walk out freely.
  if (!canStand(x, y, doors, r)) {
    const nx = x + dx, ny = y + dy;
    return isWalkable(nx, ny) ? { x: nx, y: ny } : { x, y };
  }
  // Sub-step so fast moves cannot tunnel through thin walls.
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8));
  const sx = dx / steps, sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (canStand(x + sx, y + sy, doors, r)) { x += sx; y += sy; continue; }
    if (sx && canStand(x + sx, y, doors, r)) x += sx;
    else if (sy && canStand(x, y + sy, doors, r)) y += sy;
  }
  return { x, y };
}

/** Is the straight line between two points free of walls? */
export function lineClear(x1, y1, x2, y2, doors = [], step = 8) {
  const d = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.max(1, Math.ceil(d / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!isWalkable(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, doors)) return false;
  }
  return true;
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Visibility polygon: rays cast until they hit a wall or the vision radius. */
export function visionPolygon(x, y, radius, doors = [], rays = 120) {
  const pts = [];
  const step = 14;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const cx = Math.cos(a), cy = Math.sin(a);
    let lo = 0, hi = radius, hit = false;
    for (let d = step; d <= radius; d += step) {
      if (!isWalkable(x + cx * d, y + cy * d, doors)) { lo = d - step; hi = d; hit = true; break; }
    }
    if (hit) {
      for (let k = 0; k < 4; k++) {
        const m = (lo + hi) / 2;
        if (isWalkable(x + cx * m, y + cy * m, doors)) lo = m; else hi = m;
      }
      // Push slightly into the wall so wall faces are lit.
      hi = Math.min(radius, hi + 10);
    }
    pts.push(x + cx * hi, y + cy * hi);
  }
  return pts;
}

export function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
