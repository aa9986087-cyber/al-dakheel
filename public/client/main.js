import { COLORS, SETTINGS, BASE_SPEED, VISION, LIGHTS_OFF_VISION, KILL_RANGE, REPORT_RANGE, USE_RANGE, VENT_RANGE, BUTTON_RANGE, normalizeCode, isValidCode, MIN_PLAYERS, cleanName } from "../shared/config.js";
import { MAP, TASK_BY_ID, VENT_BY_ID, ROOM_BY_ID, roomAt } from "../shared/map.js";
import { moveWithCollision, closedDoorRects, lineClear, visionPolygon, dist } from "../shared/geom.js";
import { Net } from "./net.js";
import { Input } from "./input.js";
import { Renderer, drawCharacter, colorHex } from "./render.js";
import { mountGame } from "./tasks.js";
import { sfx, toggleMute, isMuted } from "./audio.js";

const $ = (id) => document.getElementById(id);
const AR = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => AR[d]);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
};

// ---------- app state ----------
let net = null;
let S = null; // latest server snapshot
let myId = null;
let renderer = null;
let input = null;
const me = { x: MAP.spawn.x, y: MAP.spawn.y, tp: -1, walk: 0, facing: 1, moving: false, ready: false };
const others = new Map(); // id -> render state
let lastSent = 0, sentX = 0, sentY = 0;
let modal = null; // { kind, cleanup }
let prevPhase = null;
let pendingVote = null;
let profile = { name: store.get("dakheel-name") || "", color: store.get("dakheel-color") || COLORS[0].id };

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

function avatar(colorId, size = 44, opts = {}) {
  const c = document.createElement("canvas");
  const d = Math.min(2, devicePixelRatio || 1);
  c.width = size * d; c.height = size * d;
  c.style.width = c.style.height = size + "px";
  const g = c.getContext("2d");
  g.scale(d * size / 60, d * size / 60);
  drawCharacter(g, 30, 42, colorId, opts);
  return c;
}

function show(id, on = true) { $(id).classList.toggle("hidden", !on); }

// ---------- home screen ----------
function buildColorGrid(el, onPick, taken = new Set(), selected) {
  el.innerHTML = "";
  for (const c of COLORS) {
    const b = document.createElement("button");
    b.className = "swatch" + (c.id === selected ? " sel" : "") + (taken.has(c.id) ? " taken" : "");
    b.style.background = c.hex;
    b.title = c.name;
    b.type = "button";
    b.onclick = () => { if (!taken.has(c.id)) onPick(c.id); };
    el.append(b);
  }
}

function homeInit() {
  $("nameInput").value = profile.name;
  const paint = () => buildColorGrid($("colorPick"), (id) => { profile.color = id; paint(); }, new Set(), profile.color);
  paint();
  const params = new URLSearchParams(location.search);
  const code = normalizeCode(params.get("room"));
  if (code) $("codeInput").value = code;
  $("createBtn").onclick = async () => {
    if (!readName()) return;
    $("createBtn").disabled = true;
    try {
      const { code } = await Net.newCode();
      enterRoom(code, true);
    } catch {
      $("homeMsg").textContent = "تعذّر إنشاء الغرفة، تأكد من الاتصال.";
    } finally { $("createBtn").disabled = false; }
  };
  const join = () => {
    if (!readName()) return;
    const c = normalizeCode($("codeInput").value);
    if (!isValidCode(c)) { $("homeMsg").textContent = "رمز الغرفة من ٥ خانات."; return; }
    enterRoom(c, false);
  };
  $("joinBtn").onclick = join;
  $("codeInput").addEventListener("keydown", (e) => e.key === "Enter" && join());
  $("nameInput").addEventListener("keydown", (e) => e.key === "Enter" && (code ? join() : $("createBtn").click()));
  // Coming back to a room you were in (page refresh): rejoin straight away.
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
  sfx.unlock();
  try { history.replaceState(null, "", "?room=" + code); } catch { /* sandboxed */ }
  $("home").classList.remove("active");
  $("game").classList.add("active");
  if (!renderer) startGame();
  net = new Net({
    code, create,
    onMessage: onMessage,
    onStatus: (s) => show("netState", s === "lost")
  });
  net.connect(() => ({ token: store.get("dakheel-token-" + code) || "", name: profile.name, color: profile.color }));
}

