import { COLORS, SETTINGS, BASE_SPEED, VISION, LIGHTS_OFF_VISION, KILL_RANGE, REPORT_RANGE, USE_RANGE, VENT_RANGE, BUTTON_RANGE, normalizeCode, isValidCode, MIN_PLAYERS, cleanName, maxImpostors } from "../shared/config.js";
import { MAP, TASK_BY_ID, VENT_BY_ID, ROOM_BY_ID, roomAt } from "../shared/map.js";
import { moveWithCollision, closedDoorRects, lineClear, visionPolygon, dist } from "../shared/geom.js";
import { Net } from "./net.js";
import { Input } from "./input.js";
import { Renderer, drawCharacter, colorHex, Sky, drawAirship, medallion } from "./render.js";
import { mountGame } from "./tasks.js";
import { sfx, toggleMute, isMuted } from "./audio.js";
import { icon } from "./icons.js";

const $ = (id) => document.getElementById(id);
const AR = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => AR[d]);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
};
const TAU = Math.PI * 2;

function paintIcons(root = document) {
  root.querySelectorAll("i[data-icon]").forEach((i) => { i.outerHTML = icon(i.dataset.icon); });
}

// ---------- app state ----------
let net = null;
let S = null; // latest server snapshot
let myId = null;
let renderer = null;
let input = null;
const me = { x: MAP.spawn.x, y: MAP.spawn.y, tp: -1, walk: 0, facing: 1, face: 1, moving: false, ready: false, dustAt: 0 };
const cam = { x: MAP.spawn.x, y: MAP.spawn.y };
const others = new Map(); // id -> render state
const doorAnim = new Map(); // room -> { closed, t }
let lastSent = 0, sentX = 0, sentY = 0;
let modal = null; // { kind, cleanup }
let prevPhase = null;
let pendingVote = null;
let wantBots = 0; // bots to add once the room we just created answers

// ---------- iPhone Safari guards ----------
// Safari ignores user-scalable=no: a pinch or a quick double tap would zoom the whole game and leave it
// zoomed. Text fields keep their normal behaviour.
const typing = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
for (const type of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 320 && !typing(e.target) && e.cancelable) {
    // A second tap this soon is a zoom gesture to Safari; keep it a tap by clicking it ourselves.
    e.preventDefault();
    const btn = e.target.closest?.("button:not([disabled]), .swatch, .vote-card");
    btn?.click();
  }
  lastTouchEnd = now;
}, { passive: false });
// Coming back to the tab (after locking the phone or switching apps): check the room link right away.
const wakeNet = () => { if (!document.hidden) net?.wake?.(); };
document.addEventListener("visibilitychange", wakeNet);
addEventListener("pageshow", wakeNet);
let meetingShownAt = 0;
let seenStamps = new Set();
let profile = { name: store.get("dakheel-name") || "", color: store.get("dakheel-color") || COLORS[0].id };
const liveAvatars = new Set(); // { canvas, color, opts } redrawn every frame (idle animation)

// ---------- helpers ----------
const player = (id) => S && S.players.find((p) => p.id === id);
const myPlayer = () => player(myId);
const serverNow = () => (net ? net.serverNow() : Date.now());
const amImp = () => S && S.role === "imp" && S.phase !== "lobby";
const amAlive = () => !S || S.phase === "lobby" || S.alive !== false;

function toast(text, ms = 2600) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), ms);
}

/** A character portrait. live=true keeps it gently animated (breathing, blinking). */
function avatar(colorId, size = 44, opts = {}, live = false) {
  const c = document.createElement("canvas");
  const d = Math.min(2, devicePixelRatio || 1);
  c.width = size * d; c.height = size * d;
  c.style.width = c.style.height = size + "px";
  const a = { canvas: c, color: colorId, opts, d, size, seed: Math.random() * 10 };
  paintAvatar(a, performance.now() / 1000);
  if (live) liveAvatars.add(a);
  return c;
}
function paintAvatar(a, t) {
  const g = a.canvas.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, a.canvas.width, a.canvas.height);
  g.scale((a.d * a.size) / 64, (a.d * a.size) / 64);
  drawCharacter(g, 32, 42, a.color, { ...a.opts, scale: (a.opts.scale || 1) * 0.95, t: t + a.seed, seed: a.seed, facing: a.opts.facing ?? 1 });
}
function tickAvatars(t) {
  if (t - avatarAt < (eco ? 1 / 12 : 1 / 24)) return; // portraits breathe slowly; no need for full frame rate
  avatarAt = t;
  for (const a of liveAvatars) {
    if (!a.canvas.isConnected) { liveAvatars.delete(a); continue; }
    paintAvatar(a, t);
  }
}

function show(id, on = true) { $(id).classList.toggle("hidden", !on); }

// ---------- performance: battery saver + frame cap ----------
// iPhones run screens at up to 120 Hz and heat up quickly; the game is capped at 60 fps everywhere, and battery saver
// (default on for phones and tablets) drops to 30 fps at native 1x resolution with fewer effects.
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const PHONE = IOS || matchMedia("(pointer: coarse)").matches;
let eco = (() => { const v = store.get("dakheel-eco"); return v === null ? PHONE : v === "1"; })();
const fpsCap = () => (eco ? 30 : 60);
let avatarAt = 0;

// ---------- menu sky (home screen) ----------
const heroSky = new Sky();
let heroOn = true, heroRunning = false, heroLast = 0;
function startHero() { if (!heroRunning) { heroRunning = true; requestAnimationFrame(heroLoop); } }
function heroLoop(now) {
  if (!heroOn) { heroRunning = false; return; }
  requestAnimationFrame(heroLoop);
  if (now - heroLast < 1000 / (eco ? 20 : 30) - 2) return;
  heroLast = now;
  const t = now / 1000;
  const cv = $("heroSky");
  {
    const d = eco ? 1 : Math.min(1.5, devicePixelRatio || 1);
    if (cv.width !== Math.round(innerWidth * d) || cv.height !== Math.round(innerHeight * d)) { cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d); }
    const g = cv.getContext("2d");
    heroSky.draw(g, cv.width, cv.height, t, t * 30, d, 2);
    const s = Math.min(cv.width / 1100, cv.height / 900) * 1.05;
    drawAirship(g, cv.width * 0.5 + Math.sin(t * 0.3) * 30 * d, cv.height * (innerWidth < 700 ? 0.86 : 0.8), s, t);
    // desert dunes far below
    g.fillStyle = "rgba(20,10,20,.85)";
    g.beginPath(); g.moveTo(0, cv.height);
    for (let x = 0; x <= cv.width; x += 40) g.lineTo(x, cv.height - 30 * d - Math.sin(x / (180 * d) + t * 0.05) * 18 * d);
    g.lineTo(cv.width, cv.height); g.fill();
    tickAvatars(t);
  }
}

// ---------- home screen ----------
function buildColorGrid(el, onPick, taken = new Set(), selected) {
  el.innerHTML = "";
  for (const c of COLORS) {
    const b = document.createElement("button");
    b.className = "swatch" + (c.id === selected ? " sel" : "") + (taken.has(c.id) ? " taken" : "");
    b.title = c.name;
    b.type = "button";
    b.style.background = `radial-gradient(circle at 50% 70%, ${c.hex}55, #1c110c)`;
    b.append(avatar(c.id, 48, { scale: 1 }));
    b.onclick = () => { if (!taken.has(c.id)) onPick(c.id); };
    el.append(b);
  }
}

let previewAvatar = null;
function paintPreview() {
  const cv = $("previewChar");
  if (!previewAvatar) {
    previewAvatar = { canvas: cv, color: profile.color, opts: { scale: 1 }, d: cv.width / 140, size: 140, seed: 1 };
    liveAvatars.add(previewAvatar);
  }
  previewAvatar.color = profile.color;
  $("previewName").textContent = cleanName($("nameInput").value) || "ضيف";
}

