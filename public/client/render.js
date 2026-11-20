// Canvas renderer for the Falcon airship. Everything is drawn procedurally (no image files):
// a 3/4 top-down world with tall tiled walls, rich floors, ambient occlusion, animated props, lantern lighting,
// original characters, particles and fog of war.
import { MAP, WALKABLE } from "../shared/map.js";
import { COLORS } from "../shared/config.js";
import { isWalkable } from "../shared/geom.js";

const COLOR_HEX = Object.fromEntries(COLORS.map((c) => [c.id, c.hex]));
export const colorHex = (id) => COLOR_HEX[id] || "#888";
const INK = "#1d110a"; // outline colour
const WALL_H = 74;
const TAU = Math.PI * 2;

export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = f < 0 ? 0 : 255, p = Math.abs(f);
  r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
  return `rgb(${r},${g},${b})`;
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

export function star8(g, x, y, r, inner = 0.55) {
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8 - Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}

function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function fillStroke(g, fill, lw = 3, stroke = INK) { g.fillStyle = fill; g.fill(); g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
function shadowEllipse(g, x, y, w, h, a = 0.3) { g.fillStyle = `rgba(0,0,0,${a})`; g.beginPath(); g.ellipse(x, y, w, h, 0, 0, TAU); g.fill(); }

function pattern(g, w, h, draw) {
  const c = makeCanvas(w, h);
  draw(c.getContext("2d"), w, h);
  return g.createPattern(c, "repeat");
}

// ---------------------------------------------------------------- floors
const FLOORS = {
  carpet: [96, 96, (g, s) => {
    g.fillStyle = "#5e1620"; g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 2; g.strokeRect(0, 0, s, s);
    g.fillStyle = "#7d2230"; star8(g, s / 2, s / 2, s * 0.34); g.fill();
    g.strokeStyle = "#d9a648"; g.lineWidth = 2.5; star8(g, s / 2, s / 2, s * 0.34); g.stroke();
    g.fillStyle = "#1d5d55"; star8(g, s / 2, s / 2, s * 0.15); g.fill();
    g.fillStyle = "#e7c27a"; g.beginPath(); g.arc(s / 2, s / 2, 4, 0, TAU); g.fill();
    for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s]]) { g.fillStyle = "#d9a648"; g.beginPath(); g.arc(x, y, 9, 0, TAU); g.fill(); }
  }],
  terracotta: [56, 56, (g, s) => {
    g.fillStyle = "#8f4630"; g.fillRect(0, 0, s, s);
    const tile = (x, y, c) => { g.fillStyle = c; rr(g, x + 2, y + 2, s / 2 - 4, s / 2 - 4, 4); g.fill(); };
    tile(0, 0, "#b9603f"); tile(s / 2, s / 2, "#b9603f"); tile(s / 2, 0, "#a95538"); tile(0, s / 2, "#a95538");
    g.fillStyle = "#efd29a"; g.save(); g.translate(s / 2, s / 2); g.rotate(Math.PI / 4); g.fillRect(-5, -5, 10, 10); g.restore();
    g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(3, 3, s / 2 - 8, 4);
  }],
  night: [64, 64, (g, s) => {
    g.fillStyle = "#16203a"; g.fillRect(0, 0, s, s);
    g.fillStyle = "#1b2848"; rr(g, 3, 3, s - 6, s - 6, 6); g.fill();
    g.strokeStyle = "rgba(217,166,72,.35)"; g.lineWidth = 1.5; star8(g, s / 2, s / 2, s * 0.2); g.stroke();
    g.fillStyle = "rgba(255,255,255,.05)"; g.fillRect(6, 6, s - 12, 3);
  }],
  teal: [60, 60, (g, s) => {
    g.fillStyle = "#0f4c4f"; g.fillRect(0, 0, s, s);
    g.fillStyle = "#156268"; rr(g, 2, 2, s - 4, s - 4, 5); g.fill();
    g.fillStyle = "#e9f2ee"; star8(g, s / 2, s / 2, s * 0.22); g.fill();
    g.fillStyle = "#156268"; star8(g, s / 2, s / 2, s * 0.11); g.fill();
    g.fillStyle = "#d9a648"; for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s]]) { g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); }
  }],
  copper: [48, 48, (g, s) => {
    g.fillStyle = "#4e301f"; g.fillRect(0, 0, s, s);
    const gr = g.createLinearGradient(0, 0, s, s); gr.addColorStop(0, "#7a4b2e"); gr.addColorStop(1, "#5c3822");
    g.fillStyle = gr; rr(g, 2, 2, s - 4, s - 4, 3); g.fill();
    g.fillStyle = "#d39a5c"; for (const [x, y] of [[7, 7], [s - 7, 7], [7, s - 7], [s - 7, s - 7]]) { g.beginPath(); g.arc(x, y, 2.6, 0, TAU); g.fill(); }
  }],
  metal: [44, 44, (g, s) => {
    g.fillStyle = "#33353c"; g.fillRect(0, 0, s, s);
    g.fillStyle = "#3d4048"; rr(g, 2, 2, s - 4, s - 4, 3); g.fill();
    g.strokeStyle = "#2a2c32"; g.lineWidth = 3;
    for (let i = 6; i < s; i += 10) { g.beginPath(); g.moveTo(6, i); g.lineTo(s - 6, i); g.stroke(); }
    g.fillStyle = "rgba(255,255,255,.07)"; g.fillRect(4, 3, s - 8, 2);
  }],
  marble: [72, 72, (g, s) => {
    g.fillStyle = "#cfc8b8"; g.fillRect(0, 0, s, s);
    g.fillStyle = "#e3ddcf"; rr(g, 2, 2, s - 4, s - 4, 4); g.fill();
    g.strokeStyle = "rgba(120,110,90,.18)"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(8, 20); g.bezierCurveTo(30, 10, 40, 50, 66, 40); g.stroke();
    g.strokeStyle = "rgba(22,120,110,.55)"; g.lineWidth = 2; star8(g, s / 2, s / 2, s * 0.18); g.stroke();
  }],
  wood: [64, 32, (g, w, h) => { // parquet herringbone-ish
    g.fillStyle = "#5a3920"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? "#6e4628" : "#79502e";
      g.fillRect(i * 16 + 1, 1, 14, h - 2);
      g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(i * 16 + 1, h / 2, 14, 1);
    }
  }],
  planks: [96, 24, (g, w, h) => {
    g.fillStyle = "#6a4426"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#77502d"; g.fillRect(0, 1, w, h - 3);
    g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, h - 2, w, 2); g.fillRect(60, 0, 2, h);
    g.fillStyle = "rgba(255,230,180,.06)"; g.fillRect(0, 2, w, 2);
    g.fillStyle = "#2f1d10"; g.beginPath(); g.arc(8, h / 2, 1.6, 0, TAU); g.arc(54, h / 2, 1.6, 0, TAU); g.fill();
  }],
  cockpit: [56, 56, (g, s) => {
    g.fillStyle = "#101a2e"; g.fillRect(0, 0, s, s);
    g.fillStyle = "#14223c"; rr(g, 2, 2, s - 4, s - 4, 4); g.fill();
    g.strokeStyle = "rgba(90,200,220,.16)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
  }],
  hall: [88, 88, (g, s) => {
    for (let x = 0; x < s; x += 22) {
      g.fillStyle = x % 44 ? "#4f321e" : "#573722"; g.fillRect(x, 0, 22, s);
      g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x + 21, 0, 1, s);
      g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(x, (x * 3) % s, 22, 1);
    }
  }]
};

// ---------------------------------------------------------------- wall face (tall wall seen in 3/4 view)
function wallFacePattern(g) {
  return pattern(g, 120, WALL_H, (p, w, h) => {
    // plaster top band
    p.fillStyle = "#e9d6b0"; p.fillRect(0, 0, w, h);
    // gold crown
    p.fillStyle = "#c9973f"; p.fillRect(0, 0, w, 7);
    p.fillStyle = "#f1cf83"; p.fillRect(0, 1, w, 2);
    p.fillStyle = "#7a5520"; p.fillRect(0, 7, w, 2);
    // zellige band
    const zy = 12, zh = 30;
    p.fillStyle = "#0f4c4f"; p.fillRect(0, zy, w, zh);
    for (let x = 0; x < w; x += 30) {
      p.fillStyle = "#e9f2ee"; star8(p, x + 15, zy + zh / 2, 11); p.fill();
      p.fillStyle = (x / 30) % 2 ? "#c9973f" : "#1f7c7a"; star8(p, x + 15, zy + zh / 2, 6); p.fill();
      p.fillStyle = "#0b3436"; p.beginPath(); p.moveTo(x, zy); p.lineTo(x + 5, zy + zh / 2); p.lineTo(x, zy + zh); p.fill();
    }
    p.fillStyle = "#c9973f"; p.fillRect(0, zy + zh, w, 3);
    // carved wood dado
    const dy = zy + zh + 3;
    p.fillStyle = "#4a2a16"; p.fillRect(0, dy, w, h - dy);
    for (let x = 0; x < w; x += 40) {
      p.fillStyle = "#5c361d"; rr(p, x + 4, dy + 4, 32, h - dy - 9, 3); p.fill();
      p.strokeStyle = "rgba(233,190,110,.35)"; p.lineWidth = 1; p.beginPath();
      p.moveTo(x + 20, dy + 7); p.lineTo(x + 30, dy + (h - dy) / 2); p.lineTo(x + 20, h - 8); p.lineTo(x + 10, dy + (h - dy) / 2); p.closePath(); p.stroke();
    }
    p.fillStyle = "#2a170b"; p.fillRect(0, h - 4, w, 4);
  });
}

// ---------------------------------------------------------------- world build
const LIGHTS = []; // {x,y,r,color,flicker}
const ANIMS = []; // {x,y,r,draw(g,t)}

function walkGrid() {
  const C = 10, W = Math.ceil(MAP.width / C), H = Math.ceil(MAP.height / C);
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = isWalkable(x * C + 5, y * C + 5) ? 1 : 0;
  return { a, W, H, C, at: (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : a[y * W + x]) };
}

let WORLD = null;
function buildWorld() {
  if (WORLD) return WORLD;
  WORLD = buildWorldOnce();
  return WORLD;
}

