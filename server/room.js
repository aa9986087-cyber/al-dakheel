// Authoritative game room. Pure logic with no network code: adapters (Node dev server, Cloudflare Durable Object)
// hand it connections ({ send(string), close() }) and call tick() every TICK_MS.
import {
  COLORS, MAX_PLAYERS, MIN_PLAYERS, BASE_SPEED, KILL_RANGE, REPORT_RANGE, USE_RANGE, VENT_RANGE, BUTTON_RANGE,
  TIMES, SETTINGS, defaultSettings, clampSetting, maxImpostors, cleanName
} from "../public/shared/config.js";
import { MAP, TASK_BY_ID, VENT_BY_ID, spawnPoint } from "../public/shared/map.js";
import { canStand, lineClear, isWalkable, closedDoorRects, dist } from "../public/shared/geom.js";
import { Bots } from "./bots.js";

const SAB_KINDS = ["lights", "comms", "fuel", "doors"];

export class Room {
  constructor(code, { now = () => Date.now(), random = Math.random } = {}) {
    this.code = code;
    this.now = now;
    this.random = random;
    this.players = new Map(); // id -> player
    this.conns = new Map(); // conn -> player id
    this.settings = defaultSettings();
    this.phase = "lobby"; // lobby | play | meeting | eject | end
    this.seq = 0;
    this.dirty = true;
    this.emptySince = now();
    this.resetRound();
    this.bots = new Bots(this);
  }

  resetRound() {
    this.bodies = [];
    this.sab = null; // { kind, endsAt?, room?, holdA:Set, holdB:Set }
    this.doorsClosed = new Map(); // room -> until
    this.sabReadyAt = 0;
    this.buttonReadyAt = 0;
    this.meeting = null;
    this.eject = null;
    this.result = null;
    this.playStartsAt = 0;
  }

  // ---------- connections ----------

  connect(conn) {
    this.conns.set(conn, null);
  }

  disconnect(conn) {
    const id = this.conns.get(conn);
    this.conns.delete(conn);
    const p = id && this.players.get(id);
    if (!p || p.conn !== conn) return;
    p.conn = null;
    p.connected = false;
    p.watching = false;
    p.disconnectedAt = this.now();
    this.releaseHolds(p);
    if (p.host) this.passHost();
    this.dirty = true;
  }

  /** Bots keep no one company: a room with only bots in it is empty. */
  isEmpty() {
    return ![...this.players.values()].some((p) => p.connected && !p.bot);
  }

  /** True once nobody has been here for a while; adapters drop the room. */
  isDead() {
    return this.isEmpty() && this.now() - this.emptySince > TIMES.emptyRoom;
  }

  send(p, msg) {
    if (p.conn) {
      try { p.conn.send(JSON.stringify(msg)); } catch { /* socket gone */ }
    }
  }

  sendConn(conn, msg) {
    try { conn.send(JSON.stringify(msg)); } catch { /* socket gone */ }
  }

  message(conn, raw) {
    let msg;
    try { msg = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return; }
    if (!msg || typeof msg.t !== "string") return;
    if (msg.t === "ping") return this.sendConn(conn, { t: "pong", c: msg.c, now: this.now() });
    if (msg.t === "hello") return this.hello(conn, msg);
    const p = this.players.get(this.conns.get(conn));
    if (!p || p.conn !== conn) return;
    const h = HANDLERS[msg.t];
    if (h) h.call(this, p, msg);
  }

  hello(conn, msg) {
    const token = String(msg.token || "").slice(0, 64);
    let p = token && [...this.players.values()].find((x) => x.token === token);
    if (p) {
      // Resume: the old socket (if any) is replaced.
      if (p.conn && p.conn !== conn) {
        this.conns.delete(p.conn);
        try { p.conn.close(); } catch { /* ignore */ }
      }
    } else {
      if (this.phase !== "lobby") return this.reject(conn, "started");
      if (this.players.size >= MAX_PLAYERS) return this.reject(conn, "full");
      p = this.addPlayer(token || this.newId(), msg);
    }
    p.conn = conn;
    p.connected = true;
    p.disconnectedAt = 0;
    this.conns.set(conn, p.id);
    if (![...this.players.values()].some((x) => x.host && x.connected && !x.bot && x !== p)) {
      for (const x of this.players.values()) x.host = false;
      p.host = true;
    }
    this.sendConn(conn, { t: "welcome", id: p.id, token: p.token, code: this.code });
    this.dirty = true;
  }