function homeInit() {
  $("nameInput").value = profile.name;
  const paint = () => {
    buildColorGrid($("colorPick"), (id) => { profile.color = id; paint(); sfx.vote(); }, new Set(), profile.color);
    paintPreview();
  };
  paint();
  $("nameInput").addEventListener("input", paintPreview);
  const params = new URLSearchParams(location.search);
  const code = normalizeCode(params.get("room"));
  if (code) $("codeInput").value = code;
  const create = async (bots) => {
    if (!readName() || $("createBtn").disabled) return;
    $("createBtn").disabled = $("botsBtn").disabled = true;
    try {
      const { code } = await Net.newCode();
      wantBots = bots;
      enterRoom(code, true);
    } catch {
      $("homeMsg").textContent = "تعذّر إنشاء الغرفة، تأكد من الاتصال.";
    } finally { $("createBtn").disabled = $("botsBtn").disabled = false; }
  };
  $("createBtn").onclick = () => create(0);
  // Playing with bots is a normal room the player hosts, filled with computer players straight away.
  $("botsBtn").onclick = () => create(5);
  const join = () => {
    if (!readName()) return;
    const c = normalizeCode($("codeInput").value);
    if (!isValidCode(c)) { $("homeMsg").textContent = "رمز الغرفة من ٥ خانات."; return; }
    enterRoom(c, false);
  };
  $("joinBtn").onclick = join;
  $("codeInput").addEventListener("keydown", (e) => e.key === "Enter" && join());
  $("nameInput").addEventListener("keydown", (e) => e.key === "Enter" && (code ? join() : $("createBtn").click()));
  if (code && profile.name && store.get("dakheel-token-" + code)) enterRoom(code, false);
}

function readName() {
  const n = cleanName($("nameInput").value);
  if (!n) { $("homeMsg").textContent = "اكتب اسمك أولاً."; $("nameInput").focus(); return false; }
  profile.name = n;
  store.set("dakheel-name", n);
  store.set("dakheel-color", profile.color);
  return true;
}

function enterRoom(code, create) {
  // A double tap on «انضمام» or «إنشاء» must not open a second connection to the same room.
  if (net) return;
  sfx.unlock();
  try { history.replaceState(null, "", "?room=" + code); } catch { /* sandboxed */ }
  $("home").classList.remove("active");
  $("game").classList.add("active");
  heroOn = false;
  $("heroSky").classList.add("hidden");
  if (!renderer) startGame();
  net = new Net({ code, create, onMessage, onStatus: (s) => show("netState", s === "lost") });
  net.connect(() => ({ token: store.get("dakheel-token-" + code) || "", name: profile.name, color: profile.color }));
}

function leaveToHome(text) {
  net?.close();
  net = null; S = null; prevPhase = null;
  closeModal();
  for (const id of ["lobby", "meeting", "eject", "end", "reveal", "lobbyShow", "splash", "koScene", "leaveAsk"]) show(id, false);
  $("game").classList.remove("active");
  $("home").classList.add("active");
  heroOn = true;
  startHero();
  $("heroSky").classList.remove("hidden");
  $("homeMsg").textContent = text || "";
  try { history.replaceState(null, "", location.pathname); } catch { /* sandboxed */ }
}

// ---------- network messages ----------
function onMessage(msg) {
  switch (msg.t) {
    case "welcome":
      myId = msg.id;
      store.set("dakheel-token-" + msg.code, msg.token);
      break;
    case "error": {
      const why = { not_found: "الغرفة غير موجودة أو انتهت.", started: "اللعبة بدأت في هذه الغرفة، انتظر الجولة القادمة.", full: "الغرفة ممتلئة." }[msg.reason] || "حدث خطأ.";
      leaveToHome(why);
      break;
    }
    case "toast": toast(msg.text); break;
    case "state": onState(msg); break;
    case "p": onPositions(msg.d); break;
    case "ko": showKnockout(msg.by); break;
    case "kodone":
      renderer.shake = 0.6;
      renderer.fx.puff(me.x, me.y - 10, 18);
      sfx.kill();
      break;
  }
}

function onPositions(d) {
  const seen = new Set();
  const now = performance.now();
  for (const [id, x, y, flags, tp] of d) {
    if (id === myId) {
      if (tp !== me.tp || !me.ready) { me.x = x; me.y = y; me.tp = tp; me.ready = true; }
      continue;
    }
    seen.add(id);
    let o = others.get(id);
    if (!o) { o = { x, y, tx: x, ty: y, walk: 0, facing: 1, face: 1, moving: false, seed: Math.random() * 10, dustAt: 0 }; others.set(id, o); }
    if (Math.hypot(x - o.tx, y - o.ty) > 300) { o.x = x; o.y = y; }
    o.tx = x; o.ty = y;
    o.ghost = !!(flags & 1);
    const vented = !!(flags & 2);
    if (vented !== !!o.vented) { renderer.fx.puff(o.x, o.y, 8, "60,40,30"); sfx.vent(); }
    o.vented = vented;
    o.seenAt = now;
  }
  for (const [id, o] of others) {
    if (seen.has(id)) continue;
    // Someone vanished next to a hatch: show the hatch puffing.
    if (S && S.phase === "play" && MAP.vents.some((v) => dist(v, o) < 60)) renderer.fx.puff(o.x, o.y, 10, "60,40,30");
    others.delete(id);
  }
}

function onState(s) {
  const old = S;
  S = s;
  if (net.bestRtt === Infinity) net.offset = s.now - Date.now();
  myId = s.me;
  document.body.classList.toggle("is-imp", amImp());
  const phase = s.phase;
  if (phase !== prevPhase) onPhaseChange(prevPhase, phase, old);
  prevPhase = phase;

  if (old && old.phase === "play" && phase === "play") {
    if (s.sab && !old.sab) { sfx.alarm(); toast(sabText(s.sab)); }
    if (!s.sab && old.sab) toast("تم إصلاح العطل ✔");
    const doneNow = (s.tasks || []).filter((t) => t.done).length, doneBefore = (old.tasks || []).filter((t) => t.done).length;
    if (doneNow > doneBefore) { renderer.fx.sparkle(me.x, me.y - 20, 24); }
    for (const b of s.bodies || []) if (!(old.bodies || []).some((x) => x.id === b.id)) renderer.fx.puff(b.x, b.y, 16);
    if (old.vent !== s.vent) renderer.fx.puff(me.x, me.y, 12, "60,40,30");
  }
  // door animation bookkeeping
  const closed = new Set(s.phase === "play" ? s.doorsClosed || [] : []);
  const t = performance.now() / 1000;
  for (const d of MAP.doors) {
    const st = doorAnim.get(d.room);
    const isClosed = closed.has(d.room);
    if (!st || st.closed !== isClosed) doorAnim.set(d.room, { closed: isClosed, t: st || isClosed ? t : t - 1 });
  }
  if (modal && modal.kind === "fuel" && (!s.sab || s.sab.kind !== "fuel")) closeModal();
  if (modal && modal.kind === "fix" && (!s.sab || s.sab.kind !== modal.fix)) closeModal();

  renderLobby();
  renderHud(old);
  if (phase === "meeting" || phase === "eject") renderMeeting();
  if (phase === "end") renderEnd();
}

let ejectTimer = 0, splashTimer = 0;
function onPhaseChange(from, to) {
  closeModal();
  pendingVote = null;
  show("lobby", to === "lobby" && !lobbyHidden);
  show("lobbyShow", to === "lobby" && lobbyHidden);
  show("end", to === "end");
  if (to !== "meeting" && to !== "eject") show("meeting", false);
  if (to !== "eject") { show("eject", false); stopEject(); }
  clearTimeout(ejectTimer); clearTimeout(splashTimer);
  if (to === "play" && (from === "lobby" || from === "end" || from === null) && S.playStartsAt > serverNow()) showReveal();
  if (to === "meeting") {
    $("chatLog").innerHTML = "";
    seenStamps = new Set();
    show("koScene", false);
    const report = S.meeting.reason === "report";
    (report ? sfx.report : sfx.bell)();
    $("splash").className = "overlay splash" + (report ? "" : " emergency");
    $("splashIcon").innerHTML = icon(report ? "report" : "bell");
    $("splashText").textContent = report ? "بلاغ!" : "اجتماع طارئ!";
    const caller = player(S.meeting.caller);
    $("splashSub").textContent = caller ? (report ? `بلاغ من ${caller.name}: راكب مُقصى` : `الجرس من ${caller.name}`) : "";
    show("splash");
    show("meeting", false);
    splashTimer = setTimeout(() => { show("splash", false); show("meeting"); meetingShownAt = performance.now(); renderMeeting(); }, 1900);
  }
  if (to === "eject") {
    show("splash", false);
    show("meeting");
    renderMeeting();
    ejectTimer = setTimeout(() => { show("meeting", false); startEject(); }, 3200);
  }
  if (to === "end") { (S.result.winner === S.role ? sfx.win : sfx.lose)(); startConfetti(S.result.winner); }
  else stopConfetti();
  if (to === "lobby") others.clear();
}