function buildWorldOnce() {
  const W = MAP.width, H = MAP.height;
  const c = makeCanvas(W, H);
  const g = c.getContext("2d");
  const grid = walkGrid();

  // --- hull: gold rim, carved wooden skin, dark wall tops (taller at the top to hold the wall faces)
  const hull = (pad, fill, extraTop = WALL_H) => {
    g.fillStyle = fill;
    for (const r of WALKABLE) { rr(g, r.x - pad, r.y - pad - extraTop, r.w + pad * 2, r.h + pad * 2 + extraTop, pad + 8); g.fill(); }
  };
  g.save(); g.shadowColor = "rgba(0,0,0,.65)"; g.shadowBlur = 60; g.shadowOffsetY = 30; hull(54, "#9c7232"); g.restore();
  hull(54, "#c9973f");
  hull(50, "#f1cf83");
  hull(47, "#a77a35");
  const skin = pattern(g, 64, 64, (p, s) => {
    p.fillStyle = "#4b2b18"; p.fillRect(0, 0, s, s);
    p.fillStyle = "#56331d"; p.fillRect(0, 0, s, 30); p.fillStyle = "rgba(0,0,0,.4)"; p.fillRect(0, 30, s, 2); p.fillRect(0, 62, s, 2);
    p.fillStyle = "#d9a648"; p.beginPath(); p.arc(8, 16, 2.2, 0, TAU); p.arc(40, 48, 2.2, 0, TAU); p.fill();
  });
  hull(44, skin);
  hull(18, "#22140b");
  const inlay = pattern(g, 28, 28, (p, s) => {
    p.fillStyle = "#26170d"; p.fillRect(0, 0, s, s);
    p.strokeStyle = "rgba(217,166,72,.28)"; p.lineWidth = 1.2;
    p.beginPath(); p.moveTo(0, s / 2); p.lineTo(s / 2, 0); p.lineTo(s, s / 2); p.lineTo(s / 2, s); p.closePath(); p.stroke();
  });
  hull(14, inlay);

  // --- floors (on their own layer, then soft shadows near walls)
  const fl = makeCanvas(W, H);
  const f = fl.getContext("2d");
  const hallPat = pattern(f, FLOORS.hall[0], FLOORS.hall[1], FLOORS.hall[2]);
  for (const r of MAP.corridors) { f.fillStyle = hallPat; f.fillRect(r.x, r.y, r.w, r.h); }
  for (const r of MAP.rooms) {
    const [pw, ph, draw] = FLOORS[r.floor];
    f.fillStyle = pattern(f, pw, ph, draw);
    f.fillRect(r.x, r.y, r.w, r.h);
  }
  // ambient occlusion: blurred wall mask over the floor
  if ("filter" in f) {
    const m = makeCanvas(W, H), mg = m.getContext("2d");
    mg.fillStyle = "#000"; mg.fillRect(0, 0, W, H);
    mg.globalCompositeOperation = "destination-out";
    for (const r of WALKABLE) mg.fillRect(r.x, r.y, r.w, r.h);
    f.save();
    f.globalCompositeOperation = "source-atop";
    f.filter = "blur(16px)"; f.globalAlpha = 0.75; f.drawImage(m, 0, 10);
    f.filter = "blur(4px)"; f.globalAlpha = 0.5; f.drawImage(m, 0, 2);
    f.restore();
  }
  // corridor runner rugs
  for (const id of ["hallW", "hallE"]) {
    const r = MAP.corridors.find((x) => x.id === id);
    const y = r.y + r.h / 2 - 32;
    f.fillStyle = "rgba(0,0,0,.3)"; f.fillRect(r.x + 32, y + 6, r.w - 64, 68);
    f.fillStyle = "#7a1f2b"; f.fillRect(r.x + 30, y, r.w - 60, 64);
    f.strokeStyle = "#e7c27a"; f.lineWidth = 3; f.strokeRect(r.x + 37, y + 7, r.w - 74, 50);
    f.strokeStyle = "#1d5d55"; f.lineWidth = 2; f.strokeRect(r.x + 43, y + 13, r.w - 86, 38);
    for (let x = r.x + 80; x < r.x + r.w - 60; x += 76) { f.fillStyle = "#e7c27a"; star8(f, x, y + 32, 12); f.fill(); f.fillStyle = "#1d5d55"; star8(f, x, y + 32, 5); f.fill(); }
    for (let x = r.x + 30; x < r.x + r.w - 30; x += 8) { f.fillStyle = "#e9d6b0"; f.fillRect(x, y - 4, 3, 4); f.fillRect(x, y + 64, 3, 4); }
  }
  g.drawImage(fl, 0, 0);

  // --- tall wall faces above every top edge of walkable space
  const face = wallFacePattern(g);
  const segs = new Map();
  for (let cx = 0; cx < grid.W; cx++) {
    for (let cy = 1; cy < grid.H; cy++) {
      if (!grid.at(cx, cy) || grid.at(cx, cy - 1)) continue;
      let k = 0; while (k < 12 && !grid.at(cx, cy - 1 - k) && cy - 1 - k >= 0) k++;
      const h = Math.min(WALL_H, k * grid.C);
      const key = cy + ":" + h;
      const list = segs.get(key) || [];
      const last = list[list.length - 1];
      if (last && last[1] === cx) last[1] = cx + 1; else list.push([cx, cx + 1]);
      segs.set(key, list);
    }
  }
  const faceRuns = [];
  for (const [key, list] of segs) {
    const [cy, h] = key.split(":").map(Number);
    const ey = cy * grid.C;
    for (const [a, b] of list) {
      const x0 = a * grid.C, x1 = b * grid.C;
      faceRuns.push({ x0, x1, ey, h });
      g.save();
      g.beginPath(); g.rect(x0, ey - h, x1 - x0, h); g.clip();
      g.translate(0, ey - WALL_H);
      g.fillStyle = face; g.fillRect(x0, 0, x1 - x0, WALL_H);
      g.restore();
      g.fillStyle = INK; g.fillRect(x0, ey - h - 2, x1 - x0, 3);
      g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x0, ey, x1 - x0, 3);
    }
  }
  // Arched windows on the outer walls, lantern niches on inner walls.
  for (const run of faceRuns) {
    if (run.h < WALL_H || run.x1 - run.x0 < 120) continue;
    const outer = run.ey < 260;
    for (let x = Math.ceil((run.x0 + 60) / 200) * 200; x < run.x1 - 60; x += 200) {
      g.save(); g.translate(x, run.ey - 8);
      g.fillStyle = "#c9973f"; g.beginPath(); g.moveTo(-22, 0); g.lineTo(-22, -40); g.quadraticCurveTo(0, -66, 22, -40); g.lineTo(22, 0); g.closePath(); g.fill();
      g.lineWidth = 2.5; g.strokeStyle = INK; g.stroke();
      if (outer) {
        const sky = g.createLinearGradient(0, -60, 0, 0); sky.addColorStop(0, "#2a3f7a"); sky.addColorStop(1, "#7a5a8a");
        g.fillStyle = sky; g.beginPath(); g.moveTo(-17, -2); g.lineTo(-17, -39); g.quadraticCurveTo(0, -60, 17, -39); g.lineTo(17, -2); g.closePath(); g.fill();
        g.fillStyle = "#fff"; g.fillRect(-9, -44, 2, 2); g.fillRect(6, -36, 1.5, 1.5);
        g.strokeStyle = "#c9973f"; g.lineWidth = 1.6; g.beginPath();
        for (let k = -11; k <= 11; k += 7) { g.moveTo(k, -50); g.lineTo(k, -2); }
        g.moveTo(-17, -24); g.lineTo(17, -24); g.stroke();
        LIGHTS.push({ x, y: run.ey + 40, r: 150, color: "120,150,255", a: 0.12 });
      } else {
        g.fillStyle = "#2a170b"; g.beginPath(); g.moveTo(-17, -2); g.lineTo(-17, -39); g.quadraticCurveTo(0, -60, 17, -39); g.lineTo(17, -2); g.closePath(); g.fill();
        lanternShape(g, 0, -26, 0.9);
        LIGHTS.push({ x, y: run.ey + 6, r: 200, color: "255,190,100", a: 0.22, flicker: Math.random() * 10 });
        ANIMS.push({ x, y: run.ey - 34, r: 30, draw: (gg, t) => flame(gg, x, run.ey - 37, t, 0.8) });
      }
      g.restore();
    }
  }

  // Bottom-edge lips and outer portholes below the lowest rooms
  for (let cx = 0; cx < grid.W; cx++) for (let cy = 0; cy < grid.H - 1; cy++) {
    if (grid.at(cx, cy) && !grid.at(cx, cy + 1)) { g.fillStyle = "#c9973f"; g.fillRect(cx * 10, (cy + 1) * 10, 10, 3); g.fillStyle = INK; g.fillRect(cx * 10, (cy + 1) * 10 + 3, 10, 2); }
  }
  for (const r of MAP.rooms) {
    if (r.y + r.h < 1350) continue;
    for (let x = r.x + 60; x < r.x + r.w - 40; x += 110) porthole(g, x, r.y + r.h + 30);
  }

  drawDecor(g);

  // Vent grilles: carved mashrabiya hatches
  for (const v of MAP.vents) {
    g.save(); g.translate(v.x, v.y);
    shadowEllipse(g, 0, 4, 30, 20, 0.35);
    rr(g, -28, -19, 56, 38, 8); fillStroke(g, "#8a6430", 3);
    rr(g, -22, -14, 44, 28, 5); g.fillStyle = "#1a0f08"; g.fill();
    g.strokeStyle = "#c9973f"; g.lineWidth = 1.8;
    for (let k = -18; k <= 18; k += 9) { g.beginPath(); g.moveTo(k, -13); g.lineTo(k, 13); g.stroke(); }
    g.beginPath(); g.moveTo(-21, 0); g.lineTo(21, 0); g.stroke();
    g.restore();
  }
  // Task stations
  for (const t of MAP.tasks) station(g, t.x, t.y);
  // Sabotage repair panels
  for (const fx of Object.values(MAP.fixes)) {
    g.save(); g.translate(fx.x, fx.y);
    shadowEllipse(g, 0, 22, 22, 7);
    rr(g, -18, -24, 36, 46, 6); fillStroke(g, "#3a2a20", 3);
    rr(g, -12, -17, 24, 12, 3); fillStroke(g, "#c8642a", 2);
    rr(g, -12, -1, 24, 12, 3); fillStroke(g, "#c8642a", 2);
    g.restore();
  }
  // Security console
  {
    const s = MAP.console;
    g.save(); g.translate(s.x, s.y);
    shadowEllipse(g, 0, 22, 56, 10);
    rr(g, -54, -28, 108, 50, 9); fillStroke(g, "#1a2236", 3);
    g.restore();
    ANIMS.push({ x: s.x, y: s.y, r: 60, draw: (gg, t) => {
      for (let i = 0; i < 4; i++) {
        const x = s.x - 46 + i * 23, y = s.y - 21;
        gg.fillStyle = "#0c1830"; gg.fillRect(x, y, 19, 15);
        gg.fillStyle = `rgba(110,190,255,${0.5 + 0.25 * Math.sin(t * 5 + i * 2)})`; gg.fillRect(x + 2, y + 2, 15, 11);
        gg.fillStyle = "rgba(255,255,255,.25)"; gg.fillRect(x + 2, y + 2 + ((t * 20 + i * 5) % 11), 15, 1);
      }
      gg.fillStyle = Math.sin(t * 4) > 0 ? "#ff5050" : "#6a2020"; gg.beginPath(); gg.arc(s.x + 44, s.y + 10, 3, 0, TAU); gg.fill();
    } });
  }

  // Room names, inlaid in the floor
  g.textAlign = "center"; g.textBaseline = "middle";
  for (const r of MAP.rooms) {
    g.font = "700 30px 'Reem Kufi', 'Tajawal', sans-serif";
    g.fillStyle = "rgba(0,0,0,.25)"; g.fillText(r.name, r.x + r.w / 2 + 2, r.y + r.h - 30);
    g.fillStyle = "rgba(255,232,190,.2)"; g.fillText(r.name, r.x + r.w / 2, r.y + r.h - 32);
  }

  // Exterior propellers at the tail
  for (const py of [470, 1150]) ANIMS.push({ x: 70, y: py, r: 120, draw: (gg, t) => propeller(gg, 66, py, t) });
  return c;
}

