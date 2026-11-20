// Keyboard (WASD / arrows + action keys) and a touch joystick. Exposes a normalised move vector.

export class Input {
  constructor(joyEl) {
    this.keys = new Set();
    this.joy = { x: 0, y: 0, id: null };
    this.onKey = null;
    this.enabled = true;

    addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (!e.repeat && this.onKey) this.onKey(k, e);
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener("blur", () => this.keys.clear());

    if (matchMedia("(pointer: coarse)").matches || "ontouchstart" in window) document.body.classList.add("touch");
    addEventListener("touchstart", () => document.body.classList.add("touch"), { once: true, passive: true });

    const knob = joyEl.querySelector(".knob");
    const R = 46;
    const setKnob = (x, y) => { knob.style.transform = `translate(${x * R}px, ${y * R}px)`; };
    const move = (e) => {
      const r = joyEl.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / R;
      let y = (e.clientY - (r.top + r.height / 2)) / R;
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      this.joy.x = Math.abs(x) < 0.15 ? 0 : x;
      this.joy.y = Math.abs(y) < 0.15 ? 0 : y;
      setKnob(x, y);
    };
    joyEl.addEventListener("pointerdown", (e) => {
      this.joy.id = e.pointerId;
      joyEl.setPointerCapture(e.pointerId);
      move(e);
    });
    joyEl.addEventListener("pointermove", (e) => { if (e.pointerId === this.joy.id) move(e); });
    const end = (e) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy = { x: 0, y: 0, id: null };
      setKnob(0, 0);
    };
    joyEl.addEventListener("pointerup", end);
    joyEl.addEventListener("pointercancel", end);
  }

  vector() {
    if (!this.enabled) return { x: 0, y: 0 };
    const k = this.keys;
    let x = (k.has("d") || k.has("arrowright") || k.has("ي") ? 1 : 0) - (k.has("a") || k.has("arrowleft") || k.has("ش") ? 1 : 0);
    let y = (k.has("s") || k.has("arrowdown") || k.has("س") ? 1 : 0) - (k.has("w") || k.has("arrowup") || k.has("ص") ? 1 : 0);
    if (!x && !y) { x = this.joy.x; y = this.joy.y; }
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }
}