// ---------- role reveal ----------
function showReveal() {
  const imp = S.role === "imp";
  sfx.start();
  $("revealTitle").textContent = imp ? "أنت الدخيل" : "أنت من الطاقم";
  $("revealTitle").className = "reveal-title" + (imp ? " imp" : "");
  const n = S.players.filter((p) => !p.left).length;
  const imps = Math.min(S.settings.impostors, maxImpostors(n));
  $("revealSub").textContent = imp ? "أقصِ الركاب بهدوء، خرّب الأنظمة، ولا تنكشف" : `بيننا ${ar(imps)} ${imps > 1 ? "دخلاء" : "دخيل"} — أنجز مهامك وراقب الجميع`;
  const mates = $("revealMates");
  mates.innerHTML = "";
  const list = imp ? S.players.filter((p) => p.role === "imp") : S.players.filter((p) => !p.left);
  list.sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : 0));
  list.forEach((p, i) => {
    const f = document.createElement("figure");
    f.style.animationDelay = 0.5 + i * 0.08 + "s";
    f.append(avatar(p.color, p.id === myId ? 96 : 72, {}, true));
    const cap = document.createElement("figcaption");
    cap.textContent = p.name;
    if (imp) cap.style.color = "#ff9a9a";
    f.append(cap);
    mates.append(f);
  });
  show("reveal");
  setTimeout(() => show("reveal", false), Math.max(1800, S.playStartsAt - serverNow()));
}

// ---------- knockout scene (only for the knocked-out player) ----------
function showKnockout(byId) {
  const killer = player(byId), mine = myPlayer();
  if (!killer || !mine) return;
  sfx.kill();
  const draw = (cv, color, opts) => {
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    g.save(); g.scale(cv.width / 64, cv.height / 64); drawCharacter(g, 32, 44, color, opts); g.restore();
  };
  draw($("koKiller"), killer.color, { facing: 1, moving: true, walk: 1 });
  draw($("koVictim"), mine.color, { facing: -1, dead: true });
  $("koText").textContent = `أقصاك ${killer.name}!`;
  const sc = $("koScene");
  sc.classList.remove("hidden");
  for (const el of sc.querySelectorAll("canvas, .ko-puff, .ko-text")) { el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; }
  setTimeout(() => show("koScene", false), 2600);
}

// ---------- lobby ----------
let lobbyHidden = false;
function renderLobby() {
  if (!S || S.phase !== "lobby") return;
  const mine = myPlayer();
  if (wantBots && mine?.host) { net.send({ t: "bots", n: wantBots }); wantBots = 0; }
  $("roomCode").textContent = S.code;
  const list = $("lobbyPlayers");
  list.innerHTML = "";
  for (const p of S.players) {
    const li = document.createElement("li");
    li.className = (p.connected ? "" : "off") + (p.id === myId ? " me" : "");
    li.append(avatar(p.color, 36));
    const nm = document.createElement("span");
    nm.textContent = p.name + (p.id === myId ? " (أنت)" : "");
    li.append(nm);
    if (p.bot) { const t = document.createElement("span"); t.className = "bot-tag"; t.textContent = "بوت"; li.append(t); }
    if (p.host) { const c = document.createElement("span"); c.className = "crown"; c.title = "المضيف"; c.innerHTML = icon("crown"); li.append(c); }
    list.append(li);
  }
  $("playerCount").textContent = `(${ar(S.players.length)}/١٢)`;
  if (document.activeElement !== $("lobbyName")) $("lobbyName").value = mine?.name || "";
  const taken = new Set(S.players.filter((p) => p.id !== myId).map((p) => p.color));
  buildColorGrid($("lobbyColors"), (id) => { profile.color = id; store.set("dakheel-color", id); net.send({ t: "profile", color: id }); }, taken, mine?.color);

  const host = !!mine?.host;
  const box = $("settingsBox");
  box.innerHTML = "";
  const bots = S.players.filter((p) => p.bot).length;
  const botRow = document.createElement("div");
  botRow.className = "setting";
  botRow.innerHTML = `<span>اللاعبون الآليون</span><div class="stepper"><button ${!host || bots <= 0 ? "disabled" : ""} data-bots="-1">−</button><b>${ar(bots)}</b><button ${!host || S.players.length >= 12 ? "disabled" : ""} data-bots="1">+</button></div>`;
  box.append(botRow);
  for (const [key, def] of Object.entries(SETTINGS)) {
    const v = S.settings[key];
    const row = document.createElement("div");
    row.className = "setting";
    const shown = key === "confirmEjects" ? (v ? "نعم" : "لا") : key === "speed" || key === "vision" ? ar(v) + "×" : ar(v);
    row.innerHTML = `<span>${def.label}</span><div class="stepper"><button ${!host || v <= def.min ? "disabled" : ""} data-k="${key}" data-d="-1">−</button><b>${shown}</b><button ${!host || v >= def.max ? "disabled" : ""} data-k="${key}" data-d="1">+</button></div>`;
    box.append(row);
  }
  botRow.querySelectorAll("button").forEach((b) => {
    b.onclick = () => { net.send({ t: "bots", n: bots + Number(b.dataset.bots) }); sfx.vote(); };
  });
  box.querySelectorAll("button[data-k]").forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.k, def = SETTINGS[k];
      net.send({ t: "settings", values: { [k]: S.settings[k] + def.step * Number(b.dataset.d) } });
      sfx.vote();
    };
  });
  const n = S.players.filter((p) => p.connected).length;
  $("startBtn").classList.toggle("hidden", !host);
  $("startBtn").disabled = n < MIN_PLAYERS;
  $("lobbyHint").textContent = host
    ? n < MIN_PLAYERS ? `بانتظار اللاعبين… تحتاج ${ar(MIN_PLAYERS)} على الأقل (الأفضل ٥ فأكثر)، أو أضف لاعبين آليين من الإعدادات` : "كل شيء جاهز! اضغط ابدأ عندما يكتمل الجميع."
    : "بانتظار المضيف ليبدأ الرحلة. تجوّل في الطائرة حتى ذلك الحين!";
}

function lobbyInit() {
  const link = () => `${location.origin}${location.pathname}?room=${S.code}`;
  $("copyLink").onclick = async () => {
    try { await navigator.clipboard.writeText(link()); toast("تم نسخ رابط الدعوة"); } catch { toast(link(), 6000); }
  };
  $("shareLink").onclick = async () => {
    if (navigator.share) { try { await navigator.share({ title: "الدخيل", text: `انضم لغرفتي في لعبة الدخيل — الرمز ${S.code}`, url: link() }); } catch { /* cancelled */ } }
    else $("copyLink").click();
  };
  $("lobbyToggle").onclick = () => { lobbyHidden = true; show("lobby", false); show("lobbyShow"); };
  $("lobbyShow").onclick = () => { lobbyHidden = false; show("lobby"); show("lobbyShow", false); };
  $("lobbyNameSave").onclick = () => {
    const n = cleanName($("lobbyName").value);
    if (!n) return;
    profile.name = n; store.set("dakheel-name", n);
    net.send({ t: "profile", name: n });
    $("lobbyName").blur();
  };
  $("lobbyName").addEventListener("keydown", (e) => e.key === "Enter" && $("lobbyNameSave").click());
  $("startBtn").onclick = () => net.send({ t: "start" });
  $("homeBtn").onclick = () => show("leaveAsk");
  $("leaveNo").onclick = () => show("leaveAsk", false);
  $("leaveYes").onclick = () => { show("leaveAsk", false); leaveToHome(); };
  $("againBtn").onclick = () => net.send({ t: "lobby" });
}