function leaveToHome(text) {
  net?.close();
  net = null; S = null;
  closeModal();
  for (const id of ["lobby", "meeting", "eject", "end", "reveal", "lobbyShow"]) show(id, false);
  $("game").classList.remove("active");
  $("home").classList.add("active");
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
    if (!o) { o = { x, y, tx: x, ty: y, walk: 0, facing: 1, moving: false }; others.set(id, o); }
    if (Math.hypot(x - o.tx, y - o.ty) > 300) { o.x = x; o.y = y; } // teleported
    o.tx = x; o.ty = y;
    o.ghost = !!(flags & 1);
    o.vented = !!(flags & 2);
    o.seenAt = now;
  }
  for (const id of others.keys()) if (!seen.has(id)) others.delete(id);
}

function onState(s) {
  const old = S;
  S = s;
  if (net.bestRtt === Infinity) net.offset = s.now - Date.now(); // until the first ping answers
  myId = s.me;
  document.body.classList.toggle("is-imp", amImp());
  const phase = s.phase;
  if (phase !== prevPhase) onPhaseChange(prevPhase, phase, old);
  prevPhase = phase;

  // Sound cues on events
  if (old && old.phase === "play" && phase === "play") {
    if ((s.bodies?.length || 0) > (old.bodies?.length || 0) && amImp()) sfx.kill();
    if (s.sab && !old.sab) { sfx.alarm(); toast(sabText(s.sab)); }
    if (!s.sab && old.sab) toast("تم إصلاح العطل ✔");
    if (old.alive && !s.alive) { sfx.kill(); toast("تم إقصاؤك! أكمل مهامك كروح 👻", 4000); }
  }
  if (modal && modal.kind === "fuel" && (!s.sab || s.sab.kind !== "fuel")) closeModal();
  if (modal && modal.kind === "fix" && (!s.sab || s.sab.kind !== modal.fix)) closeModal();

  renderLobby();
  renderHud();
  if (phase === "meeting") renderMeeting();
  if (phase === "eject") renderEject();
  if (phase === "end") renderEnd();
}

function onPhaseChange(from, to, old) {
  closeModal();
  pendingVote = null;
  show("lobby", to === "lobby" && !lobbyHidden);
  show("lobbyShow", to === "lobby" && lobbyHidden);
  show("meeting", to === "meeting");
  show("eject", to === "eject");
  show("end", to === "end");
  if (to === "play" && (from === "lobby" || from === "end" || from === null) && S.playStartsAt > serverNow()) showReveal();
  if (to === "meeting") {
    $("chatLog").innerHTML = "";
    if (S.meeting.reason === "report") sfx.report(); else sfx.bell();
  }
  if (to === "eject") sfx.eject();
  if (to === "end") (S.result.winner === S.role ? sfx.win : sfx.lose)();
  if (to === "lobby") others.clear();
}

// ---------- role reveal ----------
function showReveal() {
  const imp = S.role === "imp";
  sfx.start();
  $("revealTitle").textContent = imp ? "أنت الدخيل" : "أنت من الطاقم";
  $("revealTitle").className = "reveal-title" + (imp ? " imp" : "");
  const n = S.players.filter((p) => !p.left).length;
  const imps = Math.min(S.settings.impostors, n <= 5 ? 1 : n <= 8 ? 2 : 3);
  $("revealSub").textContent = imp
    ? "أقصِ الركاب بهدوء، خرّب الأنظمة، ولا تنكشف"
    : `بيننا ${ar(imps)} ${imps > 1 ? "دخلاء" : "دخيل"} — أنجز مهامك وراقب الجميع`;
  const mates = $("revealMates");
  mates.innerHTML = "";
  const list = imp ? S.players.filter((p) => p.role === "imp") : S.players.filter((p) => !p.left);
  for (const p of list) {
    const f = document.createElement("figure");
    f.append(avatar(p.color, 70));
    const cap = document.createElement("figcaption");
    cap.textContent = p.name;
    if (imp) cap.style.color = "#ff8a8a";
    f.append(cap);
    mates.append(f);
  }
  show("reveal");
  setTimeout(() => show("reveal", false), Math.max(1500, S.playStartsAt - serverNow()));
}

