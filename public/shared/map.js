// "طائرة الصقر" — built on the owner's own hand-drawn blueprint, laid out horizontally: main engine at the left (tail),
// bridge at the right (nose), the great round majlis at the top centre with the reactor below it. One shared definition used for collision, vision,
// tasks, bots and rendering. Walkable space is the union of rectangles; octagonal rooms are made of stepped pieces.
//
// Coordinates below are written in the vertical blueprint's pixel space (about 1100 x 2000); R90 turns them a quarter
// turn so the ship lies horizontally (blueprint top -> left), then T scales them by S.

const S = 2.2, OX = -200, OY = -5, W0 = 1090;
const R90 = (o) => {
  const r = { ...o };
  if (typeof o.w === "number") { r.x = o.y; r.y = W0 - (o.x + o.w); r.w = o.h; r.h = o.w; }
  else if (typeof o.x === "number") { r.x = o.y; r.y = W0 - o.x; }
  return r;
};
const T0 = (o) => {
  const r = { ...o };
  if (typeof o.x === "number") r.x = Math.round(o.x * S + OX);
  if (typeof o.y === "number") r.y = Math.round((o.y + OY) * S);
  // scale edges (not sizes) so rectangles that touch in the blueprint still touch exactly
  if (typeof o.w === "number") r.w = Math.round((o.x + o.w) * S + OX) - r.x;
  if (typeof o.h === "number") r.h = Math.round((o.y + o.h + OY) * S) - r.y;
  if (typeof o.cut === "number") r.cut = Math.round(o.cut * S);
  if (typeof o.r === "number") r.r = Math.round(o.r * S);
  return r;
};
const T = (o) => T0(R90(o));

const rooms = [
  { id: "engines", name: "المحرك الرئيسي", x: 392, y: 150, w: 326, h: 185, cut: 45, floor: "metal" },
  { id: "generator", name: "المولدات", x: 205, y: 310, w: 187, h: 185, floor: "copper" },
  { id: "guard", name: "برج الحراسة", x: 718, y: 310, w: 200, h: 190, floor: "night" },
  { id: "medbay", name: "العيادة", x: 460, y: 500, w: 215, h: 110, floor: "marble" },
  { id: "security", name: "المراقبة", x: 255, y: 700, w: 235, h: 115, floor: "night" },
  { id: "baggage", name: "الأمتعة", x: 518, y: 610, w: 227, h: 210, floor: "planks" },
  { id: "reactor", name: "المفاعل", x: 70, y: 820, w: 385, h: 290, cut: 70, floor: "metal" },
  { id: "majlis", name: "المجلس", x: 570, y: 820, w: 450, h: 470, cut: 110, floor: "carpet" },
  { id: "air", name: "غرفة الهواء", x: 70, y: 1150, w: 175, h: 190, floor: "teal" },
  { id: "storage", name: "المخزن", x: 340, y: 1150, w: 185, h: 190, floor: "planks" },
  { id: "kitchen", name: "الضيافة", x: 540, y: 1300, w: 150, h: 140, floor: "terracotta" },
  { id: "gear", name: "مخزن العتاد", x: 700, y: 1370, w: 240, h: 160, floor: "wood" },
  { id: "engineB", name: "المحرك الاحتياطي", x: 165, y: 1375, w: 205, h: 180, floor: "metal" },
  { id: "comms", name: "الاتصالات", x: 470, y: 1510, w: 220, h: 90, floor: "night" },
  { id: "cockpit", name: "قمرة القيادة", x: 470, y: 1680, w: 210, h: 220, cut: 50, floor: "cockpit" }
];

const corridors = [
  // top: engine down into the top hall, which joins generator and guard tower
  { id: "engDown", x: 515, y: 335, w: 80, h: 45 },
  { id: "topHall", x: 392, y: 380, w: 326, h: 90 },
  { id: "toMed", x: 520, y: 470, w: 60, h: 30 },
  // left side: generator down to the reactor, with a branch east to security and baggage
  { id: "genDown", x: 250, y: 495, w: 95, h: 85 },
  { id: "leftJoin", x: 155, y: 580, w: 190, h: 60 },
  { id: "leftOuter", x: 155, y: 640, w: 95, h: 180 },
  { id: "midHall", x: 345, y: 610, w: 173, h: 50 },
  { id: "toSec", x: 360, y: 660, w: 60, h: 40 },
  { id: "secBag", x: 490, y: 750, w: 28, h: 40 },
  // right side: guard tower down to the majlis, with a side door from baggage
  { id: "rightCor", x: 765, y: 500, w: 70, h: 320 },
  { id: "bagRight", x: 745, y: 700, w: 20, h: 60 },
  // middle: reactor <-> majlis, storage below it
  { id: "reactorLink", x: 455, y: 960, w: 115, h: 70 },
  { id: "toStorage", x: 455, y: 1030, w: 50, h: 120 },
  // lower left: reactor down to the reserve engine, side door into the air room
  { id: "leftDown", x: 255, y: 1110, w: 50, h: 265 },
  { id: "toAir", x: 245, y: 1220, w: 10, h: 50 },
  // lower right: majlis down to the gear store
  { id: "lifeLine", x: 820, y: 1290, w: 60, h: 80 },
  // bottom hall: reserve engine <-> gear store, kitchen above, comms below, then the bridge
  { id: "bottomHall", x: 370, y: 1440, w: 330, h: 70 },
  { id: "toBridge", x: 540, y: 1600, w: 70, h: 80 }
];