// ---------- HUD ----------
function sabText(sab) {
  if (!sab) return "";
  if (sab.kind === "lights") return "الأنوار مطفأة! أصلحها من غرفة الكهرباء";
  if (sab.kind === "comms") return "الاتصالات مقطوعة! أصلحها من غرفة الاتصالات";
  if (sab.kind === "fuel") {
    const left = Math.max(0, Math.ceil((sab.endsAt - serverNow()) / 1000));
    return `خلل في المحرك الرئيسي! ${ar(left)} ث — أمسكوا لوحتي المحرك معًا [${ar(sab.a || 0)}/${ar(sab.b || 0)}]`;
  }
  return "";
}

function renderHud(old) {
  if (!S) return;
  const inGame = S.phase !== "lobby";
  show("taskPanel", inGame);
  show("roleTag", inGame);
  if (!inGame) { show("sabBanner", false); return; }
  const imp = amImp();
  $("roleTag").className = "role-tag" + (imp ? " imp" : "");
  const mates = S.players.filter((p) => p.role === "imp" && p.id !== myId).map((p) => p.name);
  $("roleTag").innerHTML = icon(S.alive ? (imp ? "kill" : "users") : "ghost") + `<span>${esc((imp ? "أنت الدخيل" + (mates.length ? " — مع " + mates.join("، ") : "") : "أنت من الطاقم") + (S.alive ? "" : " · روح"))}</span>`;
  const bar = $("taskBar");
  if (S.progress == null) { bar.style.width = "0"; $("taskBarLabel").textContent = "الاتصالات مقطوعة"; }
  else { bar.style.width = `calc(${S.progress * 100}% - 6px)`; $("taskBarLabel").textContent = `مهام الطاقم ${ar(Math.round(S.progress * 100))}٪`; }
  const ul = $("taskList");
  ul.innerHTML = "";
  if (S.sab && S.sab.kind !== "doors") {
    const li = document.createElement("li"); li.className = "sab"; li.textContent = sabText(S.sab).split("!")[0] + "!"; ul.append(li);
  }
  if (imp) { const li = document.createElement("li"); li.className = "fake"; li.textContent = "مهام وهمية للتمويه:"; ul.append(li); }
  const wasDone = new Set((old?.tasks || []).filter((t) => t.done).map((t) => t.id));
  for (const t of S.tasks || []) {
    const def = TASK_BY_ID[t.id];
    const li = document.createElement("li");
    li.className = (t.done ? "done" : "") + (t.done && old && !wasDone.has(t.id) ? " fresh" : "");
    li.textContent = `${ROOM_BY_ID[def.room].name}: ${def.name}`;
    ul.append(li);
  }
}

function updateBanner() {
  const on = S && S.phase === "play" && S.sab && S.sab.kind !== "doors";
  show("sabBanner", !!on);
  if (on) $("sabBanner").textContent = sabText(S.sab);
}

// ---------- interactions ----------
function doorRects() { return S && S.phase === "play" ? closedDoorRects(S.doorsClosed) : []; }

function nearestUse() {
  if (!S || S.phase !== "play" || serverNow() < S.playStartsAt || S.vent) return null;
  const alive = S.alive;
  const opts = [];
  if (S.role === "crew") for (const t of S.tasks) if (!t.done) { const d = TASK_BY_ID[t.id]; opts.push({ kind: "task", id: t.id, x: d.x, y: d.y, r: USE_RANGE }); }
  if (alive) {
    if (S.sab?.kind === "lights") opts.push({ kind: "fix", fix: "lights", ...MAP.fixes.lights, r: USE_RANGE });
    if (S.sab?.kind === "comms") opts.push({ kind: "fix", fix: "comms", ...MAP.fixes.comms, r: USE_RANGE });
    if (S.sab?.kind === "fuel") {
      opts.push({ kind: "fuel", panel: "A", ...MAP.fixes.fuelA, r: USE_RANGE });
      opts.push({ kind: "fuel", panel: "B", ...MAP.fixes.fuelB, r: USE_RANGE });
    }
    opts.push({ kind: "bell", ...MAP.button, r: BUTTON_RANGE });
  }
  opts.push({ kind: "cams", ...MAP.console, r: USE_RANGE });
  opts.push({ kind: "admin", ...MAP.admin, r: USE_RANGE + 40 });
  let best = null, bd = Infinity;
  for (const o of opts) { const d = dist(me, o); if (d <= o.r && d < bd) { best = o; bd = d; } }
  return best;
}

function nearestBody() {
  if (!S || S.phase !== "play" || !S.alive || S.vent) return null;
  return (S.bodies || []).find((b) => dist(me, b) <= REPORT_RANGE && lineClear(me.x, me.y, b.x, b.y, doorRects()));
}

function killTarget() {
  if (!amImp() || S.phase !== "play" || !S.alive || S.vent || serverNow() < S.playStartsAt) return null;
  let best = null, bd = Infinity;
  for (const [id, o] of others) {
    const p = player(id);
    if (!p || o.ghost || o.vented || p.role === "imp" || p.left) continue;
    const d = dist(me, o);
    if (d <= KILL_RANGE && d < bd && lineClear(me.x, me.y, o.x, o.y, doorRects())) { best = id; bd = d; }
  }
  return best;
}

function nearVent() {
  if (!amImp() || S.phase !== "play" || !S.alive) return null;
  if (S.vent) return VENT_BY_ID[S.vent];
  return MAP.vents.find((v) => dist(me, v) <= VENT_RANGE) || null;
}

function use() {
  const u = nearestUse();
  if (!u || modal) return;
  if (u.kind === "task") openTask(u.id);
  else if (u.kind === "fix") openFix(u.fix);
  else if (u.kind === "fuel") openFuel(u.panel);
  else if (u.kind === "cams") openCams();
  else if (u.kind === "admin") openAdmin();
  else if (u.kind === "bell") {
    if (serverNow() < S.buttonReadyAt) return toast(`الجرس جاهز بعد ${ar(Math.ceil((S.buttonReadyAt - serverNow()) / 1000))} ث`);
    if (S.emergenciesLeft <= 0) return toast("استهلكت اجتماعات الطوارئ");
    if (S.sab?.kind === "fuel") return toast("لا يمكن قرع الجرس أثناء خلل المحرك!");
    net.send({ t: "emergency" });
  }
}

function report() { if (nearestBody()) net.send({ t: "report" }); }
function kill() { const id = killTarget(); if (id && serverNow() >= S.killReadyAt) net.send({ t: "kill", target: id }); }
function vent() {
  const v = nearVent();
  if (!v) return;
  sfx.vent();
  net.send({ t: "vent", action: S.vent ? "exit" : "enter" });
}

function openModal(kind, title, mount) {
  closeModal();
  $("taskTitle").textContent = title;
  show("taskModal");
  modal = { kind };
  modal.cleanup = mount($("taskBody"));
  return modal;
}

function closeModal() {
  if (!modal) return;
  if (modal.kind === "fuel") net?.send({ t: "hold", panel: modal.panel, on: false });
  modal.cleanup && modal.cleanup();
  modal = null;
  $("taskBody").style.minHeight = "";
  document.querySelector("#taskModal .task-box").style.width = "";
  show("taskModal", false);
  $("taskBody").innerHTML = "";
}

function finishModal(after) {
  $("taskBody").innerHTML = `<div class="mg-done">${icon("check")}</div>`;
  $("taskBody").firstChild.querySelector("svg").style.cssText = "width:110px;height:110px;stroke-width:3";
  sfx.task();
  after();
  setTimeout(closeModal, 650);
}