// ---------- lobby ----------
let lobbyHidden = false;
function renderLobby() {
  if (!S || S.phase !== "lobby") return;
  const mine = myPlayer();
  $("roomCode").textContent = S.code;
  const list = $("lobbyPlayers");
  list.innerHTML = "";
  for (const p of S.players) {
    const li = document.createElement("li");
    li.className = p.connected ? "" : "off";
    li.innerHTML = `<span class="dot" style="background:${colorHex(p.color)}"></span><span>${esc(p.name)}${p.id === myId ? " (أنت)" : ""}</span>${p.host ? '<span class="crown" title="المضيف">👑</span>' : ""}`;
    list.append(li);
  }
  $("playerCount").textContent = `(${ar(S.players.length)}/١٢)`;
  if (document.activeElement !== $("lobbyName")) $("lobbyName").value = mine?.name || "";
  const taken = new Set(S.players.filter((p) => p.id !== myId).map((p) => p.color));
  buildColorGrid($("lobbyColors"), (id) => { profile.color = id; store.set("dakheel-color", id); net.send({ t: "profile", color: id }); }, taken, mine?.color);

  const host = !!mine?.host;
  const box = $("settingsBox");
  box.innerHTML = "";
  for (const [key, def] of Object.entries(SETTINGS)) {
    const v = S.settings[key];
    const row = document.createElement("div");
    row.className = "setting";
    const shown = key === "confirmEjects" ? (v ? "نعم" : "لا") : key === "speed" || key === "vision" ? ar(v) + "×" : ar(v);
    row.innerHTML = `<span>${def.label}</span><div class="stepper"><button ${!host || v <= def.min ? "disabled" : ""} data-k="${key}" data-d="-1">−</button><b>${shown}</b><button ${!host || v >= def.max ? "disabled" : ""} data-k="${key}" data-d="1">+</button></div>`;
    box.append(row);
  }
  box.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.k, def = SETTINGS[k];
      net.send({ t: "settings", values: { [k]: S.settings[k] + def.step * Number(b.dataset.d) } });
    };
  });
  const n = S.players.filter((p) => p.connected).length;
  $("startBtn").classList.toggle("hidden", !host);
  $("startBtn").disabled = n < MIN_PLAYERS;
  $("lobbyHint").textContent = host
    ? n < MIN_PLAYERS ? `بانتظار اللاعبين… تحتاج ${ar(MIN_PLAYERS)} على الأقل (الأفضل ٥ فأكثر)` : "كل شيء جاهز! اضغط ابدأ عندما يكتمل الجميع."
    : "بانتظار المضيف ليبدأ الرحلة. تجوّل في الطائرة حتى ذلك الحين!";
}

