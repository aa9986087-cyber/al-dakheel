// Canvas renderer: the Falcon airship drawn procedurally (no image assets), characters, lighting and fog of war.
import { MAP, WALKABLE } from "../shared/map.js";
import { COLORS } from "../shared/config.js";

const COLOR_HEX = Object.fromEntries(COLORS.map((c) => [c.id, c.hex]));
export const colorHex = (id) => COLOR_HEX[id] || "#888";

function shade(hex, f) {
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

function star8(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8 - Math.PI / 2;
    const rr = i % 2 ? r * 0.55 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function pattern(ctx, size, draw) {
  const c = makeCanvas(size, size);
  draw(c.getContext("2d"), size);
  return ctx.createPattern(c, "repeat");
}

const FLOORS = {
  carpet: (g, s) => {
    g.fillStyle = "#6e1b24"; g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(230,180,90,.55)"; g.lineWidth = 2;
    star8(g, s / 2, s / 2, s * 0.32); g.stroke();
    g.fillStyle = "rgba(20,60,70,.55)"; star8(g, s / 2, s / 2, s * 0.16); g.fill();
    g.fillStyle = "rgba(230,180,90,.35)";
    for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s]]) { g.beginPath(); g.arc(x, y, s * 0.12, 0, 7); g.fill(); }
  },
  terracotta: (g, s) => {
    g.fillStyle = "#a9583a"; g.fillRect(0, 0, s, s);
    g.fillStyle = "#b8664a"; g.fillRect(2, 2, s / 2 - 4, s / 2 - 4); g.fillRect(s / 2 + 2, s / 2 + 2, s / 2 - 4, s / 2 - 4);
    g.fillStyle = "#e9c890"; g.save(); g.translate(s / 2, s / 2); g.rotate(Math.PI / 4); g.fillRect(-4, -4, 8, 8); g.restore();
  },
  night: (g, s) => {
    g.fillStyle = "#18233a"; g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(212,162,76,.25)"; g.lineWidth = 1.5; g.strokeRect(0.5, 0.5, s - 1, s - 1);
    g.fillStyle = "rgba(212,162,76,.35)"; star8(g, s / 2, s / 2, s * 0.14); g.fill();
  },
  copper: (g, s) => {
    g.fillStyle = "#5b3a26"; g.fillRect(0, 0, s, s);
    g.fillStyle = "#6c4630"; g.fillRect(3, 3, s - 6, s - 6);
    g.fillStyle = "#c58a52"; for (const [x, y] of [[8, 8], [s - 8, 8], [8, s - 8], [s - 8, s - 8]]) { g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill(); }
  },
  metal: (g, s) => {
    g.fillStyle = "#3a3c42"; g.fillRect(0, 0, s, s);
    g.strokeStyle = "#2a2b30"; g.lineWidth = 3;
    for (let i = -s; i < s * 2; i += 12) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke(); }
    g.strokeStyle = "rgba(255,255,255,.06)"; g.strokeRect(1, 1, s - 2, s - 2);
  },
  marble: (g, s) => {
    g.fillStyle = "#d8d2c4"; g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(120,110,90,.25)"; g.lineWidth = 1; g.strokeRect(0.5, 0.5, s - 1, s - 1);
    g.strokeStyle = "rgba(40,120,110,.45)"; g.lineWidth = 2; star8(g, s / 2, s / 2, s * 0.2); g.stroke();
  },
  wood: (g, s) => {
    for (let y = 0; y < s; y += 16) {
      g.fillStyle = y % 32 ? "#6a4428" : "#734b2d"; g.fillRect(0, y, s, 16);
      g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(0, y + 15, s, 1);
      g.fillRect(((y * 37) % s), y, 1, 16);
    }
  },
  cockpit: (g, s) => {
    g.fillStyle = "#121a2e"; g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(90,180,200,.18)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
  },
  hall: (g, s) => {
    for (let x = 0; x < s; x += 20) {
      g.fillStyle = x % 40 ? "#5a3a22" : "#62402a"; g.fillRect(x, 0, 20, s);
      g.fillStyle = "rgba(0,0,0,.3)"; g.fillRect(x + 19, 0, 1, s);
    }
  }
};

const FLOOR_SIZE = { carpet: 80, terracotta: 48, night: 60, copper: 40, metal: 36, marble: 64, wood: 64, cockpit: 50, hall: 80 };

// Lanterns: warm light sources painted into the light pass.
const LANTERNS = [];