function openTask(id) {
  const def = TASK_BY_ID[id];
  openModal("task", def.name, (body) => mountGame(body, id, def.type, () => finishModal(() => net.send({ t: "task", id }))));
}

function openFix(kind) {
  const m = openModal("fix", kind === "lights" ? "إعادة الأنوار" : "إعادة الاتصالات", (body) =>
    mountGame(body, kind === "lights" ? "fixLights" : "fixComms", "switches", () => finishModal(() => net.send({ t: "fix", kind }))));
  m.fix = kind;
}

function openFuel(panel) {
  const m = openModal("fuel", "تثبيت المحرك الرئيسي", (body) => {
    body.innerHTML = `<div class="mg-note">اضغط مطوّلاً على اللوحة، ولاعب آخر يمسك اللوحة الثانية على الجهة الأخرى من المحرك في نفس الوقت</div>`;
    const b = document.createElement("button");
    b.className = "mg-hold"; b.innerHTML = icon("use");
    b.firstChild.style.cssText = "width:70px;height:70px";
    const status = document.createElement("div"); status.className = "mg-note";
    body.append(b, status);
    const set = (on) => (e) => { e.preventDefault(); b.classList.toggle("on", on); net.send({ t: "hold", panel, on }); };
    b.addEventListener("pointerdown", set(true));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, set(false));
    const iv = setInterval(() => {
      if (!S?.sab) return;
      const other = panel === "A" ? S.sab.b : S.sab.a;
      status.textContent = other ? "✔ اللوحة الأخرى ممسوكة الآن!" : "اللوحة الأخرى غير ممسوكة بعد…";
    }, 150);
    return () => clearInterval(iv);
  });
  m.panel = panel;
}

function openCams() {
  net.send({ t: "cams", on: true });
  openModal("cams", "كاميرات المراقبة", (body) => {
    const grid = document.createElement("div");
    grid.className = "mg-cams";
    const cvs = MAP.cameras.map((c) => {
      const f = document.createElement("figure");
      const cv = document.createElement("canvas"); cv.width = 320; cv.height = 200;
      f.innerHTML = `<span class="rec"></span><figcaption>${c.name}</figcaption>`;
      f.prepend(cv); grid.append(f);
      return cv;
    });
    body.append(grid);
    let raf;
    const loop = () => {
      const list = drawList(true);
      MAP.cameras.forEach((c, i) => renderer.drawCamera(cvs[i], c, list, S?.bodies || [], performance.now() / 1000));
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); net?.send({ t: "cams", on: false }); };
  });
  document.querySelector("#taskModal .task-box").style.width = "min(1000px, 100%)";
}

