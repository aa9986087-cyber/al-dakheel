// Node server: serves public/ and runs rooms over WebSocket. Used for local play and tests,
// and works as a production server on any Node host (VPS, Render, Railway, Fly...).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Room } from "./room.js";
import { TICK_MS, normalizeCode, isValidCode, randomCode } from "../public/shared/config.js";

const ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".ico": "image/x-icon"
};

export function startServer({ port = 8787, host = "0.0.0.0", log = true } = {}) {
  const rooms = new Map();

  function getRoom(code, create) {
    let room = rooms.get(code);
    if (!room && create) {
      room = new Room(code);
      room.timer = setInterval(() => {
        room.tick();
        if (room.isDead()) { clearInterval(room.timer); rooms.delete(code); }
      }, TICK_MS);
      rooms.set(code, room);
    }
    return room;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/new") {
      let code;
      do code = randomCode(); while (rooms.has(code));
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ code }));
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (path.includes("..")) { res.writeHead(400); return res.end(); }
    if (!path || !extname(path)) path = "index.html";
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream", "cache-control": "no-cache" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    const m = url.pathname.match(/^\/ws\/([A-Za-z0-9]+)$/);
    const code = m && normalizeCode(m[1]);
    if (!code || !isValidCode(code)) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      const room = getRoom(code, url.searchParams.get("create") === "1");
      if (!room) {
        ws.send(JSON.stringify({ t: "error", reason: "not_found" }));
        return ws.close();
      }
      const conn = { send: (s) => ws.readyState === 1 && ws.send(s), close: () => ws.close() };
      room.connect(conn);
      ws.on("message", (data) => room.message(conn, data.toString()));
      ws.on("close", () => room.disconnect(conn));
      ws.on("error", () => room.disconnect(conn));
    });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const actual = server.address().port;
      if (log) console.log(`الدخيل يعمل على http://localhost:${actual}`);
      resolve({
        port: actual, rooms,
        close: () => new Promise((r) => {
          for (const room of rooms.values()) clearInterval(room.timer);
          for (const c of wss.clients) c.terminate();
          server.close(r);
        })
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer({ port: Number(process.env.PORT) || 8787 });
}