function buildMap() {
  const W = MAP.width, H = MAP.height;
  const c = makeCanvas(W, H);
  const g = c.getContext("2d");

  // Hull: a gold rim and dark carved-wood body around all walkable space.
  const hull = (pad, fill) => {
    g.fillStyle = fill;
    for (const r of WALKABLE) {
      g.beginPath();
      g.roundRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2, pad + 6);
      g.fill();
    }
  };
  g.save();
  g.shadowColor = "rgba(0,0,0,.7)"; g.shadowBlur = 40; g.shadowOffsetY = 18;
  hull(46, "#b98a3e");
  g.restore();
  hull(42, "#e2b866");
  hull(38, "#3a2416");
  // Carved inner band
  const band = pattern(g, 24, (p, s) => {
    p.fillStyle = "#3a2416"; p.fillRect(0, 0, s, s);
    p.strokeStyle = "rgba(212,162,76,.35)"; p.lineWidth = 1.2;
    p.beginPath(); p.moveTo(0, s / 2); p.lineTo(s / 2, 0); p.lineTo(s, s / 2); p.lineTo(s / 2, s); p.closePath(); p.stroke();
  });
  hull(30, band);
  hull(10, "#24160e");

  // Floors
  const hallPat = pattern(g, FLOOR_SIZE.hall, FLOORS.hall);
  for (const r of MAP.corridors) {
    g.fillStyle = hallPat; g.fillRect(r.x, r.y, r.w, r.h);
  }
  for (const r of MAP.rooms) {
    g.fillStyle = pattern(g, FLOOR_SIZE[r.floor], FLOORS[r.floor]);
    g.fillRect(r.x, r.y, r.w, r.h);
    // vignette
    const vg = g.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.2, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.4)");
    g.fillStyle = vg; g.fillRect(r.x, r.y, r.w, r.h);
  }
  // Long runner rugs down the halls
  for (const id of ["hallW", "hallE"]) {
    const r = MAP.corridors.find((x) => x.id === id);
    const y = r.y + r.h / 2 - 34;
    g.fillStyle = "#7a1f2b"; g.fillRect(r.x + 30, y, r.w - 60, 68);
    g.strokeStyle = "#d4a24c"; g.lineWidth = 3; g.strokeRect(r.x + 36, y + 6, r.w - 72, 56);
    g.fillStyle = "rgba(212,162,76,.6)";
    for (let x = r.x + 70; x < r.x + r.w - 50; x += 70) { star8(g, x, y + 34, 13); g.fill(); }
  }

  // Arched mashrabiya windows on the outer hull
  const windowsAt = (r, side) => {
    const n = Math.max(1, Math.floor(r.w / 110));
    for (let i = 0; i < n; i++) {
      const x = r.x + (r.w / n) * (i + 0.5);
      const y = side === "top" ? r.y - 26 : r.y + r.h + 26;
      g.save(); g.translate(x, y); if (side === "bottom") g.scale(1, -1);
      g.fillStyle = "#e2b866";
      g.beginPath(); g.moveTo(-17, 12); g.lineTo(-17, -4); g.quadraticCurveTo(0, -24, 17, -4); g.lineTo(17, 12); g.closePath(); g.fill();
      const sky = g.createLinearGradient(0, -20, 0, 12); sky.addColorStop(0, "#4a6fb5"); sky.addColorStop(1, "#1b2a55");
      g.fillStyle = sky;
      g.beginPath(); g.moveTo(-13, 10); g.lineTo(-13, -3); g.quadraticCurveTo(0, -19, 13, -3); g.lineTo(13, 10); g.closePath(); g.fill();
      g.strokeStyle = "rgba(226,184,102,.8)"; g.lineWidth = 1.2;
      g.beginPath(); for (let k = -9; k <= 9; k += 6) { g.moveTo(k, -12); g.lineTo(k, 10); } g.moveTo(-13, 0); g.lineTo(13, 0); g.stroke();
      g.restore();
    }
  };
  for (const id of ["generator", "security", "kitchen", "comms"]) windowsAt(MAP.rooms.find((r) => r.id === id), "top");
  for (const id of ["engines", "medbay", "storage", "fuel"]) windowsAt(MAP.rooms.find((r) => r.id === id), "bottom");

  drawDecor(g);

  // Vent grilles (everyone sees them as decorative floor grilles)
  for (const v of MAP.vents) {
    g.save(); g.translate(v.x, v.y);
    g.fillStyle = "#1c120c"; g.beginPath(); g.roundRect(-24, -17, 48, 34, 6); g.fill();
    g.strokeStyle = "#a07a3e"; g.lineWidth = 2; g.stroke();
    g.strokeStyle = "rgba(160,122,62,.8)"; g.lineWidth = 1.2;
    for (let k = -16; k <= 16; k += 8) { g.beginPath(); g.moveTo(k, -12); g.lineTo(k, 12); g.stroke(); }
    g.restore();
  }

  // Task stations: small brass consoles
  for (const t of MAP.tasks) {
    g.save(); g.translate(t.x, t.y);
    g.fillStyle = "#2a1c12"; g.beginPath(); g.roundRect(-20, -16, 40, 30, 6); g.fill();
    g.strokeStyle = "#d4a24c"; g.lineWidth = 2; g.stroke();
    g.fillStyle = "#6fe0b5"; g.fillRect(-13, -9, 26, 10);
    g.fillStyle = "#d4a24c"; g.beginPath(); g.arc(-8, 8, 2.5, 0, 7); g.arc(8, 8, 2.5, 0, 7); g.fill();
    g.restore();
  }
  // Sabotage repair panels
  for (const f of Object.values(MAP.fixes)) {
    g.save(); g.translate(f.x, f.y);
    g.fillStyle = "#30221a"; g.beginPath(); g.roundRect(-16, -20, 32, 40, 5); g.fill();
    g.strokeStyle = "#c8642a"; g.lineWidth = 2; g.stroke();
    g.fillStyle = "#c8642a"; g.fillRect(-9, -12, 18, 6); g.fillRect(-9, 0, 18, 6);
    g.restore();
  }
  // Security console
  {
    const s = MAP.console;
    g.save(); g.translate(s.x, s.y);
    g.fillStyle = "#1a2236"; g.beginPath(); g.roundRect(-46, -26, 92, 44, 8); g.fill();
    g.strokeStyle = "#d4a24c"; g.lineWidth = 2; g.stroke();
    for (let i = 0; i < 4; i++) { g.fillStyle = "#3a6fa8"; g.fillRect(-40 + i * 21, -20, 17, 13); }
    g.restore();
  }

  // Room names, written on the floor
  g.textAlign = "center"; g.textBaseline = "middle";
  for (const r of MAP.rooms) {
    g.font = "700 30px 'Reem Kufi', 'Tajawal', sans-serif";
    g.fillStyle = "rgba(255,236,200,.16)";
    g.fillText(r.name, r.x + r.w / 2, r.y + r.h - 34);
  }
  return c;
}