/** Admin table: a live map with an anonymous figure per person in each room. Off while comms are cut. */
function openAdmin() {
  openModal("admin", "خريطة الإدارة الحيّة", (body) => {
    const cv = document.createElement("canvas");
    cv.id = "adminCanvas";
    cv.style.cssText = "width:100%;border-radius:12px;border:2px solid var(--gold3)";
    const note = document.createElement("div");
    note.className = "mg-note";
    body.append(cv, note);
    let raf;
    const loop = () => {
      const down = S?.sab?.kind === "comms";
      note.textContent = down ? "الاتصالات مقطوعة — أصلحها لتعود الخريطة" : "كل رمز أصفر شخص موجود في الغرفة الآن (بدون أسماء)";
      const counts = new Map();
      const people = [...others.values()].filter((o) => !o.ghost && !o.vented);
      if (amAlive() && !S.vent) people.push(me);
      for (const o of people) { const r = roomAt(o.x, o.y); if (r) counts.set(r.id, (counts.get(r.id) || 0) + 1); }
      renderer.drawAdmin(cv, counts, performance.now() / 1000, down);
      raf = requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });
  $("taskBody").style.minHeight = "0";
  document.querySelector("#taskModal .task-box").style.width = "min(1000px, 100%)";
}

let mapRaf = 0;
function openMap() {
  show("mapModal");
  $("mapTitle").textContent = amImp() && S.phase === "play" ? "خريطة الطائرة — اضغط غرفة لإغلاق أبوابها" : "خريطة طائرة الصقر";
  let geo = { z: 1, offY: 0 };
  const loop = () => {
    if ($("mapModal").classList.contains("hidden")) return;
    const markers = [];
    if (S && S.phase !== "lobby") {
      if (S.role === "crew") for (const t of S.tasks || []) if (!t.done) markers.push({ ...TASK_BY_ID[t.id], color: "#f1cf83", r: 12, pulse: true });
      if (S.sab?.kind === "lights") markers.push({ ...MAP.fixes.lights, color: "#ff5a5a", r: 15, pulse: true });
      if (S.sab?.kind === "comms") markers.push({ ...MAP.fixes.comms, color: "#ff5a5a", r: 15, pulse: true });
      if (S.sab?.kind === "fuel") markers.push({ ...MAP.fixes.fuelA, color: "#ff5a5a", r: 15, pulse: true }, { ...MAP.fixes.fuelB, color: "#ff5a5a", r: 15, pulse: true });
      if (amImp()) for (const v of MAP.vents) markers.push({ ...v, color: "#8a2332", r: 9 });
    }
    markers.push({ x: me.x, y: me.y, color: colorHex(myPlayer()?.color), r: 20 });
    geo = renderer.drawOverview($("mapCanvas"), markers, performance.now() / 1000);
    mapRaf = requestAnimationFrame(loop);
  };
  cancelAnimationFrame(mapRaf);
  requestAnimationFrame(loop);
  $("mapCanvas").onclick = (e) => {
    if (!amImp() || S.phase !== "play" || !S.alive) return;
    const r = $("mapCanvas").getBoundingClientRect();
    const k = $("mapCanvas").width / r.width;
    const wx = ((e.clientX - r.left) * k) / geo.z, wy = ((e.clientY - r.top) * k - geo.offY) / geo.z;
    const room = roomAt(wx, wy);
    if (room && MAP.doors.some((d) => d.room === room.id)) { net.send({ t: "sabotage", kind: "doors", room: room.id }); toast(`أُغلقت أبواب ${room.name}`); }
  };
}

function openSabMenu() {
  if (!amImp() || S.phase !== "play" || !S.alive) return;
  const grid = $("doorGrid");
  grid.innerHTML = "";
  for (const r of MAP.rooms) {
    if (!MAP.doors.some((d) => d.room === r.id)) continue;
    const b = document.createElement("button");
    b.className = "btn small"; b.innerHTML = icon("door") + `<span>${r.name}</span>`;
    b.disabled = (S.doorsClosed || []).includes(r.id);
    b.onclick = () => { net.send({ t: "sabotage", kind: "doors", room: r.id }); show("sabMenu", false); };
    grid.append(b);
  }
  const ready = serverNow() >= S.sabReadyAt && !S.sab;
  document.querySelectorAll("[data-sab]").forEach((b) => {
    b.disabled = !ready;
    b.onclick = () => { net.send({ t: "sabotage", kind: b.dataset.sab }); show("sabMenu", false); };
  });
  show("sabMenu");
}

function hudInit() {
  $("actUse").onclick = use;
  $("actReport").onclick = report;
  $("actKill").onclick = kill;
  $("actVent").onclick = vent;
  $("actSab").onclick = openSabMenu;
  $("sabClose").onclick = () => show("sabMenu", false);
  $("taskClose").onclick = closeModal;
  $("mapBtn").onclick = openMap;
  $("mapClose").onclick = () => show("mapModal", false);
  if (innerWidth < 640) $("taskPanel").classList.add("collapsed");
  $("taskToggle").onclick = () => $("taskPanel").classList.toggle("collapsed");
  $("soundBtn").innerHTML = icon(isMuted() ? "mute" : "sound");
  $("soundBtn").onclick = () => { $("soundBtn").innerHTML = icon(toggleMute() ? "mute" : "sound"); };
  const paintEco = () => { $("ecoBtn").innerHTML = icon("leaf"); $("ecoBtn").classList.toggle("on", eco); $("ecoBtn").title = eco ? "توفير البطارية: شغّال" : "توفير البطارية: موقف"; };
  paintEco();
  renderer.setEco(eco);
  $("ecoBtn").onclick = () => {
    eco = !eco;
    store.set("dakheel-eco", eco ? "1" : "0");
    renderer.setEco(eco);
    visionCache = null;
    paintEco();
    toast(eco ? "وضع توفير البطارية: شغّال (أبرد للجوال)" : "وضع توفير البطارية: موقف (أنعم بالحركة)");
  };
  input.onKey = (k) => {
    if (!S) return;
    if (k === "escape") { closeModal(); show("mapModal", false); show("sabMenu", false); return; }
    if (S.phase !== "play" && S.phase !== "lobby") return;
    if (k === "e" || k === " " || k === "ث") use();
    else if (k === "r" || k === "ق") report();
    else if (k === "q" || k === "ض") kill();
    else if (k === "v" || k === "ر") vent();
    else if (k === "m" || k === "ة") ($("mapModal").classList.contains("hidden") ? openMap() : show("mapModal", false));
    else if (k === "f" || k === "ب") openSabMenu();
  };
}

const USE_LABEL = { admin: ["map", "الإدارة"], bell: ["bell", "الجرس"], cams: ["cams", "الكاميرات"], fix: ["fix", "إصلاح"], fuel: ["fix", "إصلاح"], task: ["use", "استخدام"] };
function updateActions() {
  if (!S) return;
  const play = S.phase === "play";
  const u = play ? nearestUse() : null;
  const [ic, label] = USE_LABEL[u?.kind || "task"];
  const useBtn = $("actUse");
  if (useBtn.dataset.ic !== ic) { useBtn.dataset.ic = ic; useBtn.querySelector("svg").outerHTML = icon(ic); }
  useBtn.disabled = !u;
  useBtn.classList.toggle("ready", !!u);
  useBtn.querySelector("span").textContent = label;
  const b = play && nearestBody();
  $("actReport").disabled = !b;
  $("actReport").classList.toggle("ready", !!b);
  show("actReport", play && S.alive !== false);
  if (amImp()) {
    const now = serverNow();
    const kLeft = Math.max(0, S.killReadyAt - now);
    const kcd = Math.ceil(kLeft / 1000);
    const target = killTarget();
    $("actKill").disabled = !target || kcd > 0;
    $("actKill").classList.toggle("ready", !!target && kcd === 0);
    $("actKill").querySelector(".cd").textContent = play && kcd > 0 ? ar(kcd) : "";
    $("actKill").style.setProperty("--cd", Math.min(1, kLeft / (S.settings.killCooldown * 1000)));
    const sLeft = Math.max(0, S.sabReadyAt - now);
    $("actSab").disabled = !play || !S.alive;
    $("actSab").querySelector(".cd").textContent = play && sLeft > 0 && !S.sab ? ar(Math.ceil(sLeft / 1000)) : "";
    $("actSab").style.setProperty("--cd", Math.min(1, sLeft / 30000));
    const v = nearVent();
    $("actVent").disabled = !v;
    $("actVent").classList.toggle("ready", !!v);
    $("actVent").querySelector("span").textContent = S.vent ? "خروج" : "فتحة";
    for (const id of ["actKill", "actSab", "actVent"]) show(id, S.alive);
  }
  const box = $("ventArrows");
  const key = S.vent || "";
  if (box.dataset.k !== key) {
    box.dataset.k = key;
    box.innerHTML = "";
    if (S.vent) {
      for (const id of VENT_BY_ID[S.vent].links) {
        const to = VENT_BY_ID[id];
        const a = Math.atan2(to.y - me.y, to.x - me.x);
        const btn = document.createElement("button");
        btn.className = "vent-arrow";
        btn.innerHTML = `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>`;
        btn.style.left = `calc(50% + ${Math.cos(a) * 120}px - 29px)`;
        btn.style.top = `calc(50% + ${Math.sin(a) * 120}px - 29px)`;
        btn.firstChild.style.transform = `rotate(${a}rad)`;
        btn.onclick = () => { sfx.vent(); net.send({ t: "vent", action: "move", to: id }); };
        box.append(btn);
      }
    }
  }
}

// ---------- meeting ----------
function renderMeeting() {
  const m = S.meeting;
  if (!m) return;
  const reveal = S.phase === "eject" && S.eject;
  const caller = player(m.caller);
  const body = m.body && player(m.body);
  $("meetingIcon").innerHTML = icon(m.reason === "report" ? "report" : "bell");
  $("meetingTitle").textContent = m.reason === "report" ? `بلاغ من ${caller?.name || ""}: ${body ? body.name : "أحد الركاب"} مُقصى!` : `جرس الطوارئ من ${caller?.name || ""}`;
  $("meetingSub").textContent = reveal ? "نتيجة التصويت" : S.alive ? (m.myVote === undefined ? "من الدخيل؟ صوّت الآن أو تخطَّ" : "تم تسجيل صوتك") : "أنت روح: تشاهد فقط";
  $("meetingTimer").parentElement.classList.toggle("hidden", !!reveal);
  document.querySelector(".meeting-box").classList.toggle("reveal", !!reveal);
  const votes = reveal ? S.eject.votes : null;
  const votersOf = (target) => Object.entries(votes || {}).filter(([, t]) => t === target).map(([v]) => player(v)).filter(Boolean);
  const grid = $("voteGrid");
  grid.innerHTML = "";
  const canVote = !reveal && S.alive && m.myVote === undefined;
  S.players.forEach((p, idx) => {
    if (p.left && !p.dead) return;
    const card = document.createElement("button");
    const dead = p.dead || p.left;
    card.className = "vote-card" + (dead ? " dead" : "") + (m.myVote === p.id ? " mine" : "") + (pendingVote === p.id ? " pending" : "");
    card.disabled = dead || !canVote;
    card.style.animationDelay = performance.now() - meetingShownAt < 800 ? idx * 0.04 + "s" : "0s";
    card.append(avatar(p.color, 50, { dead, ghost: false }, !dead));
    const info = document.createElement("div");
    info.className = "info";
    const tags = [];
    if (p.id === myId) tags.push("أنت");
    if (p.role === "imp" && S.role === "imp") tags.push("دخيل");
    if (dead) tags.push(p.left ? "غادر" : "مُقصى");
    if (p.id === m.caller) tags.push(m.reason === "report" ? "المُبلِّغ" : "قرع الجرس");
    info.innerHTML = `<div class="nm" style="${p.role === "imp" && S.role === "imp" ? "color:#ff9a9a" : ""}">${esc(p.name)}</div><div class="tags">${tags.join(" · ")}</div>`;
    if (reveal) {
      const vs = document.createElement("div"); vs.className = "voters";
      votersOf(p.id).forEach((v, i) => { const a = avatar(v.color, 22); a.style.animationDelay = 0.3 + i * 0.25 + "s"; vs.append(a); });
      info.append(vs);
    }
    card.append(info);
    if (pendingVote === p.id && canVote) {
      const c = document.createElement("div"); c.className = "confirm";
      c.innerHTML = `<span class="yes" title="تأكيد">${icon("check")}</span><span class="no" title="إلغاء">${icon("close")}</span>`;
      c.querySelector(".yes").onclick = (e) => { e.stopPropagation(); castVote(p.id, true); };
      c.querySelector(".no").onclick = (e) => { e.stopPropagation(); pendingVote = null; renderMeeting(); };
      card.append(c);
    }
    if (p.voted && !reveal) {
      const v = document.createElement("span"); v.className = "stamp"; v.textContent = "صوّت";
      const key = p.id + ":" + m.startedAt;
      if (seenStamps.has(key)) v.style.animation = "none"; else seenStamps.add(key);
      card.append(v);
    }
    card.onclick = () => castVote(p.id);
    grid.append(card);
  });
  const skipBtn = $("skipVote");
  skipBtn.disabled = !canVote;
  skipBtn.classList.toggle("mine", m.myVote === "skip");
  skipBtn.querySelector("span").textContent = pendingVote === "skip" ? "تأكيد التخطّي؟" : m.myVote === "skip" ? "تخطّيت" : "تخطّي التصويت";
  const sv = $("skipVoters");
  sv.innerHTML = "";
  if (reveal) votersOf("skip").forEach((v, i) => { const a = avatar(v.color, 22); a.style.animationDelay = 0.3 + i * 0.25 + "s"; sv.append(a); });
  $("chatInput").disabled = !!reveal;
  $("chatInput").placeholder = S.alive ? "اكتب رسالة…" : "رسائل الأرواح تصل للأرواح فقط…";
  const log = $("chatLog");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  const have = log.children.length;
  m.chat.slice(have).forEach((c) => {
    const p = player(c.from);
    const li = document.createElement("li");
    li.className = c.dead ? "dead" : "";
    li.append(avatar(p?.color, 22));
    const b = document.createElement("div");
    b.className = "bubble";
    b.innerHTML = `<b style="color:${colorHex(p?.color)}">${esc(p?.name || "؟")}</b>${esc(c.text)}`;
    li.append(b);
    log.append(li);
    if (have) sfx.vote();
  });
  if (atBottom || !have) log.scrollTop = log.scrollHeight;
}

// The confirm tick appears right under the finger, so a confirmation only counts after a short pause:
// a quick double tap on a player (or on «تخطّي») never casts the vote by itself.
let voteArmedAt = 0;
const confirmPause = 500;
function castVote(target, confirmed = false) {
  if (!S || S.phase !== "meeting" || !S.alive || S.meeting.myVote !== undefined) return;
  if (confirmed && performance.now() - voteArmedAt < confirmPause) return;
  if (!confirmed) {
    if (pendingVote === target && target === "skip") { castVote("skip", true); return; }
    if (pendingVote === target) return;
    pendingVote = target; voteArmedAt = performance.now(); renderMeeting(); return;
  }
  pendingVote = null;
  sfx.vote();
  net.send({ t: "vote", target });
}

function meetingInit() {
  $("skipVote").onclick = () => castVote("skip");
  $("chatForm").onsubmit = (e) => {
    e.preventDefault();
    const text = $("chatInput").value.trim();
    if (!text) return;
    net.send({ t: "chat", text });
    $("chatInput").value = "";
  };
}

function meetingTimer() {
  if (!S || S.phase !== "meeting") return;
  const m = S.meeting, now = serverNow();
  const total = (m.voteEndsAt - m.startedAt) || 1;
  const leftMs = Math.max(0, m.voteEndsAt - now);
  $("meetingTimer").textContent = ar(Math.ceil(leftMs / 1000));
  $("timerArc").style.strokeDashoffset = 119.4 * (1 - leftMs / total);
  $("meetingTimer").parentElement.classList.toggle("low", leftMs < 10000);
}

// ---------- ejection scene ----------
let ejectRaf = 0;
const ejectSky = new Sky();
function startEject() {
  const e = S.eject;
  if (!e) return;
  show("eject");
  const t0 = performance.now();
  const target = e.target && player(e.target);
  let text;
  if (!target) text = e.tie ? "تعادل في الأصوات… لم يُطرد أحد" : "تم تخطّي التصويت… لم يُطرد أحد";
  else if (e.wasImp === null) text = `الطرد من الطائرة: ${target.name}`;
  else text = e.wasImp ? `انكشف الدخيل: ${target.name}!` : `خطأ! ${target.name} من الطاقم…`;
  const sub = e.impsLeft == null || e.impsLeft === 0 ? "" : `بقي ${ar(e.impsLeft)} ${e.impsLeft > 1 ? "دخلاء" : "دخيل"} على متن الطائرة`;
  $("ejectText").textContent = "";
  $("ejectSub").textContent = sub;
  $("ejectSub").classList.remove("on");
  const cv = $("ejectCanvas");
  const loop = (now) => {
    const t = (now - t0) / 1000;
    const d = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(innerWidth * d) || cv.height !== Math.round(innerHeight * d)) { cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d); }
    const g = cv.getContext("2d");
    ejectSky.draw(g, cv.width, cv.height, now / 1000, t * 600, d, 6);
    drawAirship(g, cv.width * 0.85 - t * 40 * d, cv.height * 0.28, Math.min(cv.width, cv.height) / 2400, now / 1000);
    if (target) {
      const p = Math.min(1, t / 4.5);
      const x = cv.width * (1.1 - p * 1.3), y = cv.height * (0.32 + p * 0.25) + Math.sin(t * 3) * 10 * d;
      g.save(); g.translate(x, y); g.rotate(t * 2.6); g.scale(3 * d, 3 * d);
      drawCharacter(g, 0, 0, target.color, { t: now / 1000, facing: 1 });
      g.restore();
    }
    const chars = Math.floor(Math.max(0, t - 0.6) * 22);
    $("ejectText").textContent = text.slice(0, chars);
    if (chars > text.length + 8) $("ejectSub").classList.add("on");
    ejectRaf = requestAnimationFrame(loop);
  };
  cancelAnimationFrame(ejectRaf);
  ejectRaf = requestAnimationFrame(loop);
}
function stopEject() { cancelAnimationFrame(ejectRaf); }

