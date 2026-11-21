// Drop-in replacement for public/client/net.js used by the offline preview:
// the authoritative Room runs inside the page, with computer players.
import { Room } from "../server/room.js";
import { randomCode, TICK_MS } from "../public/shared/config.js";

export class Net {
  static async newCode() {
    return { code: randomCode() };
  }

  constructor({ code, onMessage, onStatus }) {
    this.code = code;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.offset = 0;
    this.bestRtt = 0;
    this.rtt = 0;
  }

  connect(hello) {
    const room = new Room(this.code);
    this.room = room;
    this.conn = { send: (s) => this.onMessage(JSON.parse(s)), close() {} };
    room.connect(this.conn);
    room.message(this.conn, { t: "hello", ...hello(), token: "" });
    this.bots = room.bots;
    this.bots.setCount(5);
    this.timer = setInterval(() => room.tick(), TICK_MS);
    window.dispatchEvent(new CustomEvent("preview-room", { detail: this }));
  }

  send(msg) {
    if (msg.t === "ping") return;
    this.room.message(this.conn, msg);
  }

  serverNow() {
    return Date.now();
  }

  close() {
    clearInterval(this.timer);
  }
}