function porthole(g, x, y) {
  g.beginPath(); g.arc(x, y, 15, 0, TAU); fillStroke(g, "#c9973f", 3);
  const sky = g.createLinearGradient(x, y - 11, x, y + 11); sky.addColorStop(0, "#3a5aa0"); sky.addColorStop(1, "#1a2650");
  g.beginPath(); g.arc(x, y, 10, 0, TAU); g.fillStyle = sky; g.fill();
  g.fillStyle = "rgba(255,255,255,.5)"; g.beginPath(); g.arc(x - 4, y - 4, 3, 0, TAU); g.fill();
}

function station(g, x, y) {
  g.save(); g.translate(x, y);
  shadowEllipse(g, 0, 18, 26, 8);
  rr(g, -24, -20, 48, 36, 8); fillStroke(g, "#2a1c12", 3);
  rr(g, -18, -14, 36, 15, 4); fillStroke(g, "#5fd4a9", 2);
  g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(-15, -12, 12, 3);
  g.fillStyle = "#e7c27a"; g.beginPath(); g.arc(-9, 8, 3, 0, TAU); g.arc(0, 8, 3, 0, TAU); g.arc(9, 8, 3, 0, TAU); g.fill();
  g.restore();
}

function lanternShape(g, x, y, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.strokeStyle = "#c9973f"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -18); g.lineTo(0, -12); g.stroke();
  g.beginPath(); g.moveTo(-9, -12); g.lineTo(9, -12); g.lineTo(6, -9); g.lineTo(-6, -9); g.closePath(); fillStroke(g, "#c9973f", 1.5);
  g.beginPath(); g.moveTo(-8, -9); g.lineTo(8, -9); g.lineTo(10, 4); g.lineTo(0, 12); g.lineTo(-10, 4); g.closePath(); fillStroke(g, "rgba(255,210,120,.55)", 1.8);
  g.strokeStyle = "#c9973f"; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, -9); g.lineTo(0, 12); g.moveTo(-9, -2); g.lineTo(9, -2); g.stroke();
  g.restore();
}

function flame(g, x, y, t, s = 1) {
  const k = 1 + Math.sin(t * 13 + x) * 0.12 + Math.sin(t * 7.3 + y) * 0.08;
  g.save(); g.translate(x, y); g.scale(s, s * k);
  g.fillStyle = "rgba(255,170,60,.9)"; g.beginPath(); g.moveTo(0, -9); g.quadraticCurveTo(6, 0, 0, 5); g.quadraticCurveTo(-6, 0, 0, -9); g.fill();
  g.fillStyle = "#fff4c8"; g.beginPath(); g.moveTo(0, -4); g.quadraticCurveTo(3, 1, 0, 4); g.quadraticCurveTo(-3, 1, 0, -4); g.fill();
  g.restore();
}

function propeller(g, x, y, t) {
  g.save(); g.translate(x, y);
  g.fillStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.ellipse(0, 0, 18, 96, 0, 0, TAU); g.fill();
  const a = t * 24;
  for (let i = 0; i < 3; i++) {
    const s = Math.sin(a + (i * TAU) / 3);
    g.fillStyle = "#c9973f"; g.strokeStyle = INK; g.lineWidth = 2;
    g.beginPath(); g.ellipse(0, s * 46, 10, Math.abs(Math.cos(a + (i * TAU) / 3)) * 30 + 8, 0, 0, TAU); g.fill(); g.stroke();
  }
  g.beginPath(); g.arc(0, 0, 13, 0, TAU); fillStroke(g, "#7a5520", 3);
  g.restore();
}

function rug(g, x, y, w, h, base, edge, mid = "#1d5d55") {
  shadowEllipse(g, x + w / 2, y + h / 2 + 6, w / 2, h / 2, 0.15);
  g.fillStyle = base; g.fillRect(x, y, w, h);
  g.strokeStyle = edge; g.lineWidth = 5; g.strokeRect(x + 9, y + 9, w - 18, h - 18);
  g.strokeStyle = mid; g.lineWidth = 3; g.strokeRect(x + 18, y + 18, w - 36, h - 36);
  g.lineWidth = 1.5; g.strokeStyle = edge; g.strokeRect(x + 24, y + 24, w - 48, h - 48);
  g.fillStyle = edge; star8(g, x + w / 2, y + h / 2, Math.min(w, h) * 0.24); g.fill();
  g.fillStyle = mid; star8(g, x + w / 2, y + h / 2, Math.min(w, h) * 0.15); g.fill();
  g.fillStyle = edge; star8(g, x + w / 2, y + h / 2, Math.min(w, h) * 0.05); g.fill();
  for (const [cx, cy] of [[x + 40, y + 40], [x + w - 40, y + 40], [x + 40, y + h - 40], [x + w - 40, y + h - 40]]) { g.fillStyle = edge; star8(g, cx, cy, 10); g.fill(); }
  for (let k = x + 4; k < x + w - 4; k += 7) { g.fillStyle = "#e9d6b0"; g.fillRect(k, y - 5, 3, 5); g.fillRect(k, y + h, 3, 5); }
}

function cushion(g, x, y, w, h, c) {
  rr(g, x, y + 5, w, h, 9); g.fillStyle = "rgba(0,0,0,.35)"; g.fill();
  rr(g, x, y, w, h, 9); fillStroke(g, c, 2.5);
  rr(g, x + 5, y + 5, w - 10, h - 10, 6); g.strokeStyle = "rgba(240,200,120,.75)"; g.lineWidth = 1.5; g.stroke();
  g.fillStyle = "rgba(255,255,255,.12)"; rr(g, x + 6, y + 4, w - 12, 5, 3); g.fill();
}

function crate(g, x, y, s) {
  shadowEllipse(g, x + s / 2, y + s + 2, s / 2, 6, 0.3);
  rr(g, x, y, s, s, 4); fillStroke(g, "#9a6b3c", 3);
  g.strokeStyle = "#5a3a1c"; g.lineWidth = 4; g.strokeRect(x + 5, y + 5, s - 10, s - 10);
  g.beginPath(); g.moveTo(x + 7, y + 7); g.lineTo(x + s - 7, y + s - 7); g.stroke();
  g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(x + 3, y + 3, s - 6, 3);
}

function dallah(g, x, y, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s);
  shadowEllipse(g, 0, 15, 13, 4);
  g.strokeStyle = INK; g.lineWidth = 2.2;
  g.fillStyle = "#e7c27a";
  g.beginPath(); g.ellipse(0, 6, 12, 9, 0, 0, TAU); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(-6, -1); g.lineTo(-4, -15); g.lineTo(4, -15); g.lineTo(6, -1); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(0, -22); g.lineTo(-6, -15); g.lineTo(6, -15); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = "#e7c27a"; g.lineWidth = 3.5; g.beginPath(); g.moveTo(10, 2); g.quadraticCurveTo(22, -6, 24, -16); g.stroke();
  g.fillStyle = "rgba(255,255,255,.5)"; g.beginPath(); g.ellipse(-4, 4, 3, 5, -0.4, 0, TAU); g.fill();
  g.restore();
}

function steam(g, x, y, t, k = 0) {
  for (let i = 0; i < 3; i++) {
    const p = ((t * 0.6 + i / 3 + k) % 1);
    g.fillStyle = `rgba(255,255,255,${0.25 * (1 - p)})`;
    g.beginPath(); g.arc(x + Math.sin(t * 2 + i * 2) * 5 * p, y - p * 34, 4 + p * 7, 0, TAU); g.fill();
  }
}