// ---------- end screen + confetti ----------
let confettiRaf = 0;
function startConfetti(winner) {
  const cv = $("confetti");
  const d = Math.min(2, devicePixelRatio || 1);
  cv.width = innerWidth * d; cv.height = innerHeight * d;
  const g = cv.getContext("2d");
  const crew = winner === "crew";
  const cols = crew ? ["#f1cf83", "#2bb3a0", "#e0524f", "#4fb3e8", "#fff3cf"] : ["#e0524f", "#ff9a5a", "#8a2332"];
  const bits = Array.from({ length: 140 }, () => ({
    x: Math.random() * cv.width, y: crew ? -Math.random() * cv.height : cv.height + Math.random() * cv.height,
    vx: (Math.random() - 0.5) * 60 * d, vy: (crew ? 1 : -1) * (60 + Math.random() * 120) * d, r: Math.random() * TAU, vr: (Math.random() - 0.5) * 8,
    s: (4 + Math.random() * 6) * d, c: cols[Math.floor(Math.random() * cols.length)]
  }));
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    g.clearRect(0, 0, cv.width, cv.height);
    for (const b of bits) {
      b.x += b.vx * dt + Math.sin(now / 500 + b.r) * 0.6 * d; b.y += b.vy * dt; b.r += b.vr * dt;
      if (crew && b.y > cv.height + 20) { b.y = -20; b.x = Math.random() * cv.width; }
      if (!crew && b.y < -20) { b.y = cv.height + 20; b.x = Math.random() * cv.width; }
      g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c;
      if (crew) { if (b.s > 7 * d) { medallion(g, 0, 0, b.s * 0.8); g.fill(); } else g.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2); }
      else { g.globalAlpha = 0.7; g.beginPath(); g.arc(0, 0, b.s / 2, 0, TAU); g.fill(); }
      g.restore();
    }
    confettiRaf = requestAnimationFrame(loop);
  };
  cancelAnimationFrame(confettiRaf);
  confettiRaf = requestAnimationFrame(loop);
}
function stopConfetti() { cancelAnimationFrame(confettiRaf); }

