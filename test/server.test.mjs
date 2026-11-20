// End-to-end over real WebSockets against the Node server.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startServer } from "../server/dev.mjs";

const srv = await startServer({ port: 0, log: false });
after(() => srv.close());
const base = `http://127.0.0.1:${srv.port}`;

function client(code, create, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/${code}${create ? "?create=1" : ""}`);
  const inbox = [];
  const waiters = [];
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const wait = (pred, ms = 3000) => {
    const hit = inbox.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      waiters.push({ pred, res });
      setTimeout(() => rej(new Error("timeout")), ms);
    });
  };
  const open = new Promise((r) => ws.on("open", r)).then(() => ws.send(JSON.stringify({ t: "hello", token: "", name })));
  return { ws, inbox, wait, open, send: (m) => ws.send(JSON.stringify(m)) };
}

test("serves the game page", async () => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /الدخيل/);
  const js = await fetch(base + "/shared/map.js");
  assert.equal(js.status, 200);
});

test("create a room, join by code, start, and receive secret roles", async () => {
  const { code } = await (await fetch(base + "/api/new")).json();
  assert.match(code, /^[A-Z0-9]{5}$/);
  const host = client(code, true, "المضيف");
  await host.open;
  await host.wait((m) => m.t === "welcome");
  const guests = ["سارة", "فهد", "نورة"].map((n) => client(code, false, n));
  await Promise.all(guests.map((g) => g.open));
  await host.wait((m) => m.t === "state" && m.players.length === 4);
  host.send({ t: "start" });
  const all = [host, ...guests];
  const states = await Promise.all(all.map((c) => c.wait((m) => m.t === "state" && m.phase === "play")));
  const roles = states.map((s) => s.role);
  assert.equal(roles.filter((r) => r === "imp").length, 1);
  for (const s of states) {
    if (s.role === "crew") assert.ok(s.players.every((p) => p.id === s.me || p.role === undefined));
  }
  // Positions stream in.
  await host.wait((m) => m.t === "p" && m.d.length === 4);
  for (const c of all) c.ws.close();
});

test("joining a room that does not exist is refused", async () => {
  const c = client("ZZZZZ", false, "تائه");
  await c.open;
  const m = await c.wait((x) => x.t === "error");
  assert.equal(m.reason, "not_found");
});