function drawDecor(g) {
  const R = Object.fromEntries(MAP.rooms.map((r) => [r.id, r]));
  const light = (x, y, r = 220, color = "255,190,100", a = 0.22) => {
    LIGHTS.push({ x, y, r, color, a, flicker: Math.random() * 10 });
  };
  const hanging = (x, y) => {
    lanternShape(g, x, y, 1.1);
    light(x, y + 10);
    ANIMS.push({ x, y, r: 30, draw: (gg, t) => flame(gg, x, y - 1, t, 0.9) });
  };

  // --- Majlis: floor seating, great rug, brass table with the emergency bell, incense burner
  {
    const r = R.majlis;
    rug(g, r.x + 70, r.y + 80, r.w - 140, r.h - 160, "#7a1f2b", "#e7c27a");
    for (let x = r.x + 18; x < r.x + r.w - 70; x += 78) {
      if (x + 70 > 1440 && x < 1560) continue;
      cushion(g, x, r.y + 12, 68, 36, "#8a2332"); cushion(g, x, r.y + r.h - 50, 68, 36, "#8a2332");
    }
    for (let y = r.y + 70; y < r.y + r.h - 80; y += 78) {
      if (y + 68 > 700 && y < 860) continue;
      cushion(g, r.x + 12, y, 36, 68, "#1d5d55"); cushion(g, r.x + r.w - 48, y, 36, 68, "#1d5d55");
    }
    const b = MAP.button;
    shadowEllipse(g, b.x, b.y + 16, 82, 56, 0.4);
    const tg = g.createRadialGradient(b.x - 24, b.y - 24, 8, b.x, b.y, 80);
    tg.addColorStop(0, "#fbe2a0"); tg.addColorStop(0.6, "#d4a24c"); tg.addColorStop(1, "#8a5d22");
    g.beginPath(); g.arc(b.x, b.y, 74, 0, TAU); fillStroke(g, tg, 4);
    g.strokeStyle = "#7a5520"; g.lineWidth = 3; star8(g, b.x, b.y, 62); g.stroke();
    g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 2; g.beginPath(); g.arc(b.x, b.y, 66, -2.6, -1.4); g.stroke();
    dallah(g, b.x - 48, b.y - 26, 0.95);
    for (const [dx, dy] of [[42, -38], [52, -16], [40, 36], [-30, 40]]) { g.beginPath(); g.ellipse(b.x + dx, b.y + dy, 7, 5, 0, 0, TAU); fillStroke(g, "#f6ecdc", 1.8); }
    // emergency bell (animated glint)
    ANIMS.push({ x: b.x, y: b.y, r: 40, draw: (gg, t) => bell(gg, b.x + 6, b.y + 2, t) });
    // incense burner
    const mx = 1300, my = 1000;
    ANIMS.push({ x: mx, y: my - 30, r: 50, draw: (gg, t) => { for (let i = 0; i < 4; i++) { const p = (t * 0.35 + i / 4) % 1; gg.fillStyle = `rgba(230,230,240,${0.22 * (1 - p)})`; gg.beginPath(); gg.arc(mx + Math.sin(t * 1.5 + i) * 10 * p, my - 20 - p * 60, 5 + p * 12, 0, TAU); gg.fill(); } } });
    for (const [x, y] of [[r.x + 40, r.y + 70], [r.x + r.w - 40, r.y + 70], [r.x + 40, r.y + r.h - 80], [r.x + r.w - 40, r.y + r.h - 80]]) hanging(x, y);
  }
  // --- Hospitality: counters, stove, coffee pots with steam, dates
  {
    const r = R.kitchen;
    rr(g, r.x + 10, r.y + 6, r.w - 20, 54, 6); fillStroke(g, "#5a361d", 3);
    g.fillStyle = "#e9d6b0"; g.fillRect(r.x + 12, r.y + 8, r.w - 24, 9);
    for (let x = r.x + 170; x < r.x + r.w - 150; x += 62) {
      dallah(g, x, r.y + 38, 1);
      const sx = x + 22;
      ANIMS.push({ x: sx, y: r.y + 10, r: 40, draw: (gg, t) => steam(gg, sx, r.y + 18, t, x * 0.01) });
    }
    rr(g, r.x + r.w - 124, r.y + 72, 96, 76, 8); fillStroke(g, "#2a2a2e", 3);
    for (const [dx, dy] of [[24, 20], [64, 20], [24, 54], [64, 54]]) {
      const fx = r.x + r.w - 124 + dx, fy = r.y + 72 + dy;
      g.strokeStyle = "#c8642a"; g.lineWidth = 3; g.beginPath(); g.arc(fx, fy, 11, 0, TAU); g.stroke();
      ANIMS.push({ x: fx, y: fy, r: 20, draw: (gg, t) => { for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; gg.fillStyle = `rgba(80,160,255,${0.55 + 0.3 * Math.sin(t * 20 + k)})`; gg.beginPath(); gg.arc(fx + Math.cos(a) * 8, fy + Math.sin(a) * 8, 2.5, 0, TAU); gg.fill(); } } });
    }
    rug(g, r.x + 120, r.y + 150, 230, 150, "#1d5d55", "#e7c27a", "#7a1f2b");
    g.beginPath(); g.arc(r.x + 235, r.y + 225, 36, 0, TAU); fillStroke(g, "#a87a35", 3);
    g.fillStyle = "#4a1f0e"; for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(r.x + 220 + (i % 3) * 14, r.y + 212 + Math.floor(i / 3) * 12, 6, 4, 0.5, 0, TAU); g.fill(); }
    hanging(r.x + 60, r.y + 100); hanging(r.x + r.w - 60, r.y + r.h - 70);
  }
  // --- Cockpit: wide front window with clouds rushing past, consoles, seats
  {
    const r = R.cockpit;
    const cx = r.x + r.w + 4, cy = r.y + r.h / 2, ex = 46, ey = r.h / 2 - 10;
    g.beginPath(); g.ellipse(cx, cy, ex + 8, ey + 8, 0, -Math.PI / 2, Math.PI / 2); fillStroke(g, "#c9973f", 3);
    ANIMS.push({ x: cx, y: cy, r: 200, draw: (gg, t) => {
      gg.save(); gg.beginPath(); gg.ellipse(cx, cy, ex, ey, 0, -Math.PI / 2, Math.PI / 2); gg.clip();
      const sky = gg.createLinearGradient(cx, cy - ey, cx, cy + ey); sky.addColorStop(0, "#2a3f7a"); sky.addColorStop(1, "#9a6a8a");
      gg.fillStyle = sky; gg.fillRect(cx - 4, cy - ey, ex + 8, ey * 2);
      for (let i = 0; i < 7; i++) { const yy = cy - ey + ((i * 53 + t * 140) % (ey * 2 + 40)) - 20; gg.fillStyle = "rgba(255,255,255,.35)"; gg.beginPath(); gg.ellipse(cx + 20 + (i % 3) * 8, yy, 14, 7, 0, 0, TAU); gg.fill(); }
      gg.restore();
      gg.strokeStyle = "#c9973f"; gg.lineWidth = 3; gg.beginPath(); gg.moveTo(cx, cy - ey); gg.lineTo(cx, cy + ey); gg.moveTo(cx, cy); gg.lineTo(cx + ex, cy); gg.stroke();
    } });
    rr(g, r.x + r.w - 96, r.y + 54, 64, r.h - 108, 12); fillStroke(g, "#1c2a44", 3);
    ANIMS.push({ x: r.x + r.w - 64, y: r.y + r.h / 2, r: 140, draw: (gg, t) => {
      for (let y = r.y + 74, i = 0; y < r.y + r.h - 66; y += 24, i++) {
        gg.fillStyle = i % 3 === 0 ? "#e6a817" : "#5fd4a9"; gg.globalAlpha = 0.55 + 0.45 * Math.sin(t * 3 + i);
        gg.fillRect(r.x + r.w - 86, y, 44, 8);
      }
      gg.globalAlpha = 1;
    } });
    for (const y of [r.y + 118, r.y + r.h - 118]) cushion(g, r.x + r.w - 168, y - 26, 52, 52, "#3f51b5");
    hanging(r.x + 60, r.y + r.h / 2);
  }
  // --- Comms: radio racks with blinking lights, radar screen
  {
    const r = R.comms;
    for (let i = 0; i < 4; i++) {
      rr(g, r.x + 18 + i * 72, r.y + 10, 60, 74, 5); fillStroke(g, "#222b3e", 3);
      const bx = r.x + 48 + i * 72, by = r.y + 54;
      g.beginPath(); g.arc(bx, by, 13, 0, TAU); fillStroke(g, "#33415e", 2);
      ANIMS.push({ x: bx, y: by, r: 40, draw: (gg, t) => {
        gg.strokeStyle = "#4fb3e8"; gg.lineWidth = 2; gg.beginPath(); gg.moveTo(bx, by); gg.lineTo(bx + Math.cos(t * 2 + i) * 11, by + Math.sin(t * 2 + i) * 11); gg.stroke();
        for (let k = 0; k < 3; k++) { gg.fillStyle = Math.sin(t * 6 + k * 2 + i) > 0.3 ? ["#ff5a5a", "#5fd4a9", "#e6a817"][k] : "#2a2a2a"; gg.fillRect(bx - 18 + k * 9, by - 36, 6, 6); }
      } });
    }
    const dx = r.x + r.w - 90, dy = r.y + r.h - 100;
    g.beginPath(); g.arc(dx, dy, 52, 0, TAU); fillStroke(g, "#0d2a24", 4);
    ANIMS.push({ x: dx, y: dy, r: 60, draw: (gg, t) => {
      gg.strokeStyle = "rgba(95,212,169,.4)"; gg.lineWidth = 1.5;
      for (const k of [16, 32, 48]) { gg.beginPath(); gg.arc(dx, dy, k, 0, TAU); gg.stroke(); }
      const a = t * 2;
      const sw = gg.createConicGradient ? gg.createConicGradient(a - 0.9, dx, dy) : null;
      if (sw) { sw.addColorStop(0, "rgba(95,212,169,0)"); sw.addColorStop(0.14, "rgba(95,212,169,.45)"); sw.addColorStop(0.15, "rgba(95,212,169,0)"); gg.fillStyle = sw; gg.beginPath(); gg.arc(dx, dy, 48, 0, TAU); gg.fill(); }
      gg.fillStyle = "#5fd4a9"; gg.beginPath(); gg.arc(dx + 20, dy - 14, 3 * (0.5 + 0.5 * Math.sin(t * 3)), 0, TAU); gg.fill();
    } });
    hanging(r.x + r.w / 2, r.y + r.h / 2);
  }
  // --- Generators: spinning copper rotors
  {
    const r = R.generator;
    for (let i = 0; i < 2; i++) {
      const cx = r.x + 150 + i * 150, cy = r.y + 170;
      shadowEllipse(g, cx, cy + 16, 62, 52, 0.4);
      const cg = g.createRadialGradient(cx - 20, cy - 20, 6, cx, cy, 58);
      cg.addColorStop(0, "#f6bd86"); cg.addColorStop(1, "#7a3e1c");
      g.beginPath(); g.arc(cx, cy, 56, 0, TAU); fillStroke(g, cg, 4);
      g.beginPath(); g.arc(cx, cy, 38, 0, TAU); fillStroke(g, "#3a1e0e", 3);
      ANIMS.push({ x: cx, y: cy, r: 60, draw: (gg, t) => {
        gg.save(); gg.translate(cx, cy); gg.rotate(t * (i ? -2.4 : 2.4));
        gg.fillStyle = "#e6a817"; star8(gg, 0, 0, 30, 0.45); gg.fill(); gg.strokeStyle = INK; gg.lineWidth = 2; gg.stroke();
        gg.restore();
        gg.fillStyle = `rgba(120,200,255,${0.4 + 0.4 * Math.sin(t * 9 + i)})`; gg.beginPath(); gg.arc(cx, cy, 7, 0, TAU); gg.fill();
      } });
      LIGHTS.push({ x: cx, y: cy, r: 160, color: "255,150,80", a: 0.12 });
    }
    g.strokeStyle = INK; g.lineWidth = 14; g.beginPath(); g.moveTo(r.x + 30, r.y + 300); g.lineTo(r.x + r.w - 30, r.y + 300); g.stroke();
    g.strokeStyle = "#b5703f"; g.lineWidth = 9; g.stroke();
    hanging(r.x + r.w / 2, r.y + 60);
  }
  // --- Security: monitor wall
  {
    const r = R.security;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const x = r.x + 150 + i * 58, y = r.y + 12 + j * 42;
      rr(g, x, y, 52, 36, 4); fillStroke(g, "#0e1424", 2.5);
      ANIMS.push({ x: x + 26, y: y + 18, r: 40, draw: (gg, t) => {
        gg.fillStyle = `rgba(90,170,240,${0.35 + 0.15 * Math.sin(t * 7 + i + j * 3)})`; gg.fillRect(x + 4, y + 4, 44, 28);
        gg.fillStyle = "rgba(255,255,255,.18)"; gg.fillRect(x + 4, y + 4 + ((t * 30 + i * 9) % 28), 44, 2);
      } });
    }
    cushion(g, r.x + 120, r.y + 180, 124, 42, "#3f51b5");
    hanging(r.x + 60, r.y + r.h - 80);
  }
  // --- Air room: two big ventilation fans and floating dust
  {
    const r = R.air;
    for (const fx of [r.x + 110, r.x + 290]) {
      const fy = r.y + 150;
      g.beginPath(); g.arc(fx, fy, 70, 0, TAU); fillStroke(g, "#203c3e", 4);
      g.beginPath(); g.arc(fx, fy, 62, 0, TAU); g.fillStyle = "#0b2526"; g.fill();
      ANIMS.push({ x: fx, y: fy, r: 75, draw: (gg, t) => {
        gg.save(); gg.translate(fx, fy); gg.rotate(t * 5);
        for (let k = 0; k < 5; k++) { gg.rotate(TAU / 5); gg.fillStyle = "#9fd8d0"; gg.beginPath(); gg.ellipse(30, 0, 28, 11, 0.5, 0, TAU); gg.fill(); gg.strokeStyle = INK; gg.lineWidth = 2; gg.stroke(); }
        gg.restore();
        gg.beginPath(); gg.arc(fx, fy, 12, 0, TAU); gg.fillStyle = "#c9973f"; gg.fill(); gg.strokeStyle = INK; gg.lineWidth = 2; gg.stroke();
        gg.strokeStyle = "rgba(201,151,63,.9)"; gg.lineWidth = 2; for (let k = -54; k <= 54; k += 18) { gg.beginPath(); gg.moveTo(fx + k, fy - Math.sqrt(62 * 62 - k * k)); gg.lineTo(fx + k, fy + Math.sqrt(62 * 62 - k * k)); gg.stroke(); }
      } });
    }
    ANIMS.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, r: 240, draw: (gg, t) => {
      for (let i = 0; i < 18; i++) { const p = (t * 0.07 + i * 0.137) % 1; gg.fillStyle = "rgba(220,255,250,.35)"; gg.beginPath(); gg.arc(r.x + ((i * 97) % r.w), r.y + r.h - p * r.h, 1.8, 0, TAU); gg.fill(); }
    } });
    LIGHTS.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, r: 260, color: "120,220,210", a: 0.12 });
  }
  // --- Engines: two turbines
  {
    const r = R.engines;
    for (let i = 0; i < 2; i++) {
      const cx = r.x + 130 + i * 190, cy = r.y + 190;
      shadowEllipse(g, cx, cy + 14, 84, 70, 0.4);
      g.beginPath(); g.arc(cx, cy, 80, 0, TAU); fillStroke(g, "#26272c", 4);
      g.beginPath(); g.arc(cx, cy, 72, 0, TAU); g.strokeStyle = "#c9973f"; g.lineWidth = 5; g.stroke();
      ANIMS.push({ x: cx, y: cy, r: 85, draw: (gg, t) => {
        gg.save(); gg.translate(cx, cy); gg.rotate(t * (i ? 7 : -7));
        for (let k = 0; k < 9; k++) { gg.rotate(TAU / 9); gg.fillStyle = "#5a5e6a"; gg.beginPath(); gg.ellipse(36, 0, 32, 9, 0.5, 0, TAU); gg.fill(); gg.strokeStyle = "#1a1b1f"; gg.lineWidth = 1.5; gg.stroke(); }
        gg.restore();
        gg.beginPath(); gg.arc(cx, cy, 15, 0, TAU); gg.fillStyle = "#e6a817"; gg.fill(); gg.strokeStyle = INK; gg.lineWidth = 2; gg.stroke();
      } });
      LIGHTS.push({ x: cx, y: cy, r: 170, color: "255,120,60", a: 0.1 });
    }
    hanging(r.x + r.w / 2, r.y + r.h - 70);
  }
  // --- Clinic: beds, crescent sign, heart monitor
  {
    const r = R.medbay;
    for (let i = 0; i < 2; i++) {
      rr(g, r.x + 30 + i * 150, r.y + 36, 112, 60, 10); fillStroke(g, "#f1ece0", 3);
      rr(g, r.x + 30 + i * 150, r.y + 36, 32, 60, 10); fillStroke(g, "#16a085", 2);
    }
    const cx = r.x + r.w / 2, cy = r.y + 165;
    g.beginPath(); g.arc(cx, cy, 26, 0, TAU); g.fillStyle = "#16a085"; g.fill();
    g.beginPath(); g.arc(cx + 10, cy - 6, 22, 0, TAU); g.fillStyle = "#e3ddcf"; g.fill();
    const sc = MAP.tasks.find((t) => t.id === "scan");
    ANIMS.push({ x: sc.x, y: sc.y, r: 60, draw: (gg, t) => { gg.strokeStyle = `rgba(95,212,169,${0.4 + 0.3 * Math.sin(t * 3)})`; gg.lineWidth = 3; gg.beginPath(); gg.arc(sc.x, sc.y, 46 + Math.sin(t * 3) * 3, 0, TAU); gg.stroke(); } });
    const mx = r.x + r.w - 70, my = r.y + 120;
    rr(g, mx - 30, my - 20, 60, 40, 5); fillStroke(g, "#0e1424", 3);
    ANIMS.push({ x: mx, y: my, r: 40, draw: (gg, t) => {
      gg.strokeStyle = "#5fd4a9"; gg.lineWidth = 2; gg.beginPath();
      for (let k = 0; k <= 50; k += 2) { const ph = (k / 50 + t * 0.8) % 1; const yy = ph > 0.45 && ph < 0.55 ? -12 * Math.sin((ph - 0.45) * 31.4) : 0; gg.lineTo(mx - 25 + k, my + yy); }
      gg.stroke();
    } });
    hanging(r.x + r.w / 2, r.y + r.h - 60);
  }
  // --- Library: shelves of books, reading rug, candles
  {
    const r = R.library;
    for (let i = 0; i < 4; i++) {
      const x = r.x + 18 + i * 96;
      rr(g, x, r.y + 8, 86, 44, 4); fillStroke(g, "#4a2a16", 3);
      for (let k = 0; k < 9; k++) { g.fillStyle = ["#7a1f2b", "#1d5d55", "#c9973f", "#3f51b5", "#8e44ad"][(k + i) % 5]; g.fillRect(x + 5 + k * 9, r.y + 14 + (k % 3), 7, 32 - (k % 3)); }
    }
    rug(g, r.x + 100, r.y + 110, 200, 140, "#3f2a6e", "#e7c27a", "#7a1f2b");
    cushion(g, r.x + 160, r.y + 160, 80, 40, "#7a1f2b");
    for (const [x, y] of [[r.x + 60, r.y + 120], [r.x + r.w - 60, r.y + 120]]) {
      rr(g, x - 6, y - 4, 12, 22, 3); fillStroke(g, "#f1ece0", 2);
      ANIMS.push({ x, y, r: 20, draw: (gg, t) => flame(gg, x, y - 8, t, 0.7) });
      light(x, y, 160);
    }
    ANIMS.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, r: 220, draw: (gg, t) => {
      for (let i = 0; i < 14; i++) { const p = (t * 0.05 + i * 0.173) % 1; gg.fillStyle = "rgba(255,230,170,.35)"; gg.beginPath(); gg.arc(r.x + 30 + ((i * 113) % (r.w - 60)) + Math.sin(t + i) * 8, r.y + r.h - p * r.h, 1.5, 0, TAU); gg.fill(); }
    } });
    hanging(r.x + r.w / 2, r.y + r.h - 60);
  }
  // --- Storage: crates, sacks, rolled carpets
  {
    const r = R.storage;
    for (const [dx, dy, s] of [[30, 30, 60], [96, 30, 60], [30, 96, 60], [r.w - 112, 30, 78], [r.w - 194, 40, 66], [r.w - 104, 122, 62]]) crate(g, r.x + dx, r.y + dy, s);
    for (let i = 0; i < 4; i++) { rr(g, r.x + 40, r.y + 220 + i * 36, 176, 28, 14); fillStroke(g, ["#7a1f2b", "#1d5d55", "#3f51b5", "#c8642a"][i], 2.5); g.strokeStyle = "#e7c27a"; g.lineWidth = 1.5; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(r.x + 70 + k * 36, r.y + 222 + i * 36); g.lineTo(r.x + 70 + k * 36, r.y + 246 + i * 36); g.stroke(); } }
    for (const [x, y] of [[r.x + 300, r.y + 300], [r.x + 340, r.y + 320]]) { g.beginPath(); g.ellipse(x, y, 24, 30, 0, 0, TAU); fillStroke(g, "#c9a979", 2.5); }
    hanging(r.x + r.w / 2, r.y + r.h / 2);
  }
  // --- Fuel tank with a bubbling sight glass and a swinging needle
  {
    const r = R.fuel;
    const cx = r.x + r.w / 2, cy = r.y + 170;
    shadowEllipse(g, cx, cy + 20, 124, 70, 0.4);
    const fg = g.createLinearGradient(cx - 110, 0, cx + 110, 0);
    fg.addColorStop(0, "#5a5d66"); fg.addColorStop(0.35, "#b4bac6"); fg.addColorStop(1, "#3a3c44");
    rr(g, cx - 112, cy - 62, 224, 124, 62); fillStroke(g, fg, 4);
    g.strokeStyle = "#e6a817"; g.lineWidth = 5; g.beginPath(); g.moveTo(cx - 60, cy - 60); g.lineTo(cx - 60, cy + 60); g.moveTo(cx + 60, cy - 60); g.lineTo(cx + 60, cy + 60); g.stroke();
    rr(g, cx - 12, cy - 44, 24, 88, 10); fillStroke(g, "#22343a", 3);
    ANIMS.push({ x: cx, y: cy, r: 80, draw: (gg, t) => {
      gg.fillStyle = "#e6a817"; gg.fillRect(cx - 8, cy - 10, 16, 50);
      for (let i = 0; i < 5; i++) { const p = (t * 0.8 + i / 5) % 1; gg.fillStyle = "rgba(255,255,255,.6)"; gg.beginPath(); gg.arc(cx - 3 + (i % 2) * 6, cy + 38 - p * 46, 2, 0, TAU); gg.fill(); }
      const gx = cx + 90, gy = cy - 70;
      gg.beginPath(); gg.arc(gx, gy, 16, 0, TAU); gg.fillStyle = "#f1ece0"; gg.fill(); gg.strokeStyle = INK; gg.lineWidth = 2.5; gg.stroke();
      const a = -2.2 + 0.4 * Math.sin(t * 1.3) + 0.05 * Math.sin(t * 17);
      gg.strokeStyle = "#c0392b"; gg.lineWidth = 2; gg.beginPath(); gg.moveTo(gx, gy); gg.lineTo(gx + Math.cos(a) * 12, gy + Math.sin(a) * 12); gg.stroke();
    } });
    hanging(cx, r.y + r.h - 60);
  }
  // Hall lanterns
  for (let x = 560; x < 1240; x += 260) hanging(x, 735);
  for (let x = 1900; x < 2550; x += 260) hanging(x, 735);
  hanging(205, 600); hanging(205, 1050);
}