function rug(g, x, y, w, h, base, edge) {
  g.fillStyle = base; g.fillRect(x, y, w, h);
  g.strokeStyle = edge; g.lineWidth = 4; g.strokeRect(x + 8, y + 8, w - 16, h - 16);
  g.lineWidth = 1.5; g.strokeRect(x + 16, y + 16, w - 32, h - 32);
  g.fillStyle = edge; star8(g, x + w / 2, y + h / 2, Math.min(w, h) * 0.22); g.fill();
  g.fillStyle = base; star8(g, x + w / 2, y + h / 2, Math.min(w, h) * 0.12); g.fill();
}

function cushion(g, x, y, w, h, c) {
  g.fillStyle = shade(c, -0.35); g.beginPath(); g.roundRect(x, y + 4, w, h, 8); g.fill();
  g.fillStyle = c; g.beginPath(); g.roundRect(x, y, w, h, 8); g.fill();
  g.strokeStyle = "rgba(240,200,120,.7)"; g.lineWidth = 1.5; g.beginPath(); g.roundRect(x + 4, y + 4, w - 8, h - 8, 5); g.stroke();
}

function crate(g, x, y, s) {
  g.fillStyle = "#8a5d33"; g.fillRect(x, y, s, s);
  g.strokeStyle = "#4a2f18"; g.lineWidth = 3; g.strokeRect(x + 2, y + 2, s - 4, s - 4);
  g.beginPath(); g.moveTo(x + 4, y + 4); g.lineTo(x + s - 4, y + s - 4); g.moveTo(x + s - 4, y + 4); g.lineTo(x + 4, y + s - 4); g.stroke();
}

function dallah(g, x, y, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = "#e2b866";
  g.beginPath(); g.ellipse(0, 6, 11, 9, 0, 0, 7); g.fill();
  g.beginPath(); g.moveTo(-6, -2); g.lineTo(-4, -14); g.lineTo(4, -14); g.lineTo(6, -2); g.fill();
  g.beginPath(); g.moveTo(0, -18); g.lineTo(-5, -14); g.lineTo(5, -14); g.fill();
  g.strokeStyle = "#e2b866"; g.lineWidth = 3; g.beginPath(); g.moveTo(9, 2); g.quadraticCurveTo(20, -6, 22, -14); g.stroke();
  g.restore();
}

