// Computer players for the offline preview. They read the room directly and act through the same
// messages a real player sends, so the server rules still apply to them.
import { MAP, TASK_BY_ID, roomAt } from "../public/shared/map.js";
import { BASE_SPEED, VISION, KILL_RANGE, TICK_MS } from "../public/shared/config.js";
import { moveWithCollision, lineClear, closedDoorRects, dist } from "../public/shared/geom.js";

const NAMES = ["أبو سعد", "أم خالد", "ريم", "ناصر", "جدّو", "هيا", "سلطان", "لولوة", "عمّو فهد", "شهد", "بدر"];

// Waypoints along rooms, doorways and halls; straight lines between linked nodes are walkable.
const NODES = {
  gen: [510, 380], cGen: [510, 635], hGen: [510, 780], cEng: [510, 925], eng: [525, 1200],
  sec: [980, 390], cSec: [980, 635], hSec: [980, 780], hMed: [1010, 780], cMed: [1010, 925], med: [1015, 1180],
  majW: [1270, 780], maj: [1500, 640], majC: [1350, 780], majE: [1730, 780], majS: [1500, 940],
  hKit: [2100, 780], cKit: [2100, 635], kit: [2100, 380], cSto: [2100, 925], sto: [2110, 1210],
  ckW: [2580, 780], ck: [2740, 780], ckTop: [2680, 660], cCom: [2680, 560], comB: [2680, 470], com: [2600, 360],
  ckBot: [2680, 900], cFuel: [2680, 1000], fuelT: [2680, 1100], fuel: [2630, 1220],
  air: [1500, 280], airW: [1230, 330], airE: [1775, 330], airS: [1500, 460],
  libN: [1500, 1100], lib: [1500, 1300], libW: [1240, 1270], libE: [1775, 1270],
  tailG: [280, 450], tail1: [205, 450], tailH: [330, 780], tail2: [205, 780], tailE: [280, 1170], tail3: [205, 1170],
  kitC: [2385, 350], stoF: [2410, 1250]
};
const EDGES = [
  ["gen", "cGen"], ["cGen", "hGen"], ["hGen", "cEng"], ["cEng", "eng"], ["hGen", "hSec"], ["sec", "cSec"], ["cSec", "hSec"],
  ["hSec", "hMed"], ["hMed", "cMed"], ["cMed", "med"], ["hMed", "majW"], ["majW", "majC"], ["majC", "maj"], ["majC", "majS"],
  ["maj", "majE"], ["majS", "majE"], ["majE", "hKit"], ["hKit", "cKit"], ["cKit", "kit"], ["hKit", "cSto"], ["cSto", "sto"],
  ["hKit", "ckW"], ["ckW", "ck"], ["ck", "ckTop"], ["ckTop", "cCom"], ["cCom", "comB"], ["comB", "com"],
  ["ck", "ckBot"], ["ckBot", "cFuel"], ["cFuel", "fuelT"], ["fuelT", "fuel"],
  ["sec", "airW"], ["airW", "air"], ["air", "airE"], ["airE", "kit"], ["air", "airS"], ["airS", "maj"],
  ["majS", "libN"], ["libN", "lib"], ["med", "libW"], ["libW", "lib"], ["lib", "libE"], ["libE", "sto"],
  ["gen", "tailG"], ["tailG", "tail1"], ["tail1", "tail2"], ["hGen", "tailH"], ["tailH", "tail2"], ["tail2", "tail3"], ["tail3", "tailE"], ["tailE", "eng"],
  ["kit", "kitC"], ["kitC", "com"], ["sto", "stoF"], ["stoF", "fuel"]
];
const ADJ = {};
for (const [a, b] of EDGES) { (ADJ[a] ||= []).push(b); (ADJ[b] ||= []).push(a); }
const pt = (k) => ({ x: NODES[k][0], y: NODES[k][1] });

function nearestNode(p) {
  let best = null, bd = Infinity;
  for (const k in NODES) {
    const n = pt(k), d = dist(p, n);
    if (d < bd && lineClear(p.x, p.y, n.x, n.y)) { best = k; bd = d; }
  }
  if (best) return best;
  for (const k in NODES) { const d = dist(p, pt(k)); if (d < bd) { best = k; bd = d; } }
  return best;
}

function findPath(from, to) {
  if (lineClear(from.x, from.y, to.x, to.y)) return [to];
  const a = nearestNode(from), b = nearestNode(to);
  const prev = { [a]: null }, q = [a];
  while (q.length) {
    const k = q.shift();
    if (k === b) break;
    for (const n of ADJ[k] || []) if (!(n in prev)) { prev[n] = k; q.push(n); }
  }
  const path = [];
  for (let k = b; k; k = prev[k]) path.unshift(pt(k));
  path.push(to);
  return path;
}

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
      if (r.phase === "lobby") this.wander(bot, p, ["maj", "majS", "majW", "majE", "hKit", "hMed"]);
      else if (r.phase === "play" && now >= r.playStartsAt) {
        if (p.role === "imp" && p.alive) this.imp(bot, p, now);
        else this.crew(bot, p, now);
      }
      if (r.phase === "lobby" || r.phase === "play") this.step(bot, p);
    }
  }

  wander(bot, p, nodes = Object.keys(NODES)) {
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