function renderEnd() {
  const r = S.result;
  if (!r) return;
  const won = r.winner === S.role;
  $("endTitle").textContent = r.winner === "crew" ? "انتصر الطاقم!" : "انتصر الدخلاء!";
  $("endTitle").className = "end-title " + r.winner;
  $("endReason").textContent = `${r.reason} — ${won ? "مبروك، فزت" : "حظًا أوفر المرة القادمة"}`;
  const winners = $("endWinners");
  winners.innerHTML = "";
  S.players.filter((p) => p.role === r.winner).forEach((p, i) => {
    const a = avatar(p.color, 74, { dead: false }, true);
    a.style.animationDelay = i * 0.12 + "s";
    winners.append(a);
  });
  const ul = $("endRoles");
  ul.innerHTML = "";
  for (const p of S.players) {
    const li = document.createElement("li");
    li.className = p.role === "imp" ? "imp" : "";
    li.append(avatar(p.color, 40, { dead: p.dead }));
    const d = document.createElement("div");
    d.innerHTML = `${esc(p.name)}<small>${p.role === "imp" ? "دخيل" : "طاقم"}${p.dead ? " · مُقصى" : ""}${p.left ? " · غادر" : ""}</small>`;
    li.append(d);
    ul.append(li);
  }
  const host = myPlayer()?.host;
  $("againBtn").classList.toggle("hidden", !host);
  $("endWait").textContent = host ? "" : "بانتظار المضيف للعودة إلى الصالة…";
}

// ---------- main loop ----------
function drawList(forCams = false) {
  const list = [];
  const mine = myPlayer();
  for (const [id, o] of others) {
    const p = player(id);
    if (!p) continue;
    const imp = p.role === "imp" && S.role === "imp" && S.phase !== "lobby";
    list.push({ id, x: o.x, y: o.y, color: p.color, name: p.name, ghost: o.ghost, vented: o.vented, moving: o.moving, walk: o.walk, facing: o.face, seed: o.seed, nameColor: imp ? "#ff9a9a" : "#fff" });
  }
  if (mine && (!forCams || (amAlive() && !S.vent))) {
    list.push({ id: myId, self: true, x: me.x, y: me.y, color: mine.color, name: mine.name, ghost: !amAlive(), vented: !!S.vent, moving: me.moving, walk: me.walk, facing: me.face, seed: 3, nameColor: amImp() ? "#ff9a9a" : "#f1cf83", alpha: S.vent ? 0.35 : 1 });
  }
  return list;
}

let lastFrame = performance.now();
const COVERS = ["meeting", "eject", "end", "reveal", "splash", "koScene"];
let visionCache = null;
function frame(now) {
  requestAnimationFrame(frame);
  if (now - lastFrame < 1000 / fpsCap() - 2) return; // frame cap
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const t = now / 1000;
  tickAvatars(t);
  // A full-screen scene covers the ship: keep timers going but don't redraw the world underneath.
  if (COVERS.some((id) => !$(id).classList.contains("hidden"))) { meetingTimer(); return; }
  if (!S || !me.ready) { renderer.draw(emptyFrame(t, dt)); return; }

  const phase = S.phase;
  const canMove = (phase === "lobby" || (phase === "play" && serverNow() >= S.playStartsAt)) && !S.vent && !modal &&
    $("mapModal").classList.contains("hidden") && $("sabMenu").classList.contains("hidden");
  input.enabled = canMove;
  const v = input.vector();
  const speed = BASE_SPEED * (S.settings.speed || 1);
  me.moving = canMove && !!(v.x || v.y);
  const ghost = !amAlive();
  if (me.moving) {
    if (ghost) {
      me.x = Math.max(0, Math.min(MAP.width, me.x + v.x * speed * dt));
      me.y = Math.max(0, Math.min(MAP.height, me.y + v.y * speed * dt));
    } else {
      const n = moveWithCollision(me.x, me.y, v.x * speed * dt, v.y * speed * dt, doorRects());
      me.x = n.x; me.y = n.y;
      if (!eco && t > me.dustAt) { renderer.fx.dust(me.x, me.y); me.dustAt = t + 0.18; }
    }
    me.walk += dt * 12;
    if (Math.abs(v.x) > 0.1) me.facing = v.x > 0 ? 1 : -1;
  }
  me.face += (me.facing - me.face) * Math.min(1, dt * 14);
  if (now - lastSent > 66 && (Math.abs(me.x - sentX) > 0.5 || Math.abs(me.y - sentY) > 0.5)) {
    net.send({ t: "pos", x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, tp: me.tp });
    lastSent = now; sentX = me.x; sentY = me.y;
  }

  // Smooth other players towards their latest server positions.
  const k = 1 - Math.exp(-dt * 14);
  for (const o of others.values()) {
    const dx = o.tx - o.x, dy = o.ty - o.y;
    o.moving = Math.hypot(dx, dy) > 1.5;
    if (o.moving) {
      o.walk += dt * 12;
      if (Math.abs(dx) > 1) o.facing = dx > 0 ? 1 : -1;
      if (!eco && !o.ghost && t > o.dustAt) { renderer.fx.dust(o.x, o.y); o.dustAt = t + 0.22; }
    }
    o.face += (o.facing - o.face) * Math.min(1, dt * 14);
    o.x += dx * k; o.y += dy * k;
  }

  // Camera eases after the player.
  const ck = 1 - Math.exp(-dt * 10);
  cam.x += (me.x - cam.x) * ck; cam.y += (me.y - cam.y) * ck;
  if (Math.hypot(me.x - cam.x, me.y - cam.y) > 400) { cam.x = me.x; cam.y = me.y; }

  const playing = phase === "play";
  const lightsOut = playing && S.sab?.kind === "lights";
  const doors = doorRects();
  let vision = null;
  if (playing && !ghost) {
    const r = amImp() ? VISION * 1.4 : lightsOut ? LIGHTS_OFF_VISION : VISION * (S.settings.vision || 1);
    // The sight shape only changes when you move, the radius changes or a door opens/closes.
    const key = `${Math.round(me.x / 2)},${Math.round(me.y / 2)},${r},${(S.doorsClosed || []).join()}`;
    if (!visionCache || visionCache.key !== key) visionCache = { key, poly: visionPolygon(me.x, me.y, r, doors, eco ? 90 : 120) };
    vision = { x: me.x, y: me.y, r, poly: visionCache.poly };
  }
  const visible = vision ? (x, y) => Math.hypot(x - me.x, y - me.y) <= vision.r && lineClear(me.x, me.y, x, y, doors, 12) : () => true;

  const highlights = [], arrows = [];
  if (playing) {
    const add = (pt, color) => {
      highlights.push({ ...pt, color });
      if (dist(pt, me) > 380) arrows.push({ angle: Math.atan2(pt.y - me.y, pt.x - me.x), color });
    };
    if (S.role === "crew") for (const tk of S.tasks || []) if (!tk.done) add(TASK_BY_ID[tk.id], "#f1cf83");
    if (S.sab?.kind === "lights") add(MAP.fixes.lights, "#ff6a6a");
    if (S.sab?.kind === "comms") add(MAP.fixes.comms, "#ff6a6a");
    if (S.sab?.kind === "fuel") { add(MAP.fixes.fuelA, "#ff6a6a"); add(MAP.fixes.fuelB, "#ff6a6a"); }
  }
  const doorFrames = [];
  for (const d of MAP.doors) {
    const st = doorAnim.get(d.room);
    if (!st) continue;
    const p = Math.min(1, (t - st.t) / 0.28);
    const kk = st.closed ? p : 1 - p;
    if (kk > 0) doorFrames.push({ rect: d, k: kk });
  }

  renderer.draw({
    cam, t, dt,
    players: drawList(), bodies: playing ? S.bodies || [] : [],
    vision, visible, highlights, arrows: arrows.slice(0, 8), doors: doorFrames, lightsOut, camsOn: playing && !!S.camsOn
  });

  updateActions();
  updateBanner();
  meetingTimer();
}

function emptyFrame(t, dt) {
  return { cam, t, dt, players: [], bodies: [], vision: null, visible: () => true, highlights: [], doors: [], lightsOut: false };
}

function startGame() {
  renderer = new Renderer($("view"));
  input = new Input($("joystick"));
  hudInit();
  lobbyInit();
  meetingInit();
  requestAnimationFrame(frame);
}

// Boot once fonts are ready so painted Arabic labels use the right typeface.
paintIcons();
startHero();
const boot = () => homeInit();
if (document.fonts && document.fonts.ready) Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(boot);
else boot();

// Read-only peek for automated browser tests.
window.__dakheel = () => ({ phase: S?.phase, role: S?.role, alive: S?.alive, me: { x: me.x, y: me.y } });
