// WebSocket link to a room, with automatic reconnect (the session token keeps your seat) and server clock sync.

export class Net {
  constructor({ code, create, onMessage, onStatus }) {
    this.code = code;
    this.create = create;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.tries = 0;
    this.closed = false;
    this.offset = 0; // serverNow - localNow
    this.bestRtt = Infinity;
    this.hello = null;
  }

  url() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws/${this.code}${this.create ? "?create=1" : ""}`;
  }

  connect(hello) {
    this.hello = hello;
    this.open();
  }

  open() {
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      this.create = false; // later reconnects join the existing room
      this.onStatus?.("open");
      this.send({ t: "hello", ...this.hello() });
      this.ping();
      clearInterval(this.pinger);
      this.pinger = setInterval(() => this.ping(), 5000);
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === "pong") return this.pong(msg);
      if (msg.t === "error") this.closed = msg.reason !== undefined;
      this.onMessage(msg);
    };
    ws.onclose = () => {
      clearInterval(this.pinger);
      if (this.closed) return;
      this.onStatus?.("lost");
      const delay = Math.min(5000, 400 * 2 ** this.tries++);
      setTimeout(() => !this.closed && this.open(), delay);
    };
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  ping() {
    this.send({ t: "ping", c: performance.now() });
  }

  pong(msg) {
    const rtt = performance.now() - msg.c;
    // Keep the estimate from the fastest round trip: it has the least error.
    if (rtt <= this.bestRtt * 1.2) {
      this.bestRtt = Math.min(this.bestRtt, rtt);
      this.offset = msg.now + rtt / 2 - Date.now();
    }
    this.rtt = rtt;
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  close() {
    this.closed = true;
    clearInterval(this.pinger);
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}
