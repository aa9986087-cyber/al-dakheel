// "طائرة الصقر" — the Falcon airship. One shared map definition used for collision, vision, tasks and rendering.
// Walkable space is the union of room and corridor rectangles; everything else is wall or sky.

export const MAP = {
  name: "طائرة الصقر",
  width: 3100,
  height: 1600,
  spawn: { x: 1500, y: 780, r: 140 },
  button: { x: 1500, y: 780 }, // emergency bell on the majlis table

  rooms: [
    { id: "generator", name: "المولدات", x: 300, y: 200, w: 420, h: 360, floor: "copper" },
    { id: "security", name: "المراقبة", x: 800, y: 220, w: 360, h: 340, floor: "night" },
    { id: "kitchen", name: "الضيافة", x: 1850, y: 200, w: 500, h: 360, floor: "terracotta" },
    { id: "comms", name: "الاتصالات", x: 2420, y: 200, w: 360, h: 320, floor: "night" },
    { id: "majlis", name: "المجلس", x: 1250, y: 500, w: 500, h: 560, floor: "carpet" },
    { id: "cockpit", name: "قمرة القيادة", x: 2560, y: 600, w: 360, h: 360, floor: "cockpit" },
    { id: "engines", name: "المحركات", x: 300, y: 1000, w: 450, h: 400, floor: "metal" },
    { id: "medbay", name: "العيادة", x: 850, y: 1000, w: 330, h: 360, floor: "marble" },
    { id: "storage", name: "المخزن", x: 1850, y: 1000, w: 520, h: 420, floor: "wood" },
    { id: "fuel", name: "خزان الوقود", x: 2450, y: 1040, w: 360, h: 360, floor: "metal" }
  ],

  corridors: [
    { id: "hallW", x: 400, y: 710, w: 850, h: 140 },
    { id: "hallE", x: 1750, y: 710, w: 810, h: 140 },
    { id: "cGen", x: 460, y: 560, w: 100, h: 150 },
    { id: "cSec", x: 930, y: 560, w: 100, h: 150 },
    { id: "cKit", x: 2050, y: 560, w: 100, h: 150 },
    { id: "cCom", x: 2630, y: 520, w: 100, h: 80 },
    { id: "cEng", x: 460, y: 850, w: 100, h: 150 },
    { id: "cMed", x: 960, y: 850, w: 100, h: 150 },
    { id: "cSto", x: 2050, y: 850, w: 100, h: 150 },
    { id: "cFuel", x: 2630, y: 960, w: 100, h: 80 }
  ],

  // Doors the saboteur can slam shut for a few seconds (per room).
  doors: [
    { room: "majlis", x: 1236, y: 710, w: 16, h: 140 },
    { room: "majlis", x: 1750, y: 710, w: 16, h: 140 },
    { room: "generator", x: 460, y: 560, w: 100, h: 16 },
    { room: "security", x: 930, y: 560, w: 100, h: 16 },
    { room: "kitchen", x: 2050, y: 560, w: 100, h: 16 },
    { room: "comms", x: 2630, y: 520, w: 100, h: 16 },
    { room: "engines", x: 460, y: 984, w: 100, h: 16 },
    { room: "medbay", x: 960, y: 984, w: 100, h: 16 },
    { room: "storage", x: 2050, y: 984, w: 100, h: 16 },
    { room: "fuel", x: 2630, y: 1024, w: 100, h: 16 },
    { room: "cockpit", x: 2544, y: 710, w: 16, h: 140 },
    { room: "cockpit", x: 2630, y: 600, w: 100, h: 16 },
    { room: "cockpit", x: 2630, y: 944, w: 100, h: 16 }
  ],

  // Crew tasks. `type` selects the mini-game in public/client/tasks.js
  tasks: [
    { id: "coffee", name: "تحضير القهوة", room: "kitchen", x: 1950, y: 260, type: "hold" },
    { id: "dates", name: "تقديم التمر", room: "kitchen", x: 2270, y: 490, type: "sequence" },
    { id: "course", name: "ضبط المسار", room: "cockpit", x: 2860, y: 780, type: "slider" },
    { id: "radio", name: "ضبط التردد", room: "comms", x: 2720, y: 270, type: "slider" },
    { id: "wires", name: "إصلاح الأسلاك", room: "generator", x: 370, y: 280, type: "wires" },
    { id: "power", name: "توزيع الطاقة", room: "generator", x: 650, y: 490, type: "switches" },
    { id: "engineFuel", name: "تعبئة المحرك", room: "engines", x: 370, y: 1330, type: "hold" },
    { id: "filter", name: "تنظيف المرشح", room: "engines", x: 690, y: 1070, type: "clicks" },
    { id: "cargo", name: "ترتيب الشحنة", room: "storage", x: 2300, y: 1350, type: "sequence" },
    { id: "scan", name: "الفحص الطبي", room: "medbay", x: 1015, y: 1220, type: "scan" },
    { id: "locks", name: "تحديث الأقفال", room: "security", x: 1090, y: 300, type: "code" },
    { id: "incense", name: "إشعال البخور", room: "majlis", x: 1310, y: 1000, type: "clicks" },
    { id: "gauge", name: "معايرة الضغط", room: "fuel", x: 2760, y: 1340, type: "slider" }
  ],

  // Secret hatches for the saboteur. Linked hatches can be travelled between while hidden.
  vents: [
    { id: "vGen", x: 650, y: 290, links: ["vSec", "vEng"] },
    { id: "vSec", x: 860, y: 500, links: ["vGen"] },
    { id: "vEng", x: 660, y: 1330, links: ["vGen", "vMed"] },
    { id: "vMed", x: 1120, y: 1070, links: ["vEng"] },
    { id: "vKit", x: 2290, y: 270, links: ["vCock", "vSto"] },
    { id: "vCock", x: 2620, y: 900, links: ["vKit", "vFuel"] },
    { id: "vSto", x: 1910, y: 1360, links: ["vKit"] },
    { id: "vFuel", x: 2510, y: 1340, links: ["vCock"] }
  ],

  // Security room console and the cameras it shows.
  console: { x: 960, y: 290 },
  cameras: [
    { name: "الممر الغربي", x: 820, y: 780 },
    { name: "الممر الشرقي", x: 2150, y: 780 },
    { name: "باب القمرة", x: 2480, y: 780 },
    { name: "باب المخزن", x: 2100, y: 1060 }
  ],

  // Where sabotage gets fixed.
  fixes: {
    lights: { x: 380, y: 490, room: "generator" },
    comms: { x: 2470, y: 450, room: "comms" },
    fuelA: { x: 2770, y: 1110, room: "fuel" },
    fuelB: { x: 2320, y: 1070, room: "storage" }
  }
};

export const WALKABLE = [...MAP.rooms, ...MAP.corridors];
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
