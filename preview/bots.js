// Computer players for the offline preview. They read the room directly and act through the same
// messages a real player sends, so the server rules still apply to them.
import { MAP, TASK_BY_ID, roomAt, navGraph } from "../public/shared/map.js";
import { BASE_SPEED, VISION, KILL_RANGE, TICK_MS } from "../public/shared/config.js";
import { moveWithCollision, lineClear, closedDoorRects, dist } from "../public/shared/geom.js";

const NAMES = ["أبو سعد", "أم خالد", "ريم", "ناصر", "جدّو", "هيا", "سلطان", "لولوة", "عمّو فهد", "شهد", "بدر"];

// Walking graph generated from the map (see navGraph in public/shared/map.js); shortest paths by Dijkstra.
const NAV = navGraph();

function nearestNode(p) {
  let best = -1, bd = Infinity;
  for (const n of NAV.nodes) {
    const d = dist(p, n);
    if (d < bd && lineClear(p.x, p.y, n.x, n.y)) { best = n.id; bd = d; }
  }
  if (best >= 0) return best;
  for (const n of NAV.nodes) { const d = dist(p, n); if (d < bd) { best = n.id; bd = d; } }
  return best;
}

function findPath(from, to) {
  if (lineClear(from.x, from.y, to.x, to.y)) return [to];
  const a = nearestNode(from), b = nearestNode(to);
  const D = NAV.nodes.map(() => Infinity), prev = NAV.nodes.map(() => -1), done = new Set();
  D[a] = 0;
  while (true) {
    let u = -1, best = Infinity;
    for (let i = 0; i < D.length; i++) if (!done.has(i) && D[i] < best) { best = D[i]; u = i; }
    if (u < 0 || u === b) break;
    done.add(u);
    for (const e of NAV.edges[u]) if (D[u] + e.d < D[e.to]) { D[e.to] = D[u] + e.d; prev[e.to] = u; }
  }
  const path = [];
  for (let k = b; k >= 0; k = prev[k]) path.unshift({ x: NAV.nodes[k].x, y: NAV.nodes[k].y });
  path.push(to);
  return path;
}

const pt = (n) => ({ x: n.x, y: n.y });
const maj = MAP.rooms.find((r) => r.id === "majlis");
const LOBBY_SPOTS = NAV.nodes.filter((n) => Math.abs(n.x - (maj.x + maj.w / 2)) < 700 && Math.abs(n.y - (maj.y + maj.h / 2)) < 500);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const roomName = (p) => roomAt(p.x, p.y)?.name || "الممرات";

export class Bots {
  constructor(room) {
    this.room = room;
    this.list = [];
    this.seq = 0;
    this.knownBodies = 0;
    this.meetingKey = null;
    this.accused = null;
  }

  setCount(n) {
    if (this.room.phase !== "lobby") return;
    n = Math.max(0, Math.min(11, n));
    while (this.list.length < n && this.room.players.size < 12) this.add();
    while (this.list.length > n) this.remove(this.list[this.list.length - 1]);
  }

  add() {
    const used = new Set([...this.room.players.values()].map((p) => p.name));
    const name = NAMES.find((n) => !used.has(n)) || "ضيف";
    const bot = { id: null, path: [], goal: null, wait: 0, stuck: 0, suspect: null };
    bot.conn = {
      send: (s) => { if (!bot.id && s.startsWith('{"t":"welcome"')) bot.id = JSON.parse(s).id; },
      close() {}
    };
    this.room.connect(bot.conn);
    this.room.message(bot.conn, { t: "hello", token: "bot-" + ++this.seq, name });
    this.list.push(bot);
  }

  remove(bot) {
    this.room.disconnect(bot.conn);
    this.room.players.delete(bot.id);
    this.list.splice(this.list.indexOf(bot), 1);
    this.room.dirty = true;
  }

  send(bot, msg) { this.room.message(bot.conn, msg); }

  sees(a, b) {
    const doors = closedDoorRects(this.room.closedRooms());
    return dist(a, b) <= VISION && lineClear(a.x, a.y, b.x, b.y, doors, 12);
  }

  goTo(bot, p, target) {
    if (!bot.goal || dist(bot.goal, target) > 25) {
      bot.goal = { x: target.x, y: target.y };
      bot.path = p.alive ? findPath(p, target) : [target];
    }
  }

