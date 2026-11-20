import { test } from "node:test";
import assert from "node:assert/strict";
import { Room } from "../server/room.js";
import { MAP, TASK_BY_ID } from "../public/shared/map.js";
import { TIMES } from "../public/shared/config.js";

function setup(n = 5, settings = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const room = new Room("TESTX", { now: clock.now, random });
  const conns = [];
  for (let i = 0; i < n; i++) {
    const conn = { inbox: [], send(s) { this.inbox.push(JSON.parse(s)); }, close() { this.closed = true; } };
    room.connect(conn);
    room.message(conn, JSON.stringify({ t: "hello", token: "tok" + i, name: "لاعب" + i }));
    conns.push(conn);
  }
  Object.assign(room.settings, settings);
  const ids = conns.map((c) => c.inbox.find((m) => m.t === "welcome").id);
  const send = (i, msg) => room.message(conns[i], JSON.stringify(msg));
  const p = (i) => room.players.get(ids[i]);
  const lastState = (i) => conns[i].inbox.filter((m) => m.t === "state").at(-1);
  return { room, clock, conns, ids, send, p, lastState };
}

function startPlaying(g) {
  g.send(0, { t: "start" });
  g.clock.advance(TIMES.roleReveal + 1);
  g.room.tick();
  const imps = [...g.room.players.values()].filter((p) => p.role === "imp");
  const crew = [...g.room.players.values()].filter((p) => p.role === "crew");
  const idx = (pl) => g.ids.indexOf(pl.id);
  return { imps, crew, idx };
}

test("first player is host and names stay unique", () => {
  const g = setup(3);
  assert.equal(g.p(0).host, true);
  assert.equal(g.p(1).host, false);
  g.send(1, { t: "profile", name: "لاعب0" });
  assert.equal(g.p(1).name, "لاعب0 2");
});

test("only the host can start, and only with enough players", () => {
  const g = setup(2);
  g.send(0, { t: "start" });
  assert.equal(g.room.phase, "lobby");
  const g2 = setup(4);
  g2.send(1, { t: "start" });
  assert.equal(g2.room.phase, "lobby");
  g2.send(0, { t: "start" });
  assert.equal(g2.room.phase, "play");
});

test("roles: impostor count is clamped and roles are secret", () => {
  const g = setup(5, { impostors: 3 });
  const { imps, crew } = startPlaying(g);
  assert.equal(imps.length, 1, "5 players allow only one impostor");
  assert.equal(crew.length, 4);
  g.room.dirty = true; g.room.tick();
  const crewIdx = g.ids.indexOf(crew[0].id);
  const view = g.lastState(crewIdx);
  assert.equal(view.role, "crew");
  assert.ok(view.players.every((p) => p.role === undefined || p.id === crew[0].id), "crew must not see other roles");
  const impView = g.lastState(g.ids.indexOf(imps[0].id));
  assert.equal(impView.players.find((p) => p.id === imps[0].id).role, "imp");
  assert.equal(crew[0].tasks.length, g.room.settings.tasks);
});

test("kill respects cooldown and range, leaves a body, and report starts a meeting", () => {
  const g = setup(5);
  const { imps, crew, idx } = startPlaying(g);
  const imp = imps[0], victim = crew[0];
  imp.x = victim.x + 40; imp.y = victim.y;
  g.send(idx(imp), { t: "kill", target: victim.id });
  assert.equal(victim.alive, true, "cooldown blocks the first kill");
  g.clock.advance(15000);
  victim.x = imp.x + 500;
  g.send(idx(imp), { t: "kill", target: victim.id });
  assert.equal(victim.alive, true, "out of range");
  victim.x = imp.x + 50;
  g.send(idx(imp), { t: "kill", target: victim.id });
  assert.equal(victim.alive, false);
  assert.equal(g.room.bodies.length, 1);
  // Living crew do not learn about the death yet.
  g.room.tick();
  const witness = crew[1];
  assert.equal(g.lastState(idx(witness)).players.find((p) => p.id === victim.id).dead, false);
  witness.x = g.room.bodies[0].x + 30; witness.y = g.room.bodies[0].y;
  g.send(idx(witness), { t: "report" });
  assert.equal(g.room.phase, "meeting");
  assert.equal(g.room.meeting.body, victim.id);
  assert.equal(g.room.bodies.length, 0);
});