const tasks = [
  { id: "engineFuel", name: "تعبئة المحرك", room: "engines", x: 450, y: 250, type: "hold" },
  { id: "filter", name: "تنظيف المرشح", room: "engines", x: 660, y: 300, type: "clicks" },
  { id: "wires", name: "إصلاح الأسلاك", room: "generator", x: 240, y: 340, type: "wires" },
  { id: "power", name: "توزيع الطاقة", room: "generator", x: 355, y: 465, type: "switches" },
  { id: "charge", name: "شحن البطاريات", room: "guard", x: 890, y: 340, type: "hold" },
  { id: "radar", name: "ضبط الرادار", room: "guard", x: 760, y: 470, type: "slider" },
  { id: "scan", name: "الفحص الطبي", room: "medbay", x: 560, y: 575, type: "scan" },
  { id: "locks", name: "تحديث الأقفال", room: "security", x: 460, y: 790, type: "code" },
  { id: "sortBags", name: "فرز الأمتعة", room: "baggage", x: 700, y: 790, type: "sequence" },
  { id: "calibrate", name: "معايرة المفاعل", room: "reactor", x: 260, y: 1075, type: "slider" },
  { id: "incense", name: "إشعال البخور", room: "majlis", x: 610, y: 1110, type: "clicks" },
  { id: "airClean", name: "تنقية الهواء", room: "air", x: 110, y: 1190, type: "clicks" },
  { id: "valves", name: "ضبط الصمامات", room: "air", x: 215, y: 1310, type: "switches" },
  { id: "cargo", name: "ترتيب الشحنة", room: "storage", x: 490, y: 1310, type: "sequence" },
  { id: "coffee", name: "تحضير القهوة", room: "kitchen", x: 575, y: 1330, type: "pour" },
  { id: "dates", name: "تقديم التمر", room: "kitchen", x: 660, y: 1405, type: "sequence" },
  { id: "openLocker", name: "فتح الخزائن", room: "gear", x: 910, y: 1400, type: "code" },
  { id: "reserveFuel", name: "تشغيل المحرك الاحتياطي", room: "engineB", x: 200, y: 1520, type: "hold" },
  { id: "radio", name: "ضبط التردد", room: "comms", x: 660, y: 1550, type: "slider" },
  { id: "course", name: "ضبط المسار", room: "cockpit", x: 575, y: 1865, type: "slider" }
];

const vents = [
  { id: "vEng", x: 650, y: 200, links: ["vGen", "vGuard"] },
  { id: "vGen", x: 380, y: 340, links: ["vEng", "vGuard"] },
  { id: "vGuard", x: 880, y: 470, links: ["vEng", "vGen"] },
  { id: "vSec", x: 285, y: 790, links: ["vMed", "vBag"] },
  { id: "vMed", x: 645, y: 525, links: ["vSec", "vBag"] },
  { id: "vBag", x: 560, y: 640, links: ["vSec", "vMed"] },
  { id: "vReact", x: 100, y: 1000, links: ["vAir", "vEngB"] },
  { id: "vAir", x: 210, y: 1180, links: ["vReact", "vEngB"] },
  { id: "vEngB", x: 340, y: 1405, links: ["vReact", "vAir"] },
  { id: "vSto", x: 370, y: 1180, links: ["vKit", "vGear"] },
  { id: "vKit", x: 565, y: 1415, links: ["vSto", "vGear"] },
  { id: "vGear", x: 730, y: 1500, links: ["vSto", "vKit"] },
  { id: "vComm", x: 680, y: 1585, links: ["vCock"] },
  { id: "vCock", x: 600, y: 1870, links: ["vComm"] }
];