function bell(g, x, y, t) {
  const sw = Math.sin(t * 2) * 0.08;
  g.save(); g.translate(x, y - 18); g.rotate(sw);
  g.strokeStyle = INK; g.lineWidth = 2.5;
  g.fillStyle = "#c0392b"; g.beginPath(); g.ellipse(0, 22, 24, 9, 0, 0, TAU); g.fill(); g.stroke();
  const bg = g.createLinearGradient(-16, 0, 16, 0); bg.addColorStop(0, "#a8742a"); bg.addColorStop(0.4, "#fbe2a0"); bg.addColorStop(1, "#8a5d22");
  g.fillStyle = bg; g.beginPath(); g.moveTo(-15, 18); g.quadraticCurveTo(-15, -6, 0, -8); g.quadraticCurveTo(15, -6, 15, 18); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.arc(0, -10, 4, 0, TAU); g.fillStyle = "#e7c27a"; g.fill(); g.stroke();
  const glint = (t * 0.5) % 1;
  if (glint < 0.2) { g.fillStyle = `rgba(255,255,255,${1 - glint * 5})`; star8(g, -6, 0, 6, 0.3); g.fill(); }
  g.restore();
}

// ---------------------------------------------------------------- characters

/**
 * Original character: a round traveller in a thobe of the player's colour, gold-trimmed bisht, white ghutra and
 * black agal. o: { facing (-1..1, eased), walk (phase), moving, t (time), ghost, dead, scale, alpha }
 */
