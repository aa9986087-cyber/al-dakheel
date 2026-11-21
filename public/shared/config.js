// Shared constants: used by the browser client and by the server (Node dev server and Cloudflare Durable Object).

export const COLORS = [
  { id: "crimson", hex: "#c0392b", name: "عنابي" },
  { id: "saffron", hex: "#e6a817", name: "زعفراني" },
  { id: "teal", hex: "#16a085", name: "فيروزي" },
  { id: "indigo", hex: "#3f51b5", name: "نيلي" },
  { id: "rose", hex: "#e8789a", name: "وردي" },
  { id: "olive", hex: "#7f9a2e", name: "زيتوني" },
  { id: "sand", hex: "#d9b98a", name: "رملي" },
  { id: "plum", hex: "#8e44ad", name: "بنفسجي" },
  { id: "copper", hex: "#c8642a", name: "نحاسي" },
  { id: "sky", hex: "#4fb3e8", name: "سماوي" },
  { id: "charcoal", hex: "#4a4a55", name: "فحمي" },
  { id: "ivory", hex: "#f2ead8", name: "عاجي" }
];

export const MAX_PLAYERS = 12;
export const MIN_PLAYERS = 3;

export const PLAYER_R = 18; // collision radius (world px)
export const BASE_SPEED = 250; // px per second at speed 1
export const VISION = 330; // base vision radius
export const LIGHTS_OFF_VISION = 120;

export const KILL_RANGE = 95;
export const REPORT_RANGE = 160;
export const USE_RANGE = 95;
export const VENT_RANGE = 75;
export const BUTTON_RANGE = 165;

export const TICK_MS = 66; // server tick (~15 Hz)

export const TIMES = {
  roleReveal: 4000, // role screen before play actually starts
  eject: 9500, // ~3s vote reveal + ejection scene
  afterMeeting: 12000, // emergency button + sabotage cooldown after a meeting
  critical: 45000, // fuel leak countdown
  doors: 10000,
  sabotageCooldown: 30000,
  disconnectGrace: 60000,
  lobbyGrace: 8000,
  emptyRoom: 10 * 60000
};

// Room settings the host can change in the lobby: [default, min, max, step]
export const SETTINGS = {
  impostors: { def: 1, min: 1, max: 3, step: 1, label: "عدد الدخلاء" },
  killCooldown: { def: 25, min: 10, max: 60, step: 5, label: "تهدئة الإقصاء (ث)" },
  speed: { def: 1, min: 0.75, max: 1.5, step: 0.25, label: "سرعة اللاعبين" },
  vision: { def: 1, min: 0.5, max: 1.5, step: 0.25, label: "مدى رؤية الطاقم" },
  tasks: { def: 5, min: 2, max: 8, step: 1, label: "عدد المهام" },
  voting: { def: 90, min: 30, max: 180, step: 15, label: "مدة الاجتماع (ث)" },
  emergencies: { def: 1, min: 0, max: 3, step: 1, label: "اجتماعات الطوارئ لكل لاعب" },
  confirmEjects: { def: 1, min: 0, max: 1, step: 1, label: "كشف هوية المطرود" }
};

export function defaultSettings() {
  const s = {};
  for (const [k, v] of Object.entries(SETTINGS)) s[k] = v.def;
  return s;
}

export function clampSetting(key, value) {
  const def = SETTINGS[key];
  if (!def) return undefined;
  let v = Number(value);
  if (!Number.isFinite(v)) return def.def;
  v = Math.min(def.max, Math.max(def.min, v));
  return Math.round(v / def.step) * def.step;
}

/** Most impostors allowed for a player count: impostors must stay a clear minority. */
export function maxImpostors(n) {
  if (n <= 5) return 1;
  if (n <= 8) return 2;
  return 3;
}

// Room codes are five digits. Digits typed on an Arabic keyboard (٠-٩, ۰-۹) count as the same code.
export const ROOM_CODE_CHARS = "0123456789";
export const ROOM_CODE_LEN = 5;

export function normalizeCode(code) {
  return String(code || "")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^0-9]/g, "")
    .slice(0, ROOM_CODE_LEN);
}

export function isValidCode(code) {
  return code.length === ROOM_CODE_LEN && [...code].every((c) => ROOM_CODE_CHARS.includes(c));
}

export function randomCode(random = Math.random) {
  let s = "";
  for (let i = 0; i < ROOM_CODE_LEN; i++) s += ROOM_CODE_CHARS[Math.floor(random() * ROOM_CODE_CHARS.length)];
  return s;
}

export function cleanName(name) {
  return String(name || "")
    .replace(/[\u0000-\u001f<>]/g, "")
    .trim()
    .slice(0, 14);
}