function drawDecor(g) {
  const R = Object.fromEntries(MAP.rooms.map((r) => [r.id, r]));
  // --- Majlis: floor seating around the walls, a great rug and the brass table with the emergency bell
  {
    const r = R.majlis;
    rug(g, r.x + 70, r.y + 90, r.w - 140, r.h - 180, "#7a1f2b", "#d4a24c");
    for (let x = r.x + 20; x < r.x + r.w - 60; x += 76) { cushion(g, x, r.y + 14, 66, 34, "#8a2332"); cushion(g, x, r.y + r.h - 50, 66, 34, "#8a2332"); }
    for (let y = r.y + 70; y < r.y + r.h - 80; y += 76) {
      if (y + 66 > 700 && y < 860) continue; // keep the doorways clear
      cushion(g, r.x + 14, y, 34, 66, "#1f5a4a"); cushion(g, r.x + r.w - 48, y, 34, 66, "#1f5a4a");
    }
    // Table
    const b = MAP.button;
    g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(b.x, b.y + 10, 78, 60, 0, 0, 7); g.fill();
    const tg = g.createRadialGradient(b.x - 20, b.y - 20, 10, b.x, b.y, 80);
    tg.addColorStop(0, "#f1d08a"); tg.addColorStop(1, "#8a5d22");
    g.fillStyle = tg; g.beginPath(); g.arc(b.x, b.y, 72, 0, 7); g.fill();
    g.strokeStyle = "#5c3a14"; g.lineWidth = 3; star8(g, b.x, b.y, 60); g.stroke();
    dallah(g, b.x - 44, b.y - 30, 0.9);
    for (const [dx, dy] of [[40, -36], [48, -18], [36, 34]]) { g.fillStyle = "#f6ecdc"; g.beginPath(); g.arc(b.x + dx, b.y + dy, 6, 0, 7); g.fill(); }
    LANTERNS.push(...[[r.x + 40, r.y + 60], [r.x + r.w - 40, r.y + 60], [r.x + 40, r.y + r.h - 70], [r.x + r.w - 40, r.y + r.h - 70]].map(([x, y]) => ({ x, y, r: 230 })));
  }
  // --- Kitchen / hospitality: counters, stove, coffee pots, dates
  {
    const r = R.kitchen;
    g.fillStyle = "#4a2f1c"; g.fillRect(r.x + 10, r.y + 10, r.w - 20, 46);
    g.fillStyle = "#d9c3a0"; g.fillRect(r.x + 10, r.y + 10, r.w - 20, 8);
    for (let x = r.x + 160; x < r.x + r.w - 140; x += 60) dallah(g, x, r.y + 34, 1);
    g.fillStyle = "#2a2a2e"; g.fillRect(r.x + r.w - 120, r.y + 70, 90, 70);
    for (const [dx, dy] of [[20, 18], [60, 18], [20, 50], [60, 50]]) { g.strokeStyle = "#c8642a"; g.lineWidth = 3; g.beginPath(); g.arc(r.x + r.w - 120 + dx, r.y + 70 + dy, 10, 0, 7); g.stroke(); }
    rug(g, r.x + 120, r.y + 140, 220, 150, "#1f5a4a", "#d4a24c");
    g.fillStyle = "#8a5d22"; g.beginPath(); g.arc(r.x + 230, r.y + 215, 34, 0, 7); g.fill();
    g.fillStyle = "#5a2a14"; for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(r.x + 214 + (i % 3) * 14, r.y + 202 + Math.floor(i / 3) * 12, 6, 4, 0.5, 0, 7); g.fill(); }
    LANTERNS.push({ x: r.x + 60, y: r.y + 90, r: 220 }, { x: r.x + r.w - 60, y: r.y + r.h - 60, r: 200 });
  }
  // --- Cockpit: wide front window, consoles, two seats
  {
    const r = R.cockpit;
    const sky = g.createLinearGradient(r.x + r.w, r.y, r.x + r.w + 40, r.y);
    sky.addColorStop(0, "#5a86c8"); sky.addColorStop(1, "#203a70");
    g.fillStyle = "#e2b866"; g.beginPath(); g.ellipse(r.x + r.w + 4, r.y + r.h / 2, 46, r.h / 2 - 10, 0, -Math.PI / 2, Math.PI / 2); g.fill();
    g.fillStyle = sky; g.beginPath(); g.ellipse(r.x + r.w + 4, r.y + r.h / 2, 38, r.h / 2 - 22, 0, -Math.PI / 2, Math.PI / 2); g.fill();
    g.fillStyle = "#1c2a44"; g.beginPath(); g.roundRect(r.x + r.w - 90, r.y + 60, 60, r.h - 120, 12); g.fill();
    g.strokeStyle = "#d4a24c"; g.lineWidth = 2; g.stroke();
    for (let y = r.y + 80; y < r.y + r.h - 70; y += 26) { g.fillStyle = y % 52 ? "#6fe0b5" : "#e6a817"; g.fillRect(r.x + r.w - 80, y, 40, 8); }
    for (const y of [r.y + 120, r.y + r.h - 120]) cushion(g, r.x + r.w - 160, y - 24, 48, 48, "#3f51b5");
    LANTERNS.push({ x: r.x + 60, y: r.y + r.h / 2, r: 220 });
  }
  // --- Comms: radio racks and a dish
  {
    const r = R.comms;
    for (let i = 0; i < 4; i++) {
      g.fillStyle = "#222b3e"; g.fillRect(r.x + 20 + i * 70, r.y + 14, 58, 70);
      g.fillStyle = "#e6a817"; g.fillRect(r.x + 28 + i * 70, r.y + 24, 42, 6);
      g.fillStyle = "#4fb3e8"; g.beginPath(); g.arc(r.x + 49 + i * 70, r.y + 56, 12, 0, 7); g.fill();
    }
    g.strokeStyle = "#c9c9d0"; g.lineWidth = 4; g.beginPath(); g.arc(r.x + r.w - 80, r.y + r.h - 90, 46, Math.PI * 0.8, Math.PI * 1.9); g.stroke();
    g.beginPath(); g.moveTo(r.x + r.w - 80, r.y + r.h - 90); g.lineTo(r.x + r.w - 52, r.y + r.h - 125); g.stroke();
    LANTERNS.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, r: 200 });
  }
  // --- Generators: copper cylinders & pipes
  {
    const r = R.generator;
    for (let i = 0; i < 2; i++) {
      const cx = r.x + 150 + i * 150, cy = r.y + 170;
      g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(cx, cy + 12, 58, 50, 0, 0, 7); g.fill();
      const cg = g.createRadialGradient(cx - 18, cy - 18, 6, cx, cy, 56);
      cg.addColorStop(0, "#f0b27a"); cg.addColorStop(1, "#7a3e1c");
      g.fillStyle = cg; g.beginPath(); g.arc(cx, cy, 54, 0, 7); g.fill();
      g.strokeStyle = "#3a1e0e"; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, 36, 0, 7); g.stroke();
      g.fillStyle = "#e6a817"; star8(g, cx, cy, 16); g.fill();
    }
    g.strokeStyle = "#a0603a"; g.lineWidth = 10; g.beginPath(); g.moveTo(r.x + 30, r.y + 300); g.lineTo(r.x + r.w - 30, r.y + 300); g.stroke();
    LANTERNS.push({ x: r.x + r.w / 2, y: r.y + 80, r: 220 });
  }
  // --- Security: wall of monitors
  {
    const r = R.security;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = "#0e1424"; g.fillRect(r.x + 150 + i * 56, r.y + 14 + j * 40, 50, 34);
      g.fillStyle = "rgba(79,179,232,.5)"; g.fillRect(r.x + 154 + i * 56, r.y + 18 + j * 40, 42, 26);
    }
    cushion(g, r.x + 120, r.y + 180, 120, 40, "#3f51b5");
    LANTERNS.push({ x: r.x + r.w / 2, y: r.y + r.h - 80, r: 200 });
  }
  // --- Engines: two big turbines
  {
    const r = R.engines;
    for (let i = 0; i < 2; i++) {
      const cx = r.x + 130 + i * 190, cy = r.y + 190;
      g.fillStyle = "#26272c"; g.beginPath(); g.arc(cx, cy, 78, 0, 7); g.fill();
      g.strokeStyle = "#d4a24c"; g.lineWidth = 5; g.stroke();
      g.fillStyle = "#4a4c55";
      for (let k = 0; k < 8; k++) { g.save(); g.translate(cx, cy); g.rotate((k * Math.PI) / 4); g.beginPath(); g.ellipse(36, 0, 34, 10, 0.4, 0, 7); g.fill(); g.restore(); }
      g.fillStyle = "#d4a24c"; g.beginPath(); g.arc(cx, cy, 14, 0, 7); g.fill();
    }
    LANTERNS.push({ x: r.x + r.w / 2, y: r.y + r.h - 70, r: 220 });
  }
  // --- Clinic: beds and a crescent sign
  {
    const r = R.medbay;
    for (let i = 0; i < 2; i++) {
      g.fillStyle = "#e9e4d8"; g.beginPath(); g.roundRect(r.x + 30 + i * 150, r.y + 40, 110, 56, 10); g.fill();
      g.fillStyle = "#16a085"; g.fillRect(r.x + 30 + i * 150, r.y + 40, 30, 56);
    }
    g.fillStyle = "#16a085"; g.beginPath(); g.arc(r.x + r.w / 2, r.y + 170, 26, 0, 7); g.fill();
    g.fillStyle = "#d8d2c4"; g.beginPath(); g.arc(r.x + r.w / 2 + 10, r.y + 164, 22, 0, 7); g.fill();
    g.strokeStyle = "rgba(111,224,181,.7)"; g.lineWidth = 3; g.beginPath(); g.arc(MAP.tasks.find((t) => t.id === "scan").x, 1220, 46, 0, 7); g.stroke();
    LANTERNS.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, r: 210 });
  }
  // --- Storage: crates, sacks, rolled carpets
  {
    const r = R.storage;
    for (const [dx, dy, s] of [[30, 30, 60], [96, 30, 60], [30, 96, 60], [r.w - 110, 30, 76], [r.w - 190, 40, 66], [r.w - 100, 120, 60]]) crate(g, r.x + dx, r.y + dy, s);
    for (let i = 0; i < 4; i++) { g.fillStyle = ["#7a1f2b", "#1f5a4a", "#3f51b5", "#c8642a"][i]; g.beginPath(); g.roundRect(r.x + 40, r.y + 220 + i * 34, 170, 26, 13); g.fill(); g.strokeStyle = "#d4a24c"; g.lineWidth = 2; g.stroke(); }
    LANTERNS.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, r: 240 });
  }
  // --- Fuel tank
  {
    const r = R.fuel;
    const cx = r.x + r.w / 2, cy = r.y + 170;
    g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(cx, cy + 14, 120, 70, 0, 0, 7); g.fill();
    const fg = g.createLinearGradient(cx - 110, 0, cx + 110, 0);
    fg.addColorStop(0, "#5a5d66"); fg.addColorStop(0.4, "#9aa0ad"); fg.addColorStop(1, "#3a3c44");
    g.fillStyle = fg; g.beginPath(); g.roundRect(cx - 110, cy - 60, 220, 120, 60); g.fill();
    g.strokeStyle = "#e6a817"; g.lineWidth = 4; g.beginPath(); g.moveTo(cx - 60, cy - 58); g.lineTo(cx - 60, cy + 58); g.moveTo(cx + 60, cy - 58); g.lineTo(cx + 60, cy + 58); g.stroke();
    LANTERNS.push({ x: cx, y: r.y + r.h - 70, r: 210 });
  }
  // Hall lanterns
  for (let x = 520; x < 1240; x += 260) LANTERNS.push({ x, y: 730, r: 190 });
  for (let x = 1880; x < 2550; x += 260) LANTERNS.push({ x, y: 730, r: 190 });
  for (const l of LANTERNS) {
    g.fillStyle = "#e2b866"; g.beginPath(); g.moveTo(l.x, l.y - 12); g.lineTo(l.x + 8, l.y); g.lineTo(l.x, l.y + 12); g.lineTo(l.x - 8, l.y); g.closePath(); g.fill();
    g.fillStyle = "#fff4c8"; g.beginPath(); g.arc(l.x, l.y, 4, 0, 7); g.fill();
  }
}