function lobbyInit() {
  $("copyLink").onclick = async () => {
    const link = `${location.origin}/?room=${S.code}`;
    try { await navigator.clipboard.writeText(link); toast("تم نسخ رابط الدعوة"); } catch { prompt("انسخ الرابط:", link); }
  };
  $("shareLink").onclick = async () => {
    const link = `${location.origin}/?room=${S.code}`;
    if (navigator.share) { try { await navigator.share({ title: "الدخيل", text: `انضم لغرفتي في لعبة الدخيل — الرمز ${S.code}`, url: link }); } catch { /* cancelled */ } }
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
  $("againBtn").onclick = () => net.send({ t: "lobby" });
}

// ---------- HUD ----------
function sabText(sab) {
  if (!sab) return "";
  if (sab.kind === "lights") return "💡 الأنوار مطفأة! أصلحها من غرفة المولدات";
  if (sab.kind === "comms") return "📡 الاتصالات مقطوعة! أصلحها من غرفة الاتصالات";
  if (sab.kind === "fuel") {
    const left = Math.max(0, Math.ceil((sab.endsAt - serverNow()) / 1000));
    return `🛢️ تسرّب الوقود! ${ar(left)} ث — أمسكوا اللوحتين معًا (خزان الوقود + المخزن) [${ar(sab.a || 0)}/${ar(sab.b || 0)}]`;
  }
  return "";
}

function renderHud() {
  if (!S) return;
  const inGame = S.phase !== "lobby";
  show("taskPanel", inGame);
  show("roleTag", inGame);
  if (!inGame) { show("sabBanner", false); return; }
  const imp = amImp();
  $("roleTag").className = "role-tag" + (imp ? " imp" : "");
  const mates = S.players.filter((p) => p.role === "imp" && p.id !== myId).map((p) => p.name);
  $("roleTag").textContent = (imp ? "🗡️ أنت الدخيل" + (mates.length ? " — مع " + mates.join("، ") : "") : "🧭 أنت من الطاقم") + (S.alive ? "" : " · 👻 روح");
  const bar = $("taskBar");
  if (S.progress == null) { bar.style.width = "0"; $("taskBarLabel").textContent = "الاتصالات مقطوعة"; }
  else { bar.style.width = S.progress * 100 + "%"; $("taskBarLabel").textContent = `مهام الطاقم ${ar(Math.round(S.progress * 100))}٪`; }
  const ul = $("taskList");
  ul.innerHTML = "";
  if (S.sab && S.sab.kind !== "doors") {
    const li = document.createElement("li"); li.className = "sab"; li.textContent = sabText(S.sab).split("!")[0] + "!"; ul.append(li);
  }
  if (imp) { const li = document.createElement("li"); li.textContent = "مهام وهمية للتمويه:"; li.style.color = "#ff8a8a"; ul.append(li); }
  for (const t of S.tasks || []) {
    const def = TASK_BY_ID[t.id];
    const li = document.createElement("li");
    li.className = t.done ? "done" : "";
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
  else if (u.kind === "bell") {
    if (serverNow() < S.buttonReadyAt) return toast(`الجرس جاهز بعد ${ar(Math.ceil((S.buttonReadyAt - serverNow()) / 1000))} ث`);
    if (S.emergenciesLeft <= 0) return toast("استهلكت اجتماعات الطوارئ");
    if (S.sab?.kind === "fuel") return toast("لا يمكن قرع الجرس أثناء تسرّب الوقود!");
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
  show("taskModal", false);
  $("taskBody").innerHTML = "";
}

function finishModal(after) {
  $("taskBody").innerHTML = '<div class="mg-note" style="font-size:3rem">✔</div>';
  sfx.task();
  after();
  setTimeout(closeModal, 450);
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
  const m = openModal("fuel", "إيقاف تسرّب الوقود", (body) => {
    body.innerHTML = `<div class="mg-note">اضغط مطوّلاً على اللوحة، ولاعب آخر يمسك اللوحة الثانية في ${panel === "A" ? "المخزن" : "خزان الوقود"} في نفس الوقت</div>`;
    const b = document.createElement("button");
    b.className = "mg-hold"; b.textContent = "✋";
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
    return () => cancelAnimationFrame(raf);
  });
}

function openMap() {
  show("mapModal");
  const markers = [{ x: me.x, y: me.y, color: colorHex(myPlayer()?.color), r: 18 }];
  if (S && S.phase !== "lobby") {
    if (S.role === "crew") for (const t of S.tasks || []) if (!t.done) markers.push({ ...TASK_BY_ID[t.id], color: "#f1d08a", r: 11 });
    if (S.sab?.kind === "lights") markers.push({ ...MAP.fixes.lights, color: "#ff5a5a", r: 14 });
    if (S.sab?.kind === "comms") markers.push({ ...MAP.fixes.comms, color: "#ff5a5a", r: 14 });
    if (S.sab?.kind === "fuel") markers.push({ ...MAP.fixes.fuelA, color: "#ff5a5a", r: 14 }, { ...MAP.fixes.fuelB, color: "#ff5a5a", r: 14 });
    if (amImp()) for (const v of MAP.vents) markers.push({ ...v, color: "#8a2332", r: 8 });
  }
  $("mapTitle").textContent = amImp() ? "خريطة الطائرة — اضغط غرفة لإغلاق أبوابها" : "خريطة طائرة الصقر";
  requestAnimationFrame(() => {
    const z = renderer.drawOverview($("mapCanvas"), markers);
    $("mapCanvas").onclick = (e) => {
      if (!amImp() || S.phase !== "play") return;
      const r = $("mapCanvas").getBoundingClientRect();
      const k = ($("mapCanvas").width / r.width) / z;
      const room = roomAt((e.clientX - r.left) * k, (e.clientY - r.top) * k);
      if (room && MAP.doors.some((d) => d.room === room.id)) { net.send({ t: "sabotage", kind: "doors", room: room.id }); toast(`أُغلقت أبواب ${room.name}`); }
    };
  });
}

function openSabMenu() {
  if (!amImp() || S.phase !== "play" || !S.alive) return;
  const grid = $("doorGrid");
  grid.innerHTML = "";
  for (const r of MAP.rooms) {
    if (!MAP.doors.some((d) => d.room === r.id)) continue;
    const b = document.createElement("button");
    b.className = "btn small"; b.textContent = "🚪 " + r.name;
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
  $("soundBtn").textContent = isMuted() ? "🔇" : "🔊";
  $("soundBtn").onclick = () => { $("soundBtn").textContent = toggleMute() ? "🔇" : "🔊"; };
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

function updateActions() {
  if (!S) return;
  const play = S.phase === "play";
  const u = play ? nearestUse() : null;
  $("actUse").disabled = !u;
  $("actUse").classList.toggle("ready", !!u);
  $("actUse").querySelector("span").textContent = u?.kind === "bell" ? "الجرس" : u?.kind === "cams" ? "الكاميرات" : u && u.kind !== "task" ? "إصلاح" : "استخدام";
  const b = play && nearestBody();
  $("actReport").disabled = !b;
  $("actReport").classList.toggle("ready", !!b);
  show("actReport", play && S.alive !== false);
  if (amImp()) {
    const now = serverNow();
    const kcd = Math.max(0, Math.ceil((S.killReadyAt - now) / 1000));
    const target = killTarget();
    $("actKill").disabled = !target || kcd > 0;
    $("actKill").classList.toggle("ready", !!target && kcd === 0);
    $("actKill").querySelector(".cd").textContent = play && kcd > 0 ? ar(kcd) : "";
    const scd = Math.max(0, Math.ceil((S.sabReadyAt - now) / 1000));
    $("actSab").disabled = !play || !S.alive;
    $("actSab").querySelector(".cd").textContent = play && scd > 0 && !S.sab ? ar(scd) : "";
    const v = nearVent();
    $("actVent").disabled = !v;
    $("actVent").classList.toggle("ready", !!v);
    $("actVent").querySelector("span").textContent = S.vent ? "خروج" : "فتحة";
    for (const id of ["actKill", "actSab", "actVent"]) show(id, S.alive);
  }
  // Vent travel arrows
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
        btn.textContent = "➜";
        btn.style.left = `calc(50% + ${Math.cos(a) * 110}px)`;
        btn.style.top = `calc(50% + ${Math.sin(a) * 110}px)`;
        btn.style.transform = `translate(-50%,-50%) rotate(${a}rad)`;
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
  const caller = player(m.caller);
  const body = m.body && player(m.body);
  $("meetingTitle").textContent = m.reason === "report"
    ? `📢 بلاغ من ${caller?.name || ""}: ${body ? body.name : "أحد الركاب"} مُقصى!`
    : `🔔 جرس الطوارئ من ${caller?.name || ""}`;
  const grid = $("voteGrid");
  grid.innerHTML = "";
  const canVote = S.alive && m.myVote === undefined;
  for (const p of S.players) {
    if (p.left && !p.dead) continue;
    const card = document.createElement("button");
    const dead = p.dead || p.left;
    card.className = "vote-card" + (dead ? " dead" : "") + (m.myVote === p.id ? " mine" : "") + (pendingVote === p.id ? " mine" : "");
    card.disabled = dead || !canVote;
    card.append(avatar(p.color, 46, { dead }));
    const info = document.createElement("div");
    const tags = [];
    if (p.id === myId) tags.push("أنت");
    if (p.role === "imp" && S.role === "imp") tags.push("🗡️ دخيل");
    if (dead) tags.push(p.left ? "غادر" : "مُقصى");
    if (p.id === m.caller) tags.push(m.reason === "report" ? "📢 المُبلِّغ" : "🔔");
    info.innerHTML = `<div class="nm" style="${p.role === "imp" && S.role === "imp" ? "color:#ff8a8a" : ""}">${esc(p.name)}</div><div class="tags">${tags.join(" · ")}</div>${pendingVote === p.id ? '<div class="tags" style="color:#f1d08a">اضغط مرة أخرى للتأكيد</div>' : ""}`;
    card.append(info);
    if (p.voted) { const v = document.createElement("span"); v.className = "voted"; v.textContent = "صوّت"; card.append(v); }
    card.onclick = () => castVote(p.id);
    grid.append(card);
  }
  $("skipVote").disabled = !canVote;
  $("skipVote").textContent = pendingVote === "skip" ? "تأكيد التخطّي؟" : m.myVote === "skip" ? "تخطّيت ✔" : "تخطّي التصويت";
  $("chatInput").disabled = false;
  $("chatInput").placeholder = S.alive ? "اكتب رسالة…" : "رسائل الأرواح تصل للأرواح فقط…";
  const log = $("chatLog");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  log.innerHTML = "";
  for (const c of m.chat) {
    const p = player(c.from);
    const li = document.createElement("li");
    li.className = c.dead ? "dead" : "";
    li.innerHTML = `<b style="color:${colorHex(p?.color)}">${esc(p?.name || "؟")}:</b>${esc(c.text)}`;
    log.append(li);
  }
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function castVote(target) {
  if (!S || S.phase !== "meeting" || !S.alive || S.meeting.myVote !== undefined) return;
  if (serverNow() < S.meeting.discussEndsAt) return toast("التصويت يبدأ بعد انتهاء وقت النقاش");
  if (pendingVote !== target) { pendingVote = target; renderMeeting(); return; }
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
  const discuss = now < m.discussEndsAt;
  const left = Math.max(0, Math.ceil(((discuss ? m.discussEndsAt : m.voteEndsAt) - now) / 1000));
  $("meetingTimer").textContent = discuss ? `🗣️ نقاش: ${ar(left)} ث` : `🗳️ التصويت ينتهي خلال ${ar(left)} ث`;
}

// ---------- eject & end ----------
function renderEject() {
  const e = S.eject;
  if (!e) return;
  const cv = $("ejectCanvas");
  const g = cv.getContext("2d");
  g.clearRect(0, 0, cv.width, cv.height);
  const t = e.target && player(e.target);
  if (t) { g.save(); g.scale(3, 3); drawCharacter(g, 40, 50, t.color, {}); g.restore(); }
  cv.style.animation = "none"; void cv.offsetWidth; cv.style.animation = "";
  cv.style.visibility = t ? "visible" : "hidden";
  let text;
  if (!t) text = e.tie ? "تعادل في الأصوات… لم يُطرد أحد" : "تم تخطّي التصويت… لم يُطرد أحد";
  else if (e.wasImp === null) text = `الطرد من الطائرة: ${t.name}`;
  else text = e.wasImp ? `انكشف الدخيل: ${t.name}!` : `خطأ! ${t.name} من الطاقم…`;
  $("ejectText").textContent = text;
  $("ejectSub").textContent = e.impsLeft == null ? "" : e.impsLeft === 0 ? "" : `بقي ${ar(e.impsLeft)} ${e.impsLeft > 1 ? "دخلاء" : "دخيل"} على متن الطائرة`;
}

function renderEnd() {
  const r = S.result;
  if (!r) return;
  const won = r.winner === S.role;
  $("endTitle").textContent = r.winner === "crew" ? "انتصر الطاقم!" : "انتصر الدخلاء!";
  $("endTitle").className = "end-title " + r.winner;
  $("endReason").textContent = `${r.reason} — ${won ? "مبروك، فزت 🎉" : "حظًا أوفر المرة القادمة"}`;
  const ul = $("endRoles");
  ul.innerHTML = "";
  for (const p of S.players) {
    const li = document.createElement("li");
    li.className = p.role === "imp" ? "imp" : "";
    li.append(avatar(p.color, 40, { dead: p.dead }));
    const d = document.createElement("div");
    d.innerHTML = `${esc(p.name)}<small>${p.role === "imp" ? "🗡️ دخيل" : "🧭 طاقم"}${p.dead ? " · مُقصى" : ""}${p.left ? " · غادر" : ""}</small>`;
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
    list.push({ id, x: o.x, y: o.y, color: p.color, name: p.name, ghost: o.ghost, vented: o.vented, moving: o.moving, walk: o.walk, facing: o.facing, nameColor: imp ? "#ff8a8a" : "#fff" });
  }
  if (mine && !forCams || (mine && forCams && amAlive() && !S.vent)) {
    list.push({ id: myId, self: true, x: me.x, y: me.y, color: mine.color, name: mine.name, ghost: !amAlive(), vented: !!S.vent, moving: me.moving, walk: me.walk, facing: me.facing, nameColor: amImp() ? "#ff8a8a" : "#f1d08a" });
  }
  return list;
}

let lastFrame = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!S || !me.ready) { renderer.draw(emptyFrame(now)); return; }

  const phase = S.phase;
  const canMove = (phase === "lobby" || (phase === "play" && serverNow() >= S.playStartsAt)) && !S.vent && !modal &&
    $("mapModal").classList.contains("hidden") && $("sabMenu").classList.contains("hidden");
  input.enabled = canMove;
  const v = input.vector();
  const speed = BASE_SPEED * (S.settings.speed || 1);
  me.moving = canMove && (v.x || v.y);
  if (me.moving) {
    const ghost = !amAlive();
    if (ghost) {
      me.x = Math.max(0, Math.min(MAP.width, me.x + v.x * speed * dt));
      me.y = Math.max(0, Math.min(MAP.height, me.y + v.y * speed * dt));
    } else {
      const n = moveWithCollision(me.x, me.y, v.x * speed * dt, v.y * speed * dt, doorRects());
      me.x = n.x; me.y = n.y;
    }
    me.walk += dt * 12;
    if (Math.abs(v.x) > 0.1) me.facing = v.x > 0 ? 1 : -1;
  }
  if (now - lastSent > 66 && (Math.abs(me.x - sentX) > 0.5 || Math.abs(me.y - sentY) > 0.5)) {
    net.send({ t: "pos", x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, tp: me.tp });
    lastSent = now; sentX = me.x; sentY = me.y;
  }

  // Smooth other players towards their latest server positions.
  const k = 1 - Math.exp(-dt * 14);
  for (const o of others.values()) {
    const dx = o.tx - o.x, dy = o.ty - o.y;
    o.moving = Math.hypot(dx, dy) > 1.5;
    if (o.moving) { o.walk += dt * 12; if (Math.abs(dx) > 1) o.facing = dx > 0 ? 1 : -1; }
    o.x += dx * k; o.y += dy * k;
  }

  // Vision
  const ghost = !amAlive();
  const playing = phase === "play";
  const lightsOut = playing && S.sab?.kind === "lights";
  const doors = doorRects();
  let vision = null;
  if (playing && !ghost) {
    const r = amImp() ? VISION * 1.4 : lightsOut ? LIGHTS_OFF_VISION : VISION * (S.settings.vision || 1);
    vision = { x: me.x, y: me.y, r, poly: visionPolygon(me.x, me.y, r, doors) };
  }
  const visible = vision
    ? (x, y) => Math.hypot(x - me.x, y - me.y) <= vision.r && lineClear(me.x, me.y, x, y, doors, 12)
    : () => true;

  const highlights = [];
  if (playing) {
    if (S.role === "crew") for (const t of S.tasks || []) if (!t.done) highlights.push({ ...TASK_BY_ID[t.id], color: "#f1d08a" });
    if (S.sab?.kind === "lights") highlights.push({ ...MAP.fixes.lights, color: "#ff5a5a" });
    if (S.sab?.kind === "comms") highlights.push({ ...MAP.fixes.comms, color: "#ff5a5a" });
    if (S.sab?.kind === "fuel") highlights.push({ ...MAP.fixes.fuelA, color: "#ff5a5a" }, { ...MAP.fixes.fuelB, color: "#ff5a5a" });
  }

  renderer.draw({
    cam: { x: me.x, y: me.y }, t: now / 1000,
    players: drawList(), bodies: playing ? S.bodies || [] : [],
    vision, visible, highlights, doorsClosed: doors, lightsOut
  });

  updateActions();
  updateBanner();
  meetingTimer();
}

function emptyFrame(now) {
  return { cam: { x: MAP.spawn.x, y: MAP.spawn.y }, t: now / 1000, players: [], bodies: [], vision: null, visible: () => true, highlights: [], doorsClosed: [], lightsOut: false };
}

function startGame() {
  renderer = new Renderer($("view"));
  input = new Input($("joystick"));
  hudInit();
  lobbyInit();
  meetingInit();
  requestAnimationFrame(frame);
}

// Boot once fonts are ready so the map's painted Arabic labels use the right typeface.
const boot = () => homeInit();
if (document.fonts && document.fonts.ready) Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(boot);
else boot();

// Read-only peek for automated browser tests.
window.__dakheel = () => ({ phase: S?.phase, role: S?.role, alive: S?.alive, me: { x: me.x, y: me.y } });