const base = {
  name: "طائرة الصقر",
  spawn: T({ x: 795, y: 1055 }),
  button: T({ x: 795, y: 1055 }),
  console: T({ x: 330, y: 735 }), // security cameras
  admin: T({ x: 575, y: 1770 }), // live map table on the bridge
  cameras: [
    { name: "الممر الأيسر", ...T({ x: 300, y: 610 }) },
    { name: "الممر الأيمن", ...T({ x: 800, y: 650 }) },
    { name: "ممر المفاعل", ...T({ x: 510, y: 995 }) },
    { name: "الممر السفلي", ...T({ x: 530, y: 1475 }) }
  ],
  fixes: {
    lights: { ...T({ x: 230, y: 470 }), room: "generator" },
    comms: { ...T({ x: 500, y: 1550 }), room: "comms" },
    fuelA: { ...T({ x: 100, y: 960 }), room: "reactor" },
    fuelB: { ...T({ x: 425, y: 960 }), room: "reactor" }
  },
  propellers: [T0({ x: 105, y: 470 }), T0({ x: 105, y: 620 })] // behind the main engine (already in turned space)
};
base.spawn.r = 150;

export const MAP = {
  ...base,
  width: Math.round(1900 * S + OX + 160),
  height: Math.round((1020 + OY) * S + 130),
  rooms: rooms.map(T),
  corridors: corridors.map(T),
  tasks: tasks.map(T),
  vents: vents.map(T),
  doors: []
};

// Octagonal rooms: a stepped cross of rectangles instead of one box.
for (const r of MAP.rooms) {
  if (!r.cut) continue;
  const c = r.cut, h = Math.round(c / 2);
  r.parts = [
    { x: r.x + c, y: r.y, w: r.w - 2 * c, h: r.h },
    { x: r.x + h, y: r.y + h, w: r.w - 2 * h, h: r.h - 2 * h },
    { x: r.x, y: r.y + c, w: r.w, h: r.h - 2 * c }
  ];
}

// Doors: a 16px band of a passage where it meets a room.
for (const r of MAP.rooms) {
  for (const c of MAP.corridors) {
    const xOverlap = c.x < r.x + r.w && c.x + c.w > r.x;
    const yOverlap = c.y < r.y + r.h && c.y + c.h > r.y;
    if (xOverlap && c.y + c.h === r.y) MAP.doors.push({ room: r.id, x: c.x, y: r.y - 16, w: c.w, h: 16 });
    else if (xOverlap && c.y === r.y + r.h) MAP.doors.push({ room: r.id, x: c.x, y: c.y, w: c.w, h: 16 });
    else if (yOverlap && c.x + c.w === r.x) MAP.doors.push({ room: r.id, x: r.x - 16, y: c.y, w: 16, h: c.h });
    else if (yOverlap && c.x === r.x + r.w) MAP.doors.push({ room: r.id, x: c.x, y: c.y, w: 16, h: c.h });
  }
}

export const WALKABLE = [...MAP.rooms.flatMap((r) => r.parts || [r]), ...MAP.corridors];
export const ROOM_BY_ID = Object.fromEntries(MAP.rooms.map((r) => [r.id, r]));
export const TASK_BY_ID = Object.fromEntries(MAP.tasks.map((t) => [t.id, t]));
export const VENT_BY_ID = Object.fromEntries(MAP.vents.map((v) => [v.id, v]));

export function roomAt(x, y) {
  for (const r of MAP.rooms) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
  return null;
}

export function spawnPoint(i, n) {
  const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
  return {
    x: Math.round(MAP.spawn.x + Math.cos(a) * MAP.spawn.r),
    y: Math.round(MAP.spawn.y + Math.sin(a) * MAP.spawn.r * 0.95)
  };
}

/**
 * Walking graph for computer players: a node in each walkable rectangle's centre and in the middle of every opening
 * where two of them meet. Any two nodes inside the same rectangle are joined (a rectangle is convex).
 */
export function navGraph() {
  const nodes = [];
  const owners = WALKABLE.map(() => []);
  const add = (x, y, rects) => {
    const id = nodes.length;
    nodes.push({ id, x, y });
    for (const i of rects) owners[i].push(id);
    return id;
  };
  WALKABLE.forEach((r, i) => add(r.x + r.w / 2, r.y + r.h / 2, [i]));
  for (let i = 0; i < WALKABLE.length; i++) {
    for (let j = i + 1; j < WALKABLE.length; j++) {
      const a = WALKABLE[i], b = WALKABLE[j];
      const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
      const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
      if (x1 < x0 || y1 < y0) continue;
      if (x1 - x0 < 40 && y1 - y0 < 40) continue; // only real openings
      add((x0 + x1) / 2, (y0 + y1) / 2, [i, j]);
    }
  }
  const edges = nodes.map(() => []);
  for (const list of owners) {
    for (const a of list) for (const b of list) if (a !== b) edges[a].push({ to: b, d: Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y) });
  }
  return { nodes, edges };
}