test("voting out the only impostor gives the crew the win", () => {
  const g = setup(5);
  const { imps, crew, idx } = startPlaying(g);
  const caller = crew[0];
  caller.x = MAP.button.x; caller.y = MAP.button.y;
  g.clock.advance(11000);
  g.send(idx(caller), { t: "emergency" });
  assert.equal(g.room.phase, "meeting");
  g.clock.advance(1);
  for (const c of crew) g.send(idx(c), { t: "vote", target: imps[0].id });
  g.send(idx(imps[0]), { t: "vote", target: crew[1].id });
  assert.equal(g.room.phase, "eject");
  assert.equal(g.room.eject.target, imps[0].id);
  assert.equal(g.room.eject.wasImp, true);
  g.clock.advance(TIMES.eject + 1);
  g.room.tick();
  assert.equal(g.room.phase, "end");
  assert.equal(g.room.result.winner, "crew");
});

test("a tie ejects nobody and play resumes", () => {
  const g = setup(4);
  const { crew, imps, idx } = startPlaying(g);
  crew[0].x = MAP.button.x; crew[0].y = MAP.button.y;
  g.clock.advance(11000);
  g.send(idx(crew[0]), { t: "emergency" });
  g.clock.advance(1);
  g.send(idx(crew[0]), { t: "vote", target: crew[1].id });
  g.send(idx(crew[1]), { t: "vote", target: crew[0].id });
  g.send(idx(crew[2]), { t: "vote", target: crew[1].id });
  g.send(idx(imps[0]), { t: "vote", target: crew[0].id });
  assert.equal(g.room.eject.target, null);
  assert.equal(g.room.eject.tie, true);
  g.clock.advance(TIMES.eject + 1);
  g.room.tick();
  assert.equal(g.room.phase, "play");
});

test("impostors win when they equal the crew", () => {
  const g = setup(4);
  const { imps, crew, idx } = startPlaying(g);
  const imp = imps[0];
  g.clock.advance(20000);
  imp.x = crew[0].x; imp.y = crew[0].y;
  g.send(idx(imp), { t: "kill", target: crew[0].id });
  assert.equal(g.room.phase, "play");
  g.clock.advance(g.room.settings.killCooldown * 1000);
  imp.x = crew[1].x; imp.y = crew[1].y;
  g.send(idx(imp), { t: "kill", target: crew[1].id });
  assert.equal(g.room.phase, "end");
  assert.equal(g.room.result.winner, "imp");
});

test("finishing every task wins for the crew; tasks need to be near the station", () => {
  const g = setup(4);
  const { crew, idx } = startPlaying(g);
  const c0 = crew[0];
  const first = c0.tasks[0].id;
  c0.x = 0; c0.y = 0;
  g.send(idx(c0), { t: "task", id: first });
  assert.equal(c0.tasks[0].done, false, "too far away");
  for (const c of crew) {
    for (const t of c.tasks) {
      const def = TASK_BY_ID[t.id];
      c.x = def.x; c.y = def.y;
      g.send(idx(c), { t: "task", id: t.id });
    }
  }
  assert.equal(g.room.phase, "end");
  assert.equal(g.room.result.winner, "crew");
});

test("fuel leak needs both panels held at once, otherwise impostors win", () => {
  const g = setup(5);
  const { imps, crew, idx } = startPlaying(g);
  g.clock.advance(11000);
  g.send(idx(imps[0]), { t: "sabotage", kind: "fuel" });
  assert.equal(g.room.sab.kind, "fuel");
  const [a, b] = crew;
  Object.assign(a, MAP.fixes.fuelA);
  Object.assign(b, MAP.fixes.fuelB);
  g.send(idx(a), { t: "hold", panel: "A", on: true });
  assert.ok(g.room.sab, "one panel is not enough");
  g.send(idx(b), { t: "hold", panel: "B", on: true });
  assert.equal(g.room.sab, null);

  g.clock.advance(TIMES.sabotageCooldown);
  g.send(idx(imps[0]), { t: "sabotage", kind: "fuel" });
  g.clock.advance(TIMES.critical + 1);
  g.room.tick();
  assert.equal(g.room.result.winner, "imp");
});