export function drawCharacter(g, x, y, colorId, o = {}) {
  const c = colorHex(colorId);
  const s = o.scale || 1;
  const face = o.facing ?? 1;
  const fs = Math.sign(face) || 1;
  const ph = o.walk || 0;
  const t = o.t || 0;
  const moving = !!o.moving;
  const bob = moving ? Math.abs(Math.sin(ph)) * 3.5 : Math.sin(t * 2.4) * 0.8;
  const breathe = moving ? 1 : 1 + Math.sin(t * 2.4) * 0.018;
  const tilt = moving ? Math.sin(ph) * 0.05 : 0;
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  if (o.alpha != null) g.globalAlpha *= o.alpha;
  if (o.ghost) { g.globalAlpha *= 0.55; g.translate(0, Math.sin(t * 2.2) * 4 - 6); }

  if (!o.ghost) {
    shadowEllipse(g, 0, 21, 21 - bob * 0.8, 6.5, 0.32);
    const step = moving ? Math.sin(ph) * 6 : 0;
    const lift = moving ? Math.max(0, Math.cos(ph)) * 3 : 0, lift2 = moving ? Math.max(0, -Math.cos(ph)) * 3 : 0;
    g.fillStyle = "#3a2416"; g.strokeStyle = INK; g.lineWidth = 2;
    g.beginPath(); g.ellipse((-7 + step) * Math.abs(face), 19 - lift, 6.5, 4, 0, 0, TAU); g.fill(); g.stroke();
    g.beginPath(); g.ellipse((7 - step) * Math.abs(face), 19 - lift2, 6.5, 4, 0, 0, TAU); g.fill(); g.stroke();
  }
  g.translate(0, -bob);
  g.rotate(tilt);
  g.scale(face, breathe);

  // back of ghutra (behind the body), sways with the walk
  const sway = moving ? Math.sin(ph + 1) * 4 : Math.sin(t * 1.5) * 1.2;
  g.fillStyle = "#e9e3d6"; g.strokeStyle = INK; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(-13, -26); g.quadraticCurveTo(-21 - sway, -6, -17 - sway, 4); g.lineTo(-7, -2); g.closePath(); g.fill(); g.stroke();

  // body (thobe) with cel shading
  const bodyPath = () => {
    g.beginPath();
    g.moveTo(-17, 17);
    g.bezierCurveTo(-21, 6, -18, -10, -10, -15);
    g.lineTo(10, -15);
    g.bezierCurveTo(18, -10, 21, 6, 17, 17);
    if (o.ghost) { for (let i = 0; i <= 6; i++) g.lineTo(17 - i * 34 / 6, 17 + (i % 2 ? 7 : 0) + Math.sin(t * 4 + i) * 2); }
    else g.quadraticCurveTo(0, 21, -17, 17);
    g.closePath();
  };
  bodyPath(); g.fillStyle = c; g.fill();
  g.save(); bodyPath(); g.clip();
  g.fillStyle = shade(c, -0.28); g.beginPath(); g.ellipse(14, 4, 12, 22, 0, 0, TAU); g.fill();
  g.fillStyle = shade(c, 0.28); g.beginPath(); g.ellipse(-10, -4, 4, 12, 0.2, 0, TAU); g.fill();
  g.fillStyle = shade(c, -0.4); g.fillRect(-20, 13, 40, 8);
  g.restore();
  bodyPath(); g.lineWidth = 2.6; g.strokeStyle = INK; g.stroke();
  // bisht trim
  g.strokeStyle = "#e7c27a"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(3, -14); g.quadraticCurveTo(5, 2, 4, 17); g.stroke();
  g.beginPath(); g.moveTo(-9, -14); g.quadraticCurveTo(-12, 2, -12, 16); g.stroke();
  // sleeves / arms swinging
  const arm = moving ? Math.sin(ph) * 5 : 0;
  g.fillStyle = shade(c, -0.12); g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.ellipse(15, -2 + arm, 5.5, 8, -0.3, 0, TAU); g.fill(); g.stroke();
  g.fillStyle = "#d9a679"; g.beginPath(); g.arc(16.5, 5 + arm, 3, 0, TAU); g.fill(); g.stroke();

  // head: face
  g.fillStyle = "#d9a679"; g.beginPath(); g.arc(2, -24, 11, 0, TAU); g.fill(); g.lineWidth = 2.2; g.stroke();
  g.fillStyle = "rgba(220,110,90,.35)"; g.beginPath(); g.arc(9, -19, 2.8, 0, TAU); g.fill();
  // eyes
  if (o.dead) {
    g.strokeStyle = INK; g.lineWidth = 1.8;
    for (const ex of [4, 10]) { g.beginPath(); g.moveTo(ex - 2.2, -26.5); g.lineTo(ex + 2.2, -22.5); g.moveTo(ex + 2.2, -26.5); g.lineTo(ex - 2.2, -22.5); g.stroke(); }
  } else {
    const blink = (t * 0.6 + (o.seed || 0)) % 4 < 0.08;
    for (const ex of [4.5, 10.5]) {
      if (blink) { g.strokeStyle = INK; g.lineWidth = 1.6; g.beginPath(); g.moveTo(ex - 2, -24); g.lineTo(ex + 2, -24); g.stroke(); continue; }
      g.fillStyle = "#fff"; g.beginPath(); g.ellipse(ex, -24.5, 2.4, 3, 0, 0, TAU); g.fill();
      g.fillStyle = INK; g.beginPath(); g.arc(ex + 0.8, -24.2, 1.5, 0, TAU); g.fill();
    }
    g.strokeStyle = INK; g.lineWidth = 1.4; g.beginPath(); g.moveTo(3, -29.5); g.lineTo(6.5, -30); g.moveTo(9, -30); g.lineTo(12.5, -29.5); g.stroke();
  }
  // ghutra on the head
  g.fillStyle = "#f7f3ea"; g.strokeStyle = INK; g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(-12, -20); g.quadraticCurveTo(-14, -38, 2, -39); g.quadraticCurveTo(15, -39, 14, -27);
  g.lineTo(10, -28.5); g.quadraticCurveTo(2, -32, -3, -26); g.quadraticCurveTo(-5, -16, -9, -10); g.quadraticCurveTo(-13, -14, -12, -20);
  g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = "rgba(160,150,130,.6)"; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(-7, -31); g.quadraticCurveTo(-9, -22, -8, -14); g.moveTo(-2, -34); g.quadraticCurveTo(-5, -28, -5, -22); g.stroke();
  // agal
  g.strokeStyle = INK; g.lineWidth = 3.4; g.beginPath(); g.ellipse(1.5, -34.5, 11.5, 3.4, -0.05, 0, TAU); g.stroke();
  g.strokeStyle = "#3a3a3a"; g.lineWidth = 1.2; g.beginPath(); g.ellipse(1.5, -35.2, 11.5, 3.2, -0.05, Math.PI, TAU); g.stroke();

  if (o.ghost) {
    g.strokeStyle = "rgba(241,208,138,.95)"; g.lineWidth = 2.4; g.beginPath(); g.ellipse(1.5, -48 + Math.sin(t * 3) * 1.5, 10, 3, 0, 0, TAU); g.stroke();
  }
  g.restore();
  void fs;
}