  reject(conn, reason) {
    this.sendConn(conn, { t: "error", reason });
    try { conn.close(); } catch { /* ignore */ }
  }

  newId() {
    return Math.floor(this.random() * 2 ** 48).toString(36) + (++this.seq).toString(36);
  }

  addPlayer(token, msg) {
    const id = "p" + (++this.seq).toString(36);
    const used = new Set([...this.players.values()].map((x) => x.color));
    const wanted = COLORS.find((c) => c.id === msg.color && !used.has(c.id));
    const color = (wanted || COLORS.find((c) => !used.has(c.id)) || COLORS[0]).id;
    const sp = spawnPoint(this.players.size, MAX_PLAYERS);
    const p = {
      id, token, color,
      name: this.uniqueName(cleanName(msg.name) || "ضيف"),
      x: sp.x, y: sp.y, tp: 0, lastPosAt: this.now(),
      host: false, connected: true, conn: null, disconnectedAt: 0, left: false,
      role: "crew", alive: true, knownDead: false, tasks: [], vent: null,
      killReadyAt: 0, emergencies: 0, vote: undefined
    };
    this.players.set(id, p);
    return p;
  }

  uniqueName(name, self) {
    const taken = new Set([...this.players.values()].filter((x) => x !== self).map((x) => x.name));
    if (!taken.has(name)) return name;
    for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`)) return `${name} ${i}`;
  }

  passHost() {
    const next = [...this.players.values()].find((x) => x.connected && !x.left && !x.bot);
    for (const x of this.players.values()) x.host = x === next;
  }

  teleport(p, x, y) {
    p.x = x; p.y = y; p.tp++;
    p.lastPosAt = this.now();
  }

  // ---------- helpers ----------

  living() {
    return [...this.players.values()].filter((p) => p.alive && !p.left);
  }

  closedRooms() {
    return [...this.doorsClosed.keys()];
  }

  taskProgress() {
    let total = 0, done = 0;
    for (const p of this.players.values()) {
      if (p.role !== "crew" || p.left) continue;
      total += p.tasks.length;
      done += p.tasks.filter((t) => t.done).length;
    }
    return total ? done / total : 0;
  }

  near(p, point, range) {
    return dist(p, point) <= range;
  }

  // ---------- game flow ----------

  start() {
    const list = [...this.players.values()].filter((p) => p.connected);
    // Drop seats of people who left the lobby.
    for (const p of [...this.players.values()]) if (!p.connected) this.players.delete(p.id);
    const n = list.length;
    const imps = Math.min(this.settings.impostors, maxImpostors(n));
    const order = this.shuffle(list.slice());
    // Optional fixed role for one player (used by the offline preview to try either side).
    if (this.forceRole) {
      const i = order.findIndex((p) => p.id === this.forceRole.id);
      if (i >= 0) {
        const [p] = order.splice(i, 1);
        if (this.forceRole.role === "imp") order.unshift(p); else order.push(p);
      }
    }
    const now = this.now();
    this.resetRound();
    order.forEach((p, i) => {
      p.role = i < imps ? "imp" : "crew";
      p.alive = true;
      p.knownDead = false;
      p.left = false;
      p.vent = null;
      p.vote = undefined;
      p.emergencies = 0;
      p.tasks = this.shuffle(MAP.tasks.map((t) => t.id)).slice(0, this.settings.tasks).map((id) => ({ id, done: false }));
      p.killReadyAt = now + TIMES.roleReveal + 10000;
      const sp = spawnPoint(i, n);
      this.teleport(p, sp.x, sp.y);
    });
    this.phase = "play";
    this.playStartsAt = now + TIMES.roleReveal;
    this.buttonReadyAt = this.playStartsAt + 10000;
    this.sabReadyAt = this.playStartsAt + 10000;
    this.dirty = true;
  }

  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  canAct(p) {
    return this.phase === "play" && this.now() >= this.playStartsAt && p.alive && !p.left;
  }

  checkWin() {
    if (this.phase !== "play" && this.phase !== "eject") return false;
    const alive = this.living();
    const imps = alive.filter((p) => p.role === "imp").length;
    const crew = alive.length - imps;
    if (imps === 0) return this.finish("crew", "تم كشف كل الدخلاء");
    if (imps >= crew) return this.finish("imp", "الدخلاء سيطروا على الطائرة");
    if (this.taskProgress() >= 1) return this.finish("crew", "الطاقم أنجز كل المهام");
    return false;
  }

  finish(winner, reason) {
    this.phase = "end";
    this.result = { winner, reason };
    this.sab = null;
    this.doorsClosed.clear();
    for (const p of this.players.values()) p.vent = null;
    this.dirty = true;
    return true;
  }

  backToLobby() {
    this.phase = "lobby";
    this.resetRound();
    for (const p of [...this.players.values()]) {
      if (!p.connected || p.left) { this.players.delete(p.id); continue; }
      p.role = "crew"; p.alive = true; p.knownDead = false; p.tasks = []; p.vent = null; p.vote = undefined;
    }
    const n = this.players.size;
    [...this.players.values()].forEach((p, i) => {
      const sp = spawnPoint(i, n);
      this.teleport(p, sp.x, sp.y);
    });
    if (![...this.players.values()].some((p) => p.host)) this.passHost();
    this.dirty = true;
  }

  callMeeting(caller, reason, bodyId) {
    const now = this.now();
    this.phase = "meeting";
    this.sab = null;
    this.doorsClosed.clear();
    for (const p of this.players.values()) {
      p.vent = null;
      p.vote = undefined;
      p.watching = false;
      if (!p.alive) p.knownDead = true;
    }
    const alive = this.living();
    alive.forEach((p, i) => {
      const sp = spawnPoint(i, alive.length);
      this.teleport(p, sp.x, sp.y);
    });
    // Voting is open from the first second of the meeting; it ends at the timer or when everyone voted.
    this.meeting = {
      caller: caller.id, reason, body: bodyId || null,
      startedAt: now, voteEndsAt: now + this.settings.voting * 1000,
      chat: []
    };
    this.bodies = [];
    this.dirty = true;
  }

  resolveVotes() {
    const counts = new Map();
    for (const p of this.living()) {
      if (p.vote === undefined) continue;
      counts.set(p.vote, (counts.get(p.vote) || 0) + 1);
    }
    let best = null, bestN = 0, tie = false;
    for (const [target, n] of counts) {
      if (n > bestN) { best = target; bestN = n; tie = false; }
      else if (n === bestN) tie = true;
    }
    const target = !tie && best && best !== "skip" ? this.players.get(best) : null;
    const votes = {};
    for (const p of this.living()) if (p.vote !== undefined) votes[p.id] = p.vote;
    if (target) {
      target.alive = false;
      target.knownDead = true;
    }
    const impsLeft = this.living().filter((p) => p.role === "imp").length;
    this.eject = {
      target: target ? target.id : null,
      wasImp: target && this.settings.confirmEjects ? target.role === "imp" : null,
      tie, impsLeft: this.settings.confirmEjects ? impsLeft : null,
      votes, endsAt: this.now() + TIMES.eject
    };
    this.phase = "eject";
    this.dirty = true;
  }

  endEject() {
    this.eject = null;
    this.meeting = null;
    if (this.checkWin()) return;
    const now = this.now();
    this.phase = "play";
    for (const p of this.players.values()) {
      if (p.role === "imp") p.killReadyAt = now + this.settings.killCooldown * 1000;
      p.vote = undefined;
    }
    this.buttonReadyAt = now + TIMES.afterMeeting;
    this.sabReadyAt = now + TIMES.afterMeeting;
    this.dirty = true;
  }

  releaseHolds(p) {
    if (this.sab && this.sab.kind === "fuel") {
      this.sab.holdA.delete(p.id);
      this.sab.holdB.delete(p.id);
    }
  }

  // ---------- tick ----------

  tick() {
    const now = this.now();
    if (!this.isEmpty()) this.emptySince = now;

    for (const p of [...this.players.values()]) {
      if (p.connected) continue;
      const grace = this.phase === "lobby" ? TIMES.lobbyGrace : TIMES.disconnectGrace;
      if (now - p.disconnectedAt < grace) continue;
      if (this.phase === "lobby" || this.phase === "end") {
        this.players.delete(p.id);
      } else if (!p.left) {
        p.left = true;
        p.alive = false;
        p.knownDead = true;
        p.vote = undefined;
        this.checkWin();
      }
      if (p.host) this.passHost();
      this.dirty = true;
    }

    if (this.phase === "play") {
      for (const [room, until] of this.doorsClosed) if (now >= until) { this.doorsClosed.delete(room); this.dirty = true; }
      const s = this.sab;
      if (s && s.kind === "fuel") {
        for (const id of s.holdA) { const p = this.players.get(id); if (!p || !p.alive || !this.near(p, MAP.fixes.fuelA, USE_RANGE + 30)) s.holdA.delete(id); }
        for (const id of s.holdB) { const p = this.players.get(id); if (!p || !p.alive || !this.near(p, MAP.fixes.fuelB, USE_RANGE + 30)) s.holdB.delete(id); }
        if (s.holdA.size && s.holdB.size) { this.sab = null; this.dirty = true; }
        else if (now >= s.endsAt) this.finish("imp", "تعطّل المحرك الرئيسي قبل إصلاحه");
      }
    } else if (this.phase === "meeting") {
      if (now >= this.meeting.voteEndsAt) this.resolveVotes();
    } else if (this.phase === "eject") {
      if (now >= this.eject.endsAt) this.endEject();
    }

    if (this.bots.list.length) this.bots.update();

    if (this.dirty) {
      this.dirty = false;
      for (const p of this.players.values()) if (p.conn && !p.bot) this.send(p, this.view(p));
    }
    this.broadcastPositions();
  }

  broadcastPositions() {
    if (this.phase !== "lobby" && this.phase !== "play") return;
    const all = [...this.players.values()].filter((p) => !p.left);
    for (const viewer of all) {
      if (!viewer.conn || viewer.bot) continue;
      const d = [];
      for (const p of all) {
        const ghost = !p.alive;
        if (p !== viewer) {
          if (ghost && viewer.alive) continue; // the living cannot see ghosts
          if (p.vent && !(viewer.role === "imp" || !viewer.alive)) continue; // hidden in a hatch
        }
        d.push([p.id, Math.round(p.x), Math.round(p.y), (ghost ? 1 : 0) | (p.vent ? 2 : 0), p.tp]);
      }
      this.send(viewer, { t: "p", d });
    }
  }

  /** Personalised snapshot: secrets (roles, votes, hidden deaths) only go to those allowed to see them. */
  view(me) {
    const now = this.now();
    const seeAll = this.phase === "end";
    const imp = me.role === "imp" && this.phase !== "lobby";
    const players = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, host: p.host, connected: p.connected, left: p.left, bot: !!p.bot,
      dead: !p.alive && (p.knownDead || !me.alive || p === me || seeAll),
      role: seeAll || p === me || (imp && p.role === "imp") ? p.role : undefined,
      voted: this.phase === "meeting" ? p.vote !== undefined : undefined
    }));
    const v = {
      t: "state", now, code: this.code, phase: this.phase, me: me.id, settings: this.settings, players,
      playStartsAt: this.playStartsAt
    };
    if (this.phase === "lobby") return v;
    v.role = me.role;
    v.alive = me.alive;
    v.tasks = me.tasks;
    const commsDown = this.sab && this.sab.kind === "comms";
    v.progress = commsDown ? null : this.taskProgress();
    v.bodies = this.bodies;
    v.emergenciesLeft = Math.max(0, this.settings.emergencies - me.emergencies);
    v.buttonReadyAt = this.buttonReadyAt;
    v.doorsClosed = this.closedRooms();
    v.camsOn = [...this.players.values()].some((x) => x.watching && x.connected && !x.left);
    v.vent = me.vent;
    if (this.sab) {
      v.sab = { kind: this.sab.kind, endsAt: this.sab.endsAt || 0 };
      if (this.sab.kind === "fuel") { v.sab.a = this.sab.holdA.size; v.sab.b = this.sab.holdB.size; }
    }
    if (imp) {
      v.killReadyAt = me.killReadyAt;
      v.sabReadyAt = this.sabReadyAt;
    }
    if (this.meeting) {
      const m = this.meeting;
      v.meeting = {
        caller: m.caller, reason: m.reason, body: m.body, startedAt: m.startedAt, voteEndsAt: m.voteEndsAt,
        myVote: me.vote,
        chat: m.chat.filter((c) => !c.dead || !me.alive)
      };
    }
    if (this.eject) v.eject = this.eject;
    if (this.result) v.result = this.result;
    return v;
  }
}

// ---------- message handlers (this = Room, p = sender) ----------

const HANDLERS = {
  profile(p, msg) {
    if (this.phase !== "lobby") return;
    if (typeof msg.name === "string") {
      const name = cleanName(msg.name);
      if (name) p.name = this.uniqueName(name, p);
    }
    if (msg.color && COLORS.some((c) => c.id === msg.color)) {
      const taken = [...this.players.values()].some((x) => x !== p && x.color === msg.color);
      if (!taken) p.color = msg.color;
    }
    this.dirty = true;
  },

  /** The host sets how many computer players join the lobby. */
  bots(p, msg) {
    if (!p.host || this.phase !== "lobby") return;
    const n = Number(msg.n);
    if (!Number.isInteger(n)) return;
    this.bots.setCount(n);
    this.dirty = true;
  },

  settings(p, msg) {
    if (!p.host || this.phase !== "lobby" || !msg.values) return;
    for (const [k, v] of Object.entries(msg.values)) {
      if (k in SETTINGS) this.settings[k] = clampSetting(k, v);
    }
    this.dirty = true;
  },

  start(p) {
    if (!p.host || this.phase !== "lobby") return;
    const n = [...this.players.values()].filter((x) => x.connected).length;
    if (n < MIN_PLAYERS) return this.send(p, { t: "toast", text: `تحتاج ${MIN_PLAYERS} لاعبين على الأقل` });
    this.start();
  },

  lobby(p) {
    if (p.host && this.phase === "end") this.backToLobby();
  },

  pos(p, msg) {
    if (this.phase !== "lobby" && this.phase !== "play") return;
    if (p.vent || msg.tp !== p.tp) return;
    const x = Number(msg.x), y = Number(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = this.now();
    const dt = Math.min(1, Math.max(0.05, (now - p.lastPosAt) / 1000));
    const maxD = BASE_SPEED * this.settings.speed * dt * 1.6 + 30;
    const ghost = !p.alive;
    let ok = Math.hypot(x - p.x, y - p.y) <= maxD;
    if (ok && ghost) ok = x >= 0 && y >= 0 && x <= MAP.width && y <= MAP.height;
    else if (ok) {
      const doors = closedDoorRects(this.closedRooms());
      ok = canStand(x, y, doors, 10) && lineClear(p.x, p.y, x, y, doors);
      // A door can close on top of someone: let them walk out.
      if (!ok && !isWalkable(p.x, p.y, doors)) ok = isWalkable(x, y);
    }
    if (!ok) {
      p.tp++;
      p.lastPosAt = now;
      return;
    }
    p.x = x; p.y = y; p.lastPosAt = now;
  },

  task(p, msg) {
    if (!this.canAct(p) && !(this.phase === "play" && !p.alive && !p.left)) return;
    if (p.role !== "crew") return;
    const t = p.tasks.find((x) => x.id === msg.id);
    const def = TASK_BY_ID[msg.id];
    if (!t || t.done || !def || !this.near(p, def, USE_RANGE + 40)) return;
    t.done = true;
    this.dirty = true;
    this.checkWin();
  },

  kill(p, msg) {
    if (!this.canAct(p) || p.role !== "imp" || p.vent) return;
    const now = this.now();
    if (now < p.killReadyAt) return;
    const v = this.players.get(msg.target);
    if (!v || !v.alive || v.left || v.role === "imp" || v.vent) return;
    if (!this.near(p, v, KILL_RANGE + 25)) return;
    v.alive = false;
    this.releaseHolds(v);
    this.bodies.push({ id: v.id, x: Math.round(v.x), y: Math.round(v.y), color: v.color });
    this.teleport(p, v.x, v.y);
    p.killReadyAt = now + this.settings.killCooldown * 1000;
    // Only the two people involved learn this (for their knockout animation).
    this.send(v, { t: "ko", by: p.id });
    this.send(p, { t: "kodone", victim: v.id });
    this.dirty = true;
    this.checkWin();
  },

  report(p) {
    if (!this.canAct(p) || p.vent) return;
    const body = this.bodies
      .filter((b) => this.near(p, b, REPORT_RANGE + 20))
      .sort((a, b) => dist(p, a) - dist(p, b))[0];
    if (body) this.callMeeting(p, "report", body.id);
  },

  emergency(p) {
    if (!this.canAct(p) || p.vent) return;
    if (this.now() < this.buttonReadyAt) return;
    if (this.sab && this.sab.kind === "fuel") return;
    if (p.emergencies >= this.settings.emergencies) return;
    if (!this.near(p, MAP.button, BUTTON_RANGE + 20)) return;
    p.emergencies++;
    this.callMeeting(p, "emergency");
  },

  vote(p, msg) {
    if (this.phase !== "meeting" || !p.alive || p.left || p.vote !== undefined) return;
    const target = msg.target === "skip" ? "skip" : this.players.get(msg.target);
    if (!target || (target !== "skip" && (!target.alive || target.left))) return;
    p.vote = target === "skip" ? "skip" : target.id;
    this.dirty = true;
    if (this.living().every((x) => x.vote !== undefined || !x.connected)) this.resolveVotes();
  },

  chat(p, msg) {
    if (this.phase !== "meeting") return;
    const text = String(msg.text || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 140);
    if (!text) return;
    const chat = this.meeting.chat;
    chat.push({ from: p.id, text, dead: !p.alive });
    if (chat.length > 80) chat.shift();
    this.dirty = true;
  },

  sabotage(p, msg) {
    if (!this.canAct(p) || p.role !== "imp") return;
    const kind = msg.kind;
    if (!SAB_KINDS.includes(kind)) return;
    const now = this.now();
    if (kind === "doors") {
      const room = String(msg.room || "");
      if (!MAP.doors.some((d) => d.room === room) || this.doorsClosed.has(room)) return;
      if (this.doorsClosed.size >= 2) return;
      this.doorsClosed.set(room, now + TIMES.doors);
      this.dirty = true;
      return;
    }
    if (this.sab || now < this.sabReadyAt) return;
    this.sab = { kind };
    if (kind === "fuel") Object.assign(this.sab, { endsAt: now + TIMES.critical, holdA: new Set(), holdB: new Set() });
    this.sabReadyAt = now + TIMES.sabotageCooldown;
    this.dirty = true;
  },

  fix(p, msg) {
    if (this.phase !== "play" || !p.alive || p.left || !this.sab) return;
    const kind = this.sab.kind;
    if (msg.kind !== kind || (kind !== "lights" && kind !== "comms")) return;
    if (!this.near(p, MAP.fixes[kind], USE_RANGE + 40)) return;
    this.sab = null;
    this.dirty = true;
  },

  hold(p, msg) {
    const s = this.sab;
    if (this.phase !== "play" || !p.alive || p.left || !s || s.kind !== "fuel") return;
    const panel = msg.panel === "B" ? "B" : "A";
    const set = panel === "A" ? s.holdA : s.holdB;
    if (!msg.on) { set.delete(p.id); this.dirty = true; return; }
    if (!this.near(p, MAP.fixes["fuel" + panel], USE_RANGE + 40)) return;
    set.add(p.id);
    if (s.holdA.size && s.holdB.size) this.sab = null;
    this.dirty = true;
  },

  /** Watching the security cameras: everyone sees the camera lights blink while someone watches. */
  cams(p, msg) {
    if (this.phase !== "play" || p.left) return;
    const on = !!msg.on && this.near(p, MAP.console, USE_RANGE + 60);
    if (p.watching !== on) { p.watching = on; this.dirty = true; }
  },

  vent(p, msg) {
    if (!this.canAct(p) || p.role !== "imp") return;
    if (msg.action === "enter") {
      if (p.vent) return;
      const v = MAP.vents.find((x) => this.near(p, x, VENT_RANGE + 25));
      if (!v) return;
      p.vent = v.id;
      this.teleport(p, v.x, v.y);
    } else if (msg.action === "move") {
      const cur = VENT_BY_ID[p.vent];
      if (!cur || !cur.links.includes(msg.to)) return;
      const to = VENT_BY_ID[msg.to];
      p.vent = to.id;
      this.teleport(p, to.x, to.y);
    } else if (msg.action === "exit") {
      if (!p.vent) return;
      p.vent = null;
    } else return;
    this.dirty = true;
  }
};