test("lights sabotage is fixed at the generator panel", () => {
  const g = setup(4);
  const { imps, crew, idx } = startPlaying(g);
  g.clock.advance(11000);
  g.send(idx(imps[0]), { t: "sabotage", kind: "lights" });
  g.send(idx(crew[0]), { t: "fix", kind: "lights" });
  assert.ok(g.room.sab, "must be at the panel");
  Object.assign(crew[0], MAP.fixes.lights);
  g.send(idx(crew[0]), { t: "fix", kind: "lights" });
  assert.equal(g.room.sab, null);
});

test("vents: enter, travel along links only, and hide from crew", () => {
  const g = setup(4);
  const { imps, crew, idx } = startPlaying(g);
  const imp = imps[0];
  const v = MAP.vents[0];
  imp.x = v.x + 10; imp.y = v.y;
  g.send(idx(imp), { t: "vent", action: "enter" });
  assert.equal(imp.vent, v.id);
  g.send(idx(imp), { t: "vent", action: "move", to: "vFuel" });
  assert.equal(imp.vent, v.id, "not linked");
  g.send(idx(imp), { t: "vent", action: "move", to: v.links[0] });
  assert.equal(imp.vent, v.links[0]);
  g.room.tick();
  const crewPos = g.conns[idx(crew[0])].inbox.filter((m) => m.t === "p").at(-1);
  assert.ok(!crewPos.d.some(([id]) => id === imp.id), "vented impostor is hidden");
});

test("movement validation rejects walking through walls", () => {
  const g = setup(3);
  const p = g.p(0);
  const tp = p.tp;
  // From the majlis straight up into the wall above it.
  g.clock.advance(100);
  g.send(0, { t: "pos", x: p.x, y: 420, tp });
  assert.notEqual(p.y, 420);
  assert.equal(p.tp, tp + 1, "client is told to snap back");
  g.clock.advance(100);
  g.send(0, { t: "pos", x: p.x + 10, y: p.y, tp: p.tp });
  assert.equal(Math.round(p.x), Math.round(p.x));
});

test("disconnect keeps the seat during a game and rejoining with the token resumes it", () => {
  const g = setup(4);
  startPlaying(g);
  const pl = g.p(2);
  g.room.disconnect(g.conns[2]);
  assert.equal(pl.connected, false);
  const conn = { inbox: [], send(s) { this.inbox.push(JSON.parse(s)); }, close() {} };
  g.room.connect(conn);
  g.room.message(conn, JSON.stringify({ t: "hello", token: "tok2" }));
  assert.equal(pl.connected, true);
  assert.equal(conn.inbox[0].id, pl.id);
  // Strangers cannot join a running game.
  const late = { inbox: [], send(s) { this.inbox.push(JSON.parse(s)); }, close() { this.closed = true; } };
  g.room.connect(late);
  g.room.message(late, JSON.stringify({ t: "hello", token: "new", name: "متأخر" }));
  assert.equal(late.inbox[0].reason, "started");
});

test("votes count from the first second of a meeting", () => {
  const g = setup(4);
  const { crew, idx } = startPlaying(g);
  crew[0].x = MAP.button.x; crew[0].y = MAP.button.y;
  g.clock.advance(11000);
  g.send(idx(crew[0]), { t: "emergency" });
  g.send(idx(crew[1]), { t: "vote", target: "skip" });
  assert.equal(crew[1].vote, "skip");
});

test("camera lights: on while someone watches at the console, off after", () => {
  const g = setup(4);
  const { crew, idx } = startPlaying(g);
  const c = crew[0];
  g.send(idx(c), { t: "cams", on: true });
  g.room.tick();
  assert.equal(g.lastState(idx(crew[1])).camsOn, false, "too far from the console");
  Object.assign(c, MAP.console);
  g.send(idx(c), { t: "cams", on: true });
  g.room.tick();
  assert.equal(g.lastState(idx(crew[1])).camsOn, true);
  g.send(idx(c), { t: "cams", on: false });
  g.room.tick();
  assert.equal(g.lastState(idx(crew[1])).camsOn, false);
});

test("host passes on when the host leaves", () => {
  const g = setup(3);
  g.room.disconnect(g.conns[0]);
  assert.equal(g.p(1).host, true);
});
