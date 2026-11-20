// Tiny Web Audio sound effects (no files). Mute choice is remembered in the browser.
let ctx = null;
let muted = false;
try { muted = localStorage.getItem("dakheel-muted") === "1"; } catch { /* storage blocked */ }

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = "sine", vol = 0.15, at = 0, slide = 0 } = {}) {
  if (muted) return;
  const a = ac();
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  unlock() { try { ac(); } catch { /* no audio */ } },
  task() { tone(660, 0.12, { type: "triangle" }); tone(990, 0.2, { type: "triangle", at: 0.1 }); },
  kill() { tone(180, 0.35, { type: "sawtooth", vol: 0.12, slide: -120 }); },
  bell() { for (let i = 0; i < 3; i++) { tone(880, 0.5, { type: "triangle", vol: 0.12, at: i * 0.35 }); tone(1320, 0.4, { vol: 0.05, at: i * 0.35 }); } },
  report() { for (let i = 0; i < 4; i++) tone(i % 2 ? 520 : 740, 0.18, { type: "square", vol: 0.07, at: i * 0.18 }); },
  vote() { tone(520, 0.08, { type: "triangle" }); },
  alarm() { tone(440, 0.4, { type: "sawtooth", vol: 0.06, slide: 220 }); },
  eject() { tone(300, 1.2, { vol: 0.1, slide: -250 }); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, { type: "triangle", at: i * 0.15 })); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.45, { type: "triangle", at: i * 0.2 })); },
  start() { [392, 523, 659].forEach((f, i) => tone(f, 0.3, { type: "triangle", vol: 0.1, at: i * 0.12 })); },
  vent() { tone(120, 0.2, { type: "square", vol: 0.06, slide: 60 }); }
};

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem("dakheel-muted", muted ? "1" : "0"); } catch { /* ignore */ }
  return muted;
}
