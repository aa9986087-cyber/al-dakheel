// "طائرة الصقر" — the Falcon airship (original layout). One shared map definition used for collision, vision,
// tasks, bots and rendering. Walkable space is the union of room and corridor rectangles; everything else is wall.
// Loops (north via the air room, south via the library, the west tail, east side passages) give room to chase and hide.

export const MAP = {
  name: "طائرة الصقر",
  width: 3100,
  height: 1600,
  spawn: { x: 1500, y: 780, r: 140 },
  button: { x: 1500, y: 780 }, // emergency bell on the majlis table

  rooms: [
    { id: "generator", name: "المولدات", x: 300, y: 200, w: 420, h: 360, floor: "copper" },
    { id: "security", name: "المراقبة", x: 800, y: 220, w: 360, h: 340, floor: "night" },
    { id: "air", name: "غرفة الهواء", x: 1300, y: 130, w: 400, h: 290, floor: "teal" },
    { id: "kitchen", name: "الضيافة", x: 1850, y: 200, w: 500, h: 360, floor: "terracotta" },
    { id: "comms", name: "الاتصالات", x: 2420, y: 200, w: 360, h: 320, floor: "night" },
    { id: "majlis", name: "المجلس", x: 1250, y: 500, w: 500, h: 560, floor: "carpet" },
    { id: "cockpit", name: "قمرة القيادة", x: 2560, y: 600, w: 360, h: 360, floor: "cockpit" },
    { id: "engines", name: "المحركات", x: 300, y: 1000, w: 450, h: 400, floor: "metal" },
    { id: "medbay", name: "العيادة", x: 850, y: 1000, w: 330, h: 360, floor: "marble" },
    { id: "library", name: "المكتبة", x: 1300, y: 1140, w: 400, h: 310, floor: "wood" },
    { id: "storage", name: "المخزن", x: 1850, y: 1000, w: 520, h: 420, floor: "planks" },
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
    { id: "cFuel", x: 2630, y: 960, w: 100, h: 80 },
    // north loop
    { id: "sAirW", x: 1160, y: 280, w: 140, h: 100 },
    { id: "sAirE", x: 1700, y: 280, w: 150, h: 100 },
    { id: "sAirS", x: 1450, y: 420, w: 100, h: 80 },
    // south loop
    { id: "sLibN", x: 1450, y: 1060, w: 100, h: 80 },
    { id: "sLibW", x: 1180, y: 1220, w: 120, h: 100 },
    { id: "sLibE", x: 1700, y: 1220, w: 150, h: 100 },
    // west tail
    { id: "tail", x: 150, y: 380, w: 110, h: 860 },
    { id: "sTailG", x: 260, y: 400, w: 40, h: 100 },
    { id: "sTailH", x: 260, y: 730, w: 140, h: 100 },
    { id: "sTailE", x: 260, y: 1120, w: 40, h: 100 },
    // east side passages
    { id: "sKitCom", x: 2350, y: 300, w: 70, h: 100 },
    { id: "sStoFuel", x: 2370, y: 1200, w: 80, h: 100 }
  ],

  // Doors the saboteur can slam shut for a few seconds (per room).
  doors: [
    { room: "majlis", x: 1236, y: 710, w: 16, h: 140 },
    { room: "majlis", x: 1750, y: 710, w: 16, h: 140 },
    { room: "majlis", x: 1450, y: 484, w: 100, h: 16 },
    { room: "majlis", x: 1450, y: 1060, w: 100, h: 16 },
    { room: "generator", x: 460, y: 560, w: 100, h: 16 },
    { room: "generator", x: 284, y: 400, w: 16, h: 100 },
    { room: "security", x: 930, y: 560, w: 100, h: 16 },
    { room: "security", x: 1160, y: 280, w: 16, h: 100 },
    { room: "air", x: 1284, y: 280, w: 16, h: 100 },
    { room: "air", x: 1700, y: 280, w: 16, h: 100 },
    { room: "air", x: 1450, y: 420, w: 100, h: 16 },
    { room: "kitchen", x: 2050, y: 560, w: 100, h: 16 },
    { room: "kitchen", x: 1834, y: 280, w: 16, h: 100 },
    { room: "kitchen", x: 2350, y: 300, w: 16, h: 100 },
    { room: "comms", x: 2630, y: 520, w: 100, h: 16 },
    { room: "comms", x: 2404, y: 300, w: 16, h: 100 },
    { room: "engines", x: 460, y: 984, w: 100, h: 16 },
    { room: "engines", x: 284, y: 1120, w: 16, h: 100 },
    { room: "medbay", x: 960, y: 984, w: 100, h: 16 },
    { room: "medbay", x: 1180, y: 1220, w: 16, h: 100 },
    { room: "library", x: 1450, y: 1124, w: 100, h: 16 },
    { room: "library", x: 1284, y: 1220, w: 16, h: 100 },
    { room: "library", x: 1700, y: 1220, w: 16, h: 100 },
    { room: "storage", x: 2050, y: 984, w: 100, h: 16 },
    { room: "storage", x: 1834, y: 1220, w: 16, h: 100 },
    { room: "storage", x: 2370, y: 1200, w: 16, h: 100 },
    { room: "fuel", x: 2630, y: 1024, w: 100, h: 16 },
    { room: "fuel", x: 2434, y: 1200, w: 16, h: 100 },
    { room: "cockpit", x: 2544, y: 710, w: 16, h: 140 },
    { room: "cockpit", x: 2630, y: 600, w: 100, h: 16 },
    { room: "cockpit", x: 2630, y: 944, w: 100, h: 16 }
  ],

  // Crew tasks. `type` selects the mini-game in public/client/tasks.js
  tasks: [
    { id: "coffee", name: "تحضير القهوة", room: "kitchen", x: 1960, y: 240, type: "pour" },
    { id: "dates", name: "تقديم التمر", room: "kitchen", x: 2270, y: 490, type: "sequence" },
    { id: "course", name: "ضبط المسار", room: "cockpit", x: 2860, y: 780, type: "slider" },
    { id: "radio", name: "ضبط التردد", room: "comms", x: 2720, y: 250, type: "slider" },
    { id: "wires", name: "إصلاح الأسلاك", room: "generator", x: 370, y: 250, type: "wires" },
    { id: "power", name: "توزيع الطاقة", room: "generator", x: 650, y: 490, type: "switches" },
    { id: "engineFuel", name: "تعبئة المحرك", room: "engines", x: 370, y: 1330, type: "hold" },
    { id: "filter", name: "تنظيف المرشح", room: "engines", x: 690, y: 1060, type: "clicks" },
    { id: "cargo", name: "ترتيب الشحنة", room: "storage", x: 2300, y: 1350, type: "sequence" },
    { id: "scan", name: "الفحص الطبي", room: "medbay", x: 1015, y: 1220, type: "scan" },
    { id: "locks", name: "تحديث الأقفال", room: "security", x: 1090, y: 270, type: "code" },
    { id: "incense", name: "إشعال البخور", room: "majlis", x: 1310, y: 1000, type: "clicks" },
    { id: "gauge", name: "معايرة الضغط", room: "fuel", x: 2760, y: 1340, type: "slider" },
    { id: "airClean", name: "تنقية الهواء", room: "air", x: 1360, y: 190, type: "clicks" },
    { id: "valves", name: "ضبط الصمامات", room: "air", x: 1640, y: 360, type: "switches" },
    { id: "scrolls", name: "ترتيب المخطوطات", room: "library", x: 1360, y: 1190, type: "sequence" },
    { id: "cipher", name: "فك الشيفرة", room: "library", x: 1650, y: 1400, type: "code" }
  ],

  // Secret hatches for the saboteur. Linked hatches can be travelled between while hidden.
  vents: [
    { id: "vGen", x: 650, y: 290, links: ["vTail", "vSec"] },
    { id: "vTail", x: 205, y: 900, links: ["vGen", "vEng"] },
    { id: "vEng", x: 660, y: 1330, links: ["vTail", "vMed"] },
    { id: "vSec", x: 860, y: 500, links: ["vGen", "vAir"] },
    { id: "vAir", x: 1640, y: 200, links: ["vSec", "vKit"] },
    { id: "vMed", x: 1120, y: 1070, links: ["vEng", "vLib"] },
    { id: "vLib", x: 1360, y: 1400, links: ["vMed", "vSto"] },
    { id: "vKit", x: 2290, y: 270, links: ["vAir", "vCock"] },
    { id: "vCock", x: 2620, y: 900, links: ["vKit", "vFuel"] },
    { id: "vSto", x: 1910, y: 1360, links: ["vLib", "vFuel"] },
    { id: "vFuel", x: 2510, y: 1340, links: ["vCock", "vSto"] }
  ],

  // Security room console and the cameras it shows.
  console: { x: 960, y: 270 },
  cameras: [
    { name: "الممر الغربي", x: 820, y: 780 },
    { name: "الممر الشرقي", x: 2150, y: 780 },
    { name: "ممر الذيل", x: 205, y: 780 },
    { name: "باب المكتبة", x: 1500, y: 1180 }
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