/** A knocked-out traveller lying on the floor (family friendly: no gore). */
export function drawBody(g, x, y, colorId, t = 0) {
  g.save(); g.translate(x, y);
  shadowEllipse(g, 0, 10, 36, 12, 0.35);
  g.rotate(-Math.PI / 2 + 0.08);
  drawCharacter(g, 0, 6, colorId, { dead: true, scale: 0.95, facing: 1 });
  g.restore();
  for (let i = 0; i < 3; i++) {
    const a = t * 3 + (i * TAU) / 3;
    g.fillStyle = "#ffd76a"; star8(g, x - 30 + Math.cos(a) * 13, y - 4 + Math.sin(a) * 5, 5, 0.4); g.fill();
  }
}

// ---------------------------------------------------------------- particles
export class Particles {
  constructor() { this.list = []; }
  add(p) { if (this.list.length < 400) this.list.push(p); }
  dust(x, y) { this.add({ x: x + (Math.random() - 0.5) * 10, y: y + 18, vx: (Math.random() - 0.5) * 20, vy: -8, life: 0, max: 0.5, size: 4, color: "220,200,170", a: 0.4, grow: 8 }); }
  puff(x, y, n = 14, color = "240,235,225") {
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = 40 + Math.random() * 90; this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life: 0, max: 0.7 + Math.random() * 0.4, size: 8, color, a: 0.7, grow: 18, drag: 3 }); }
  }
  sparkle(x, y, n = 18, color = "255,215,110") {
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = 60 + Math.random() * 120; this.add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 50, life: 0, max: 0.8 + Math.random() * 0.4, size: 4, color, a: 1, star: true, gravity: 120, drag: 1.5 }); }
  }
  update(dt) {
    for (const p of this.list) {
      p.life += dt;
      const d = p.drag ? Math.exp(-p.drag * dt) : 1;
      p.vx *= d; p.vy = p.vy * d + (p.gravity || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.life < p.max);
  }
  draw(g) {
    for (const p of this.list) {
      const k = p.life / p.max;
      g.fillStyle = `rgba(${p.color},${p.a * (1 - k)})`;
      if (p.star) { star8(g, p.x, p.y, p.size * (1 - k * 0.5), 0.4); g.fill(); }
      else { g.beginPath(); g.arc(p.x, p.y, p.size + (p.grow || 0) * k, 0, TAU); g.fill(); }
    }
  }
}