  step(bot, p) {
    if (!bot.path.length) return;
    const t = bot.path[0];
    const d = dist(p, t);
    const v = BASE_SPEED * this.room.settings.speed * 0.92 * (TICK_MS / 1000);
    if (d < 10) { bot.path.shift(); return; }
    const dx = ((t.x - p.x) / d) * Math.min(v, d), dy = ((t.y - p.y) / d) * Math.min(v, d);
    const n = p.alive ? moveWithCollision(p.x, p.y, dx, dy, closedDoorRects(this.room.closedRooms())) : { x: p.x + dx, y: p.y + dy };
    if (Math.hypot(n.x - p.x, n.y - p.y) < 0.5) {
      if (++bot.stuck > 20) { bot.stuck = 0; bot.goal = null; bot.path = []; bot.wait = this.room.now() + 1000; }
    } else bot.stuck = 0;
    this.send(bot, { t: "pos", x: n.x, y: n.y, tp: p.tp });
  }

  arrived(bot, p) { return bot.goal && dist(p, bot.goal) < 30; }

  update() {
    const r = this.room, now = r.now();
    // Witnesses: whoever stands on a fresh body is the suspect for bots that can see the spot.
    if (r.phase === "play" && r.bodies.length > this.knownBodies) {
      for (const b of r.bodies.slice(this.knownBodies)) {
        const killer = [...r.players.values()].find((p) => p.alive && p.role === "imp" && dist(p, b) < 15);
        for (const bot of this.list) {
          const p = r.players.get(bot.id);
          if (p && p.alive && p.role === "crew" && killer && this.sees(p, b)) bot.suspect = killer.id;
        }
      }
    }
    this.knownBodies = r.phase === "play" ? r.bodies.length : 0;

    if (r.phase === "lobby") for (const bot of this.list) bot.suspect = null;
    if (r.phase === "meeting") return this.meeting(now);
    this.meetingKey = null;
    for (const bot of this.list) {
      const p = r.players.get(bot.id);
      if (!p || p.left) continue;
      if (now < bot.wait) continue;
      if (r.phase === "lobby") this.wander(bot, p, LOBBY_SPOTS);
      else if (r.phase === "play" && now >= r.playStartsAt) {
        if (p.role === "imp" && p.alive) this.imp(bot, p, now);
        else this.crew(bot, p, now);
      }
      if (r.phase === "lobby" || r.phase === "play") this.step(bot, p);
    }
  }

  wander(bot, p, nodes = NAV.nodes) {
    if (!bot.path.length) {
      bot.goal = null;
      const n = pt(pick(nodes));
      this.goTo(bot, p, { x: n.x + (Math.random() - 0.5) * 60, y: n.y + (Math.random() - 0.5) * 60 });
      bot.wait = this.room.now() + 500 + Math.random() * 2500;
    }
  }

  crew(bot, p, now) {
    const r = this.room;
    if (p.alive) {
      const body = r.bodies.find((b) => this.sees(p, b));
      if (body) {
        if (dist(p, body) < 150) { this.send(bot, { t: "report" }); return; }
        this.goTo(bot, p, body); return;
      }
      const s = r.sab;
      if (s && s.kind !== "fuel") {
        const fix = MAP.fixes[s.kind];
        if (this.list.indexOf(bot) % 2 === 0) {
          this.goTo(bot, p, fix);
          if (this.arrived(bot, p)) { this.send(bot, { t: "fix", kind: s.kind }); bot.wait = now + 1200; }
          return;
        }
      }
      if (s && s.kind === "fuel") {
        const panel = this.list.indexOf(bot) % 2 ? "B" : "A";
        const fix = MAP.fixes["fuel" + panel];
        this.goTo(bot, p, fix);
        if (this.arrived(bot, p)) this.send(bot, { t: "hold", panel, on: true });
        return;
      }
    }
    const task = p.role === "crew" && p.tasks.find((t) => !t.done);
    if (!task) return this.wander(bot, p);
    const def = TASK_BY_ID[task.id];
    this.goTo(bot, p, def);
    if (this.arrived(bot, p)) {
      if (!bot.taskAt) bot.taskAt = now + 2500 + Math.random() * 3500;
      else if (now >= bot.taskAt) { bot.taskAt = 0; this.send(bot, { t: "task", id: task.id }); bot.goal = null; }
    }
  }

