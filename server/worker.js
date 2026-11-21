// Cloudflare entry point. Static files come from Workers Static Assets (public/);
// each room is one Durable Object instance (keyed by the room code) holding live WebSockets.
import { DurableObject } from "cloudflare:workers";
import { Room } from "./room.js";
import { TICK_MS, normalizeCode, isValidCode, randomCode } from "../public/shared/config.js";

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.timer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, ws] = Object.values(pair);
    ws.accept();
    if (!this.room) {
      if (url.searchParams.get("create") !== "1") {
        ws.send(JSON.stringify({ t: "error", reason: "not_found" }));
        ws.close(1000, "not_found");
        return new Response(null, { status: 101, webSocket: client });
      }
      this.room = new Room(code);
    }
    const room = this.room;
    const conn = { send: (s) => ws.send(s), close: () => ws.close(1000) };
    room.connect(conn);
    ws.addEventListener("message", (e) => room.message(conn, typeof e.data === "string" ? e.data : ""));
    ws.addEventListener("close", () => room.disconnect(conn));
    ws.addEventListener("error", () => room.disconnect(conn));
    if (!this.timer) {
      this.timer = setInterval(() => {
        room.tick();
        if (room.isDead()) {
          clearInterval(this.timer);
          this.timer = null;
          this.room = null;
        }
      }, TICK_MS);
    }
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/new") {
      return Response.json({ code: randomCode() }, { headers: { "cache-control": "no-store" } });
    }
    const m = url.pathname.match(/^\/ws\/([A-Za-z0-9]+)$/);
    if (m) {
      const code = normalizeCode(m[1]);
      if (!isValidCode(code)) return new Response("bad code", { status: 400 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const inner = new URL(request.url);
      inner.searchParams.set("code", code);
      return stub.fetch(new Request(inner, request));
    }
    return env.ASSETS.fetch(request);
  }
};