// ---------------------------------------------------------------- sky (also used by menus and the ejection scene)
export class Sky {
  constructor() {
    this.stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.3, p: Math.random() * 6 }));
    this.clouds = Array.from({ length: 12 }, (_, i) => ({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() * 1.3, v: 0.006 + Math.random() * 0.012, z: i % 3 }));
  }
  draw(g, W, H, t, camX = 0, dpr = 1, speed = 1) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#070c24"); sky.addColorStop(0.55, "#1b2152"); sky.addColorStop(0.85, "#4a2d55"); sky.addColorStop(1, "#8a4a4a");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (const s of this.stars) {
      g.globalAlpha = (0.45 + 0.55 * Math.sin(t * 2 + s.p)) * (1 - s.y * 0.7);
      g.fillStyle = "#fff";
      g.fillRect(((s.x * W - camX * 0.04) % W + W) % W, s.y * H * 0.8, s.r * dpr, s.r * dpr);
    }
    g.globalAlpha = 1;
    // crescent moon
    const mx = W * 0.82, my = H * 0.18, mr = Math.min(W, H) * 0.06;
    g.fillStyle = "rgba(255,240,200,.15)"; g.beginPath(); g.arc(mx, my, mr * 2.2, 0, TAU); g.fill();
    g.fillStyle = "#fff1c8"; g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
    g.fillStyle = "#101634"; g.beginPath(); g.arc(mx + mr * 0.45, my - mr * 0.2, mr * 0.9, 0, TAU); g.fill();
    for (const c of this.clouds) {
      const par = [0.08, 0.16, 0.3][c.z];
      const span = W * 1.6;
      const x = (((c.x + t * c.v * speed) * span - camX * par) % span + span) % span - W * 0.3;
      const y = c.y * H;
      g.globalAlpha = [0.1, 0.16, 0.22][c.z];
      g.fillStyle = "#c9d4ff";
      const k = c.s * dpr * (1 + c.z * 0.3);
      g.beginPath();
      g.ellipse(x, y, 120 * k, 30 * k, 0, 0, TAU);
      g.ellipse(x + 60 * k, y - 16 * k, 70 * k, 28 * k, 0, 0, TAU);
      g.ellipse(x - 50 * k, y - 8 * k, 60 * k, 22 * k, 0, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}

/** Side view of the Falcon airship for menus: an ornate envelope, gondola with lit arches and spinning propellers. */
export function drawAirship(g, x, y, s, t) {
  g.save(); g.translate(x, y + Math.sin(t * 1.1) * 6 * s); g.scale(s, s); g.rotate(Math.sin(t * 0.7) * 0.015);
  // envelope
  const env = g.createLinearGradient(0, -110, 0, 30);
  env.addColorStop(0, "#9c3a2a"); env.addColorStop(0.5, "#6e1f22"); env.addColorStop(1, "#3a0f12");
  g.beginPath(); g.ellipse(0, -40, 230, 78, 0, 0, TAU); g.fillStyle = env; g.fill(); g.lineWidth = 5; g.strokeStyle = INK; g.stroke();
  g.save(); g.beginPath(); g.ellipse(0, -40, 230, 78, 0, 0, TAU); g.clip();
  for (let k = -200; k <= 200; k += 50) { g.strokeStyle = "rgba(231,194,122,.85)"; g.lineWidth = 3; g.beginPath(); g.ellipse(k * 0.15, -40, Math.abs(230 - Math.abs(k) * 0.2) * Math.abs(Math.cos(k / 260)), 78, 0, -Math.PI / 2, Math.PI / 2); g.stroke(); }
  g.fillStyle = "#e7c27a"; g.fillRect(-240, -46, 480, 12);
  g.fillStyle = "#1d5d55"; g.fillRect(-240, -42, 480, 4);
  for (let k = -200; k <= 200; k += 40) { g.fillStyle = "#e7c27a"; star8(g, k, -78, 9); g.fill(); }
  g.fillStyle = "rgba(255,255,255,.12)"; g.beginPath(); g.ellipse(-40, -86, 150, 18, 0, 0, TAU); g.fill();
  g.restore();
  // falcon emblem
  g.save(); g.translate(30, -40);
  g.fillStyle = "#e7c27a"; g.strokeStyle = INK; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(0, -24); g.bezierCurveTo(14, -16, 40, -22, 56, -8); g.bezierCurveTo(36, -6, 22, 0, 10, 8); g.lineTo(14, 30); g.lineTo(0, 20); g.lineTo(-14, 30); g.lineTo(-10, 8); g.bezierCurveTo(-22, 0, -36, -6, -56, -8); g.bezierCurveTo(-40, -22, -14, -16, 0, -24); g.closePath(); g.fill(); g.stroke();
  g.restore();
  // fins
  g.fillStyle = "#c9973f"; g.strokeStyle = INK; g.lineWidth = 4;
  g.beginPath(); g.moveTo(-200, -70); g.lineTo(-268, -120); g.lineTo(-250, -40); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(-200, -10); g.lineTo(-268, 34); g.lineTo(-250, -40); g.closePath(); g.fill(); g.stroke();
  // rigging
  g.strokeStyle = "#c9973f"; g.lineWidth = 2;
  for (const k of [-110, -40, 40, 110]) { g.beginPath(); g.moveTo(k, 30); g.lineTo(k * 0.6, 62); g.stroke(); }
  // gondola
  rr(g, -120, 58, 240, 54, 22); g.fillStyle = "#5a331c"; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
  g.fillStyle = "#c9973f"; g.fillRect(-116, 62, 232, 6);
  for (let k = -96; k <= 96; k += 32) {
    g.fillStyle = `rgba(255,200,110,${0.75 + 0.25 * Math.sin(t * 3 + k)})`;
    g.beginPath(); g.moveTo(k - 9, 102); g.lineTo(k - 9, 82); g.quadraticCurveTo(k, 70, k + 9, 82); g.lineTo(k + 9, 102); g.closePath(); g.fill();
    g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
  }
  // propellers
  for (const px of [-140, 140]) {
    g.fillStyle = "#3a2416"; g.beginPath(); g.arc(px, 84, 9, 0, TAU); g.fill();
    const k = Math.abs(Math.sin(t * 30));
    g.fillStyle = "rgba(231,194,122,.85)"; g.beginPath(); g.ellipse(px + (px < 0 ? -6 : 6), 84, 4, 32 * k + 4, 0, 0, TAU); g.fill();
    g.fillStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.ellipse(px + (px < 0 ? -6 : 6), 84, 6, 34, 0, 0, TAU); g.fill();
  }
  g.restore();
}

// ---------------------------------------------------------------- the renderer
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.map = buildWorld();
    this.fog = makeCanvas(4, 4);
    this.sky = new Sky();
    this.fx = new Particles();
    this.shake = 0;
    this.cam = { x: MAP.spawn.x, y: MAP.spawn.y };
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = innerWidth, h = innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.fog.width = this.canvas.width;
    this.fog.height = this.canvas.height;
    this.dpr = dpr;
    this.zoom = Math.max(0.7, Math.min(1.3, Math.min(w, h) / 660)) * dpr;
  }

  /** World point -> CSS pixel position on screen. */
  toScreen(x, y) {
    return { x: ((x - this.cam.x) * this.zoom) / this.dpr + innerWidth / 2, y: ((y - this.cam.y) * this.zoom) / this.dpr + innerHeight / 2 };
  }

  world(g, cam) {
    g.translate(this.canvas.width / 2, this.canvas.height / 2);
    g.scale(this.zoom, this.zoom);
    g.translate(-cam.x, -cam.y);
  }

  /**
   * f: { cam, t, dt, players:[{x,y,color,name,ghost,moving,walk,facing,self,vented,nameColor,alpha,seed}], bodies,
   *      vision ({x,y,r,poly}|null), visible(x,y), highlights:[{x,y,color}], doors:[{rect,k}], lightsOut, arrows:[angle] }
   */
  draw(f) {
    const g = this.g;
    const t = f.t;
    this.fx.update(f.dt || 0.016);
    this.shake = Math.max(0, this.shake - (f.dt || 0.016) * 3);
    const sh = this.shake * 10;
    const cam = { x: f.cam.x + (Math.random() - 0.5) * sh, y: f.cam.y + (Math.random() - 0.5) * sh };
    this.cam = cam;
    const W = this.canvas.width, H = this.canvas.height;
    this.sky.draw(g, W, H, t, cam.x, this.dpr, 3);

    g.save();
    this.world(g, cam);
    const vw = W / this.zoom / 2 + 120, vh = H / this.zoom / 2 + 160;
    const sx = Math.max(0, cam.x - vw), sy = Math.max(0, cam.y - vh);
    const sw = Math.min(MAP.width, cam.x + vw) - sx, shh = Math.min(MAP.height, cam.y + vh) - sy;
    if (sw > 0 && shh > 0) g.drawImage(this.map, sx, sy, sw, shh, sx, sy, sw, shh);
    for (const a of ANIMS) if (Math.abs(a.x - cam.x) < vw + a.r && Math.abs(a.y - cam.y) < vh + a.r) a.draw(g, t);

    // lantern and window light
    g.globalCompositeOperation = "lighter";
    for (const l of LIGHTS) {
      if (Math.abs(l.x - cam.x) > vw + l.r || Math.abs(l.y - cam.y) > vh + l.r) continue;
      const fl = l.flicker != null ? 0.85 + 0.15 * Math.sin(t * 9 + l.flicker) * Math.sin(t * 3.7 + l.flicker * 2) : 1;
      const a = (f.lightsOut ? 0.25 : 1) * l.a * fl;
      const lg = g.createRadialGradient(l.x, l.y, 4, l.x, l.y, l.r);
      lg.addColorStop(0, `rgba(${l.color},${a})`); lg.addColorStop(1, `rgba(${l.color},0)`);
      g.fillStyle = lg; g.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    g.globalCompositeOperation = "source-over";

    // doors: carved wooden halves sliding shut
    for (const d of f.doors) drawDoor(g, d.rect, d.k);

    // highlights: pulsing gold rings + a bobbing chevron over the station
    for (const h of f.highlights) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      g.strokeStyle = h.color; g.globalAlpha = 0.45 + pulse * 0.45; g.lineWidth = 4;
      g.beginPath(); g.arc(h.x, h.y, 32 + pulse * 6, 0, TAU); g.stroke();
      g.globalAlpha = 1;
      const by = h.y - 48 - Math.abs(Math.sin(t * 3)) * 8;
      g.fillStyle = h.color; g.strokeStyle = INK; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(h.x - 9, by - 8); g.lineTo(h.x + 9, by - 8); g.lineTo(h.x, by + 4); g.closePath(); g.fill(); g.stroke();
    }

    for (const b of f.bodies) if (f.visible(b.x, b.y)) drawBody(g, b.x, b.y, b.color, t);

    const shown = f.players.filter((p) => (p.self || f.visible(p.x, p.y)) && !(p.vented && !p.self)).sort((a, b) => a.y - b.y);
    for (const p of shown) drawCharacter(g, p.x, p.y, p.color, { ...p, t });
    this.fx.draw(g);
    g.restore();

    // fog of war
    if (f.vision) {
      const fg = this.fog.getContext("2d");
      fg.globalCompositeOperation = "source-over";
      fg.clearRect(0, 0, W, H);
      fg.fillStyle = f.lightsOut ? "rgba(3,2,10,.97)" : "rgba(8,6,18,.86)";
      fg.fillRect(0, 0, W, H);
      fg.globalCompositeOperation = "destination-out";
      const pts = f.vision.poly;
      const cx = (f.vision.x - cam.x) * this.zoom + W / 2, cy = (f.vision.y - cam.y) * this.zoom + H / 2;
      const r = f.vision.r * this.zoom;
      const grad = fg.createRadialGradient(cx, cy, r * 0.5, cx, cy, r);
      grad.addColorStop(0, "rgba(0,0,0,1)"); grad.addColorStop(0.75, "rgba(0,0,0,.85)"); grad.addColorStop(1, "rgba(0,0,0,0)");
      fg.fillStyle = grad;
      fg.beginPath();
      for (let i = 0; i < pts.length; i += 2) fg.lineTo((pts[i] - cam.x) * this.zoom + W / 2, (pts[i + 1] - cam.y) * this.zoom + H / 2);
      fg.closePath(); fg.fill();
      g.drawImage(this.fog, 0, 0);
    }
    // vignette
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.45)");
    g.fillStyle = vg; g.fillRect(0, 0, W, H);

    // names and arrows above the fog
    g.save();
    this.world(g, cam);
    g.textAlign = "center"; g.font = "800 15px Tajawal, sans-serif";
    for (const p of shown) {
      const ny = p.y - 54 - (p.ghost ? 8 : 0);
      g.globalAlpha = p.ghost ? 0.7 : 1;
      g.lineWidth = 4.5; g.strokeStyle = "rgba(0,0,0,.8)"; g.strokeText(p.name, p.x, ny);
      g.fillStyle = p.nameColor || "#fff"; g.fillText(p.name, p.x, ny);
    }
    g.globalAlpha = 1;
    g.restore();
    if (f.arrows && f.arrows.length) {
      const R = Math.min(W, H) * 0.36;
      for (const a of f.arrows) {
        const x = W / 2 + Math.cos(a.angle) * R, y = H / 2 + Math.sin(a.angle) * R;
        g.save(); g.translate(x, y); g.rotate(a.angle); g.scale(this.dpr, this.dpr);
        g.globalAlpha = 0.85;
        g.fillStyle = a.color; g.strokeStyle = INK; g.lineWidth = 2.5;
        g.beginPath(); g.moveTo(14, 0); g.lineTo(-8, -10); g.lineTo(-3, 0); g.lineTo(-8, 10); g.closePath(); g.fill(); g.stroke();
        g.restore();
      }
    }
  }

  /** Small top-down views for the security cameras. */
  drawCamera(canvas, cam, players, bodies, t) {
    const g = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height, z = w / 520;
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    g.save();
    g.translate(w / 2, h / 2); g.scale(z, z); g.translate(-cam.x, -cam.y);
    g.drawImage(this.map, 0, 0);
    for (const a of ANIMS) if (Math.abs(a.x - cam.x) < 300 && Math.abs(a.y - cam.y) < 220) a.draw(g, t);
    for (const b of bodies) drawBody(g, b.x, b.y, b.color, t);
    for (const p of players) if (!p.ghost && !p.vented) drawCharacter(g, p.x, p.y, p.color, { ...p, t });
    g.restore();
    g.fillStyle = "rgba(80,140,255,.1)"; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(0,0,0,.2)"; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  }

  /** Overview map with markers: [{x,y,color,r}] */
  drawOverview(canvas, markers, t = 0) {
    const W = MAP.width, H = MAP.height;
    const cw = canvas.clientWidth || 800;
    canvas.width = cw * this.dpr;
    canvas.height = ((cw * (H - 60)) / W) * this.dpr;
    const g = canvas.getContext("2d");
    const z = canvas.width / W;
    g.fillStyle = "#0b1026"; g.fillRect(0, 0, canvas.width, canvas.height);
    g.save(); g.translate(0, -60 * z);
    g.drawImage(this.map, 0, 0, canvas.width, H * z);
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `800 ${Math.max(11, Math.round(40 * z))}px Tajawal, sans-serif`;
    for (const r of MAP.rooms) {
      g.lineWidth = Math.max(3, 6 * z); g.strokeStyle = "rgba(0,0,0,.85)";
      g.strokeText(r.name, (r.x + r.w / 2) * z, (r.y + r.h / 2) * z);
      g.fillStyle = "#f1d08a"; g.fillText(r.name, (r.x + r.w / 2) * z, (r.y + r.h / 2) * z);
    }
    for (const m of markers) {
      const pulse = m.pulse ? 1 + 0.25 * Math.sin(t * 6) : 1;
      g.fillStyle = m.color; g.strokeStyle = INK; g.lineWidth = 2;
      g.beginPath(); g.arc(m.x * z, m.y * z, Math.max(4, (m.r || 14) * z * 1.6) * pulse, 0, TAU); g.fill(); g.stroke();
    }
    g.restore();
    return { z, offY: -60 * z };
  }
}

function drawDoor(g, d, k) {
  if (k <= 0) return;
  const horiz = d.w > d.h; // door spans horizontally (in a vertical passage)
  g.save();
  g.fillStyle = "rgba(0,0,0,.35)";
  if (horiz) {
    const half = (d.w / 2) * k;
    for (const [x0, dir] of [[d.x, 1], [d.x + d.w, -1]]) {
      const x = dir > 0 ? x0 : x0 - half;
      g.fillRect(x, d.y + 6, half, d.h);
      rr(g, x, d.y - 6, half, d.h + 8, 3); fillStroke(g, "#5c361d", 2.5);
      g.fillStyle = "#e7c27a"; for (let s = 8; s < half - 4; s += 14) { g.beginPath(); g.arc(x + s, d.y + d.h / 2 - 2, 2.2, 0, TAU); g.fill(); }
      g.fillStyle = "rgba(0,0,0,.35)";
    }
  } else {
    const half = (d.h / 2) * k;
    for (const [y0, dir] of [[d.y, 1], [d.y + d.h, -1]]) {
      const y = dir > 0 ? y0 : y0 - half;
      g.fillRect(d.x + 4, y + 6, d.w, half);
      rr(g, d.x - 4, y, d.w + 8, half, 3); fillStroke(g, "#5c361d", 2.5);
      g.fillStyle = "#e7c27a"; for (let s = 8; s < half - 4; s += 14) { g.beginPath(); g.arc(d.x + d.w / 2, y + s, 2.2, 0, TAU); g.fill(); }
      g.fillStyle = "rgba(0,0,0,.35)";
    }
  }
  g.restore();
}