// ---------- characters ----------

/** Original character: a robed traveller in a thobe of the player's colour, white ghutra and black agal. */
export function drawCharacter(g, x, y, colorId, o = {}) {
  const c = colorHex(colorId);
  const s = o.scale || 1;
  const face = o.facing || 1;
  const ph = o.walk || 0;
  const bob = o.moving ? Math.abs(Math.sin(ph)) * 3 : 0;
  g.save();
  g.translate(x, y);
  g.scale(s * face, s);
  if (o.ghost) g.globalAlpha = 0.5;

  if (!o.ghost) {
    g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(0, 20, 20, 7, 0, 0, 7); g.fill();
    // feet
    const f = o.moving ? Math.sin(ph) * 6 : 0;
    g.fillStyle = "#2b1c14";
    g.beginPath(); g.ellipse(-7 + f, 19, 6, 4, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(7 - f, 19, 6, 4, 0, 0, 7); g.fill();
  }
  g.translate(0, -bob);
  // Robe (thobe) with a bisht edge
  g.fillStyle = shade(c, -0.25);
  g.beginPath(); g.moveTo(-17, 18); g.quadraticCurveTo(-20, -6, -11, -14); g.lineTo(11, -14); g.quadraticCurveTo(20, -6, 17, 18);
  if (o.ghost) { for (let i = 0; i <= 4; i++) g.lineTo(17 - i * 8.5, 18 + (i % 2 ? 6 : 0)); } else g.closePath();
  g.fill();
  g.fillStyle = c;
  g.beginPath(); g.moveTo(-13, 17); g.quadraticCurveTo(-15, -4, -8, -13); g.lineTo(8, -13); g.quadraticCurveTo(15, -4, 13, 17); g.closePath(); g.fill();
  g.strokeStyle = "#e2b866"; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(4, -12); g.lineTo(6, 16); g.stroke();
  // Head: face + ghutra + agal
  g.fillStyle = "#c99a6e"; g.beginPath(); g.arc(1, -22, 10, 0, 7); g.fill();
  g.fillStyle = "#f7f3ea";
  g.beginPath(); g.moveTo(-12, -24); g.quadraticCurveTo(-12, -38, 1, -38); g.quadraticCurveTo(13, -38, 12, -26);
  g.lineTo(8, -27); g.quadraticCurveTo(1, -31, -4, -24); g.lineTo(-6, -10); g.quadraticCurveTo(-14, -8, -16, -2); g.quadraticCurveTo(-14, -14, -12, -24); g.fill();
  g.strokeStyle = "#1a1a1a"; g.lineWidth = 3; g.beginPath(); g.ellipse(1, -32, 11, 3.2, 0, 0, 7); g.stroke();
  // Eyes
  if (o.dead) {
    g.strokeStyle = "#2b1c14"; g.lineWidth = 1.6;
    for (const ex of [3, 8]) { g.beginPath(); g.moveTo(ex - 2, -24); g.lineTo(ex + 2, -20); g.moveTo(ex + 2, -24); g.lineTo(ex - 2, -20); g.stroke(); }
  } else {
    g.fillStyle = "#2b1c14";
    g.beginPath(); g.arc(4, -22, 1.8, 0, 7); g.arc(9, -22, 1.8, 0, 7); g.fill();
  }
  if (o.ghost) {
    g.strokeStyle = "rgba(241,208,138,.9)"; g.lineWidth = 2; g.beginPath(); g.ellipse(1, -46, 10, 3, 0, 0, 7); g.stroke();
  }
  g.restore();
}

/** A knocked-out traveller lying on the floor (family friendly: no gore). */
export function drawBody(g, x, y, colorId, t = 0) {
  g.save(); g.translate(x, y);
  g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(0, 8, 34, 12, 0, 0, 7); g.fill();
  g.rotate(-Math.PI / 2);
  drawCharacter(g, 0, 8, colorId, { dead: true, scale: 0.95 });
  g.restore();
  // little stars circling the head
  g.fillStyle = "#f1d08a";
  for (let i = 0; i < 3; i++) {
    const a = t * 3 + (i * Math.PI * 2) / 3;
    star8(g, x - 26 + Math.cos(a) * 12, y - 4 + Math.sin(a) * 5, 4); g.fill();
  }
}

// ---------- the renderer ----------

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.map = buildMap();
    this.fog = makeCanvas(4, 4);
    this.stars = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.3, p: Math.random() * 6 }));
    this.clouds = Array.from({ length: 9 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 1.2, v: 0.004 + Math.random() * 0.01 }));
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
    this.zoom = Math.max(0.68, Math.min(1.25, Math.min(w, h) / 680)) * dpr;
  }

  toScreen(x, y) {
    return { x: (x - this.cam.x) * this.zoom / this.dpr + innerWidth / 2, y: (y - this.cam.y) * this.zoom / this.dpr + innerHeight / 2 };
  }

  drawSky(g, t) {
    const W = this.canvas.width, H = this.canvas.height;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#0a1230"); sky.addColorStop(0.6, "#1b2350"); sky.addColorStop(1, "#3b2a4a");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (const s of this.stars) {
      g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2 + s.p);
      g.fillStyle = "#fff";
      g.fillRect(((s.x * W - this.cam.x * 0.05) % W + W) % W, s.y * H, s.r * this.dpr, s.r * this.dpr);
    }
    g.globalAlpha = 0.12;
    g.fillStyle = "#c9d4ff";
    for (const c of this.clouds) {
      const x = (((c.x + t * c.v) * W * 1.4 - this.cam.x * 0.15) % (W * 1.4) + W * 1.4) % (W * 1.4) - W * 0.2;
      const y = c.y * H;
      g.beginPath();
      g.ellipse(x, y, 120 * c.s * this.dpr, 30 * c.s * this.dpr, 0, 0, 7);
      g.ellipse(x + 60 * c.s * this.dpr, y - 14 * this.dpr, 70 * c.s * this.dpr, 26 * c.s * this.dpr, 0, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /**
   * frame: { cam, t, players: [{id,x,y,color,name,ghost,moving,walk,facing,nameColor}], bodies, me, vision (null = no fog),
   *          visible(x,y)->bool, highlights: [{x,y,color}], doorsClosed: [rects], lightsOut }
   */
  draw(f) {
    const g = this.g;
    this.cam = f.cam;
    const t = f.t;
    this.drawSky(g, t);

    g.save();
    g.translate(this.canvas.width / 2, this.canvas.height / 2);
    g.scale(this.zoom, this.zoom);
    g.translate(-f.cam.x, -f.cam.y);

    g.drawImage(this.map, 0, 0);

    // Warm lantern light
    g.globalCompositeOperation = "lighter";
    for (const l of LANTERNS) {
      const lg = g.createRadialGradient(l.x, l.y, 4, l.x, l.y, l.r);
      lg.addColorStop(0, f.lightsOut ? "rgba(255,180,90,.05)" : "rgba(255,190,100,.20)");
      lg.addColorStop(1, "rgba(255,190,100,0)");
      g.fillStyle = lg; g.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    g.globalCompositeOperation = "source-over";

    // Closed doors: heavy carved wooden doors with brass studs
    for (const d of f.doorsClosed) {
      g.fillStyle = "#4a2a14"; g.fillRect(d.x - 3, d.y - 3, d.w + 6, d.h + 6);
      g.strokeStyle = "#e2b866"; g.lineWidth = 3; g.strokeRect(d.x - 3, d.y - 3, d.w + 6, d.h + 6);
      g.fillStyle = "#e2b866";
      const horiz = d.w > d.h;
      for (let k = 12; k < (horiz ? d.w : d.h) - 6; k += 18) { g.beginPath(); g.arc(horiz ? d.x + k : d.x + d.w / 2, horiz ? d.y + d.h / 2 : d.y + k, 2.5, 0, 7); g.fill(); }
    }

    // Highlights (my tasks, repair panels, the bell)
    for (const h of f.highlights) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      g.strokeStyle = h.color; g.globalAlpha = 0.35 + pulse * 0.5; g.lineWidth = 4;
      g.beginPath(); g.arc(h.x, h.y, 30 + pulse * 6, 0, 7); g.stroke();
      g.globalAlpha = 1;
    }

    for (const b of f.bodies) if (f.visible(b.x, b.y)) drawBody(g, b.x, b.y, b.color, t);

    const shown = f.players.filter((p) => p.self || f.visible(p.x, p.y)).sort((a, b) => a.y - b.y);
    for (const p of shown) {
      if (p.vented && !p.self) continue;
      drawCharacter(g, p.x, p.y, p.color, p);
    }
    g.restore();

    // Fog of war
    if (f.vision) {
      const fg = this.fog.getContext("2d");
      const W = this.fog.width, H = this.fog.height;
      fg.globalCompositeOperation = "source-over";
      fg.clearRect(0, 0, W, H);
      fg.fillStyle = f.lightsOut ? "rgba(3,2,8,.97)" : "rgba(6,4,12,.9)";
      fg.fillRect(0, 0, W, H);
      fg.globalCompositeOperation = "destination-out";
      const pts = f.vision.poly;
      const cx = (f.vision.x - f.cam.x) * this.zoom + W / 2, cy = (f.vision.y - f.cam.y) * this.zoom + H / 2;
      const rr = f.vision.r * this.zoom;
      const grad = fg.createRadialGradient(cx, cy, rr * 0.55, cx, cy, rr);
      grad.addColorStop(0, "rgba(0,0,0,1)"); grad.addColorStop(1, "rgba(0,0,0,0)");
      fg.fillStyle = grad;
      fg.beginPath();
      for (let i = 0; i < pts.length; i += 2) fg.lineTo((pts[i] - f.cam.x) * this.zoom + W / 2, (pts[i + 1] - f.cam.y) * this.zoom + H / 2);
      fg.closePath(); fg.fill();
      g.drawImage(this.fog, 0, 0);
    }

    // Names on top of fog
    g.save();
    g.translate(this.canvas.width / 2, this.canvas.height / 2);
    g.scale(this.zoom, this.zoom);
    g.translate(-f.cam.x, -f.cam.y);
    g.textAlign = "center"; g.font = "800 15px Tajawal, sans-serif";
    for (const p of shown) {
      if (p.vented && !p.self) continue;
      g.lineWidth = 4; g.strokeStyle = "rgba(0,0,0,.75)"; g.strokeText(p.name, p.x, p.y - 50);
      g.fillStyle = p.nameColor || "#fff"; g.fillText(p.name, p.x, p.y - 50);
    }
    g.restore();
  }

  /** Small top-down views for the security cameras. */
  drawCamera(canvas, cam, players, bodies, t) {
    const g = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height, z = w / 520;
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    g.save();
    g.translate(w / 2, h / 2); g.scale(z, z); g.translate(-cam.x, -cam.y);
    g.drawImage(this.map, 0, 0);
    for (const b of bodies) drawBody(g, b.x, b.y, b.color, t);
    for (const p of players) if (!p.ghost && !p.vented) drawCharacter(g, p.x, p.y, p.color, p);
    g.restore();
    g.fillStyle = "rgba(80,140,255,.08)"; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(0,0,0,.18)"; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  }

  /** Overview map with markers: [{x,y,color,r,label}] */
  drawOverview(canvas, markers) {
    const W = MAP.width, H = MAP.height;
    const cw = canvas.clientWidth || 800;
    canvas.width = cw * this.dpr;
    canvas.height = (cw * H / W) * this.dpr;
    const g = canvas.getContext("2d");
    const z = canvas.width / W;
    g.fillStyle = "#070b16"; g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(this.map, 0, 0, canvas.width, canvas.height);
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `700 ${Math.round(28 * z * 1.6)}px Tajawal, sans-serif`;
    for (const r of MAP.rooms) {
      g.lineWidth = 4 * z * 1.5; g.strokeStyle = "rgba(0,0,0,.8)";
      g.strokeText(r.name, (r.x + r.w / 2) * z, (r.y + r.h / 2) * z);
      g.fillStyle = "#f1d08a"; g.fillText(r.name, (r.x + r.w / 2) * z, (r.y + r.h / 2) * z);
    }
    for (const m of markers) {
      g.fillStyle = m.color; g.strokeStyle = "#000"; g.lineWidth = 2;
      g.beginPath(); g.arc(m.x * z, m.y * z, (m.r || 14) * z * 1.6, 0, 7); g.fill(); g.stroke();
    }
    return z;
  }
}