  imp(bot, p, now) {
    const r = this.room;
    if (!r.sab && now >= r.sabReadyAt && Math.random() < 0.003) {
      const roll = Math.random();
      this.send(bot, { t: "sabotage", kind: roll < 0.5 ? "lights" : roll < 0.75 ? "comms" : "fuel" });
    }
    if (now >= p.killReadyAt) {
      const living = [...r.players.values()].filter((x) => x.alive && !x.left && x !== p);
      const prey = living.filter((x) => x.role === "crew" && !x.vent && this.sees(p, x)).sort((a, b) => dist(p, a) - dist(p, b))[0];
      if (prey) {
        const witnesses = living.filter((x) => x !== prey && x.role === "crew" && this.sees(x, prey));
        if (!witnesses.length) {
          if (dist(p, prey) <= KILL_RANGE - 15) {
            this.send(bot, { t: "kill", target: prey.id });
            bot.fake = null; bot.goal = null; bot.path = [];
            return;
          }
          bot.goal = null;
          this.goTo(bot, p, prey);
          return;
        }
      }
    }
    // Blend in: walk to a random task and pretend to do it.
    if (!bot.fake) { bot.fake = pick(MAP.tasks); bot.goal = null; }
    this.goTo(bot, p, bot.fake);
    if (this.arrived(bot, p)) { bot.wait = now + 2500 + Math.random() * 4000; bot.fake = null; }
  }

  meeting(now) {
    const r = this.room, m = r.meeting;
    if (this.meetingKey !== m.startedAt) {
      this.meetingKey = m.startedAt;
      this.accused = null;
      const caller = r.players.get(m.caller);
      const victim = m.body && r.players.get(m.body);
      for (const bot of this.list) {
        bot.path = []; bot.goal = null; bot.taskAt = 0;
        const p = r.players.get(bot.id);
        bot.lines = [];
        bot.voteAt = now + 6000 + Math.random() * 16000;
        if (!p || !p.alive) continue;
        const room = roomName(p);
        if (bot.id === m.caller && victim) bot.lines.push([now + 1500, `لقيت ${victim.name} مُقصى! تعالوا نتفاهم`]);
        if (bot.id === m.caller && !victim) bot.lines.push([now + 1500, "قرعت الجرس… أحد تصرفاته غريبة"]);
        if (bot.suspect && r.players.get(bot.suspect)?.alive) {
          const s = r.players.get(bot.suspect);
          bot.lines.push([now + 3000 + Math.random() * 4000, `شفت ${s.name} واقف عند الجثة!`]);
          this.accused = this.accused || bot.suspect;
        } else if (Math.random() < 0.6) {
          bot.lines.push([now + 2500 + Math.random() * 9000, pick([
            `أنا كنت في ${room} أسوي مهامي`, "ما شفت شي والله", "مين كان قريب من المكان؟", "نتخطى أحسن من نظلم أحد",
            `كنت ماشي في ${room} ولا شفت أحد`, "أحد يشهد لي؟ كنت مع الجماعة"
          ])]);
        }
      }
      void caller;
    }
    for (const bot of this.list) {
      const p = r.players.get(bot.id);
      if (!p) continue;
      while (bot.lines && bot.lines.length && now >= bot.lines[0][0]) this.send(bot, { t: "chat", text: bot.lines.shift()[1] });
      if (!p.alive || p.vote !== undefined || now < bot.voteAt) continue;
      const alive = r.living().filter((x) => x !== p);
      let target = "skip";
      const sus = bot.suspect && r.players.get(bot.suspect);
      if (p.role === "crew" && sus && sus.alive) target = sus.id;
      else if (p.role === "crew" && this.accused && r.players.get(this.accused)?.alive && Math.random() < 0.7) target = this.accused;
      else if (p.role === "imp") {
        const crew = alive.filter((x) => x.role === "crew");
        target = Math.random() < 0.5 && crew.length ? pick(crew).id : "skip";
      } else if (Math.random() < 0.3 && alive.length) target = pick(alive).id;
      this.send(bot, { t: "vote", target });
    }
  }
}
