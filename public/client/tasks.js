// Quick mini-games (each takes a few seconds). Every game calls done() once when finished.
const AR = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => AR[d]);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const rand = (a, b) => a + Math.random() * (b - a);

const GAMES = {
  /** Press and hold until the bar fills. */
  hold(body, done, o = {}) {
    const icon = o.icon || "☕";
    const note = el("div", "mg-note", o.note || "اضغط مطوّلاً حتى يمتلئ المؤشر");
    const btn = el("button", "mg-hold", icon);
    const meter = el("div", "mg-meter"); const fill = el("div"); meter.append(fill);
    body.append(note, btn, meter);
    let v = 0, on = false, last = performance.now(), raf;
    const loop = (now) => {
      const dt = (now - last) / 1000; last = now;
      v = Math.max(0, Math.min(1, v + (on ? dt / 2.2 : -dt / 4)));
      fill.style.width = v * 100 + "%";
      if (v >= 1) return done();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const set = (s) => (e) => { e.preventDefault(); on = s; btn.classList.toggle("on", s); };
    btn.addEventListener("pointerdown", set(true));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, set(false));
    return () => cancelAnimationFrame(raf);
  },

  /** Tap numbered tiles in order. */
  sequence(body, done, o = {}) {
    body.append(el("div", "mg-note", o.note || "اضغط الأرقام بالترتيب من ١ إلى ٨"));
    const grid = el("div", "mg-grid");
    const nums = [1, 2, 3, 4, 5, 6, 7, 8].sort(() => Math.random() - 0.5);
    let next = 1;
    for (const n of nums) {
      const b = el("button", "mg-tile", ar(n));
      b.onclick = () => {
        if (n === next) {
          b.classList.add("done"); next++;
          if (next > 8) done();
        } else {
          b.classList.remove("bad"); void b.offsetWidth; b.classList.add("bad");
        }
      };
      grid.append(b);
    }
    body.append(grid);
  },

  /** Match a target value with a slider (frequency / course / pressure). */
  slider(body, done, o = {}) {
    body.append(el("div", "mg-note", o.note || "حرّك المؤشر حتى تتطابق الموجتان"));
    const cv = el("canvas", "mg-wave"); cv.width = 460; cv.height = 110;
    const box = el("div", "mg-slider");
    const input = el("input"); input.type = "range"; input.min = 0; input.max = 100; input.value = 0;
    box.append(cv, input); body.append(box);
    const target = Math.round(rand(25, 90));
    let held = 0, last = performance.now(), raf;
    const g = cv.getContext("2d");
    const wave = (freq, color, phase) => {
      g.strokeStyle = color; g.lineWidth = 3; g.beginPath();
      for (let x = 0; x <= 460; x += 4) g.lineTo(x, 55 + Math.sin(x * (0.02 + freq * 0.0006) + phase) * 32);
      g.stroke();
    };
    const loop = (now) => {
      const dt = (now - last) / 1000; last = now;
      const v = Number(input.value), ok = Math.abs(v - target) <= 3;
      g.fillStyle = "#0d1420"; g.fillRect(0, 0, 460, 110);
      wave(target, "rgba(111,224,181,.9)", now / 400);
      wave(v, ok ? "#6fe0b5" : "#e6a817", now / 400);
      held = ok ? held + dt : 0;
      if (held > 0.6) return done();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  },

  /** Connect each coloured wire to its match. */
  wires(body, done) {
    body.append(el("div", "mg-note", "اضغط سلكًا من اليسار ثم مثيله في اليمين"));
    const colors = ["#c0392b", "#e6a817", "#16a085", "#4fb3e8"];
    const wrap = el("div", "mg-wires");
    const L = el("div", "col"), Rc = el("div", "col");
    const right = colors.slice().sort(() => Math.random() - 0.5);
    let sel = null, left = 4;
    for (const c of colors.slice().sort(() => Math.random() - 0.5)) {
      const b = el("button", "mg-wire"); b.style.background = c; b.dataset.c = c;
      b.onclick = () => { if (b.classList.contains("done")) return; L.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); sel = b; };
      L.append(b);
    }
    for (const c of right) {
      const b = el("button", "mg-wire"); b.style.background = c; b.dataset.c = c;
      b.onclick = () => {
        if (!sel || b.classList.contains("done")) return;
        if (sel.dataset.c === c) {
          sel.classList.remove("sel"); sel.classList.add("done"); b.classList.add("done"); sel = null;
          if (--left === 0) done();
        } else { b.classList.remove("bad"); void b.offsetWidth; b.classList.add("bad"); }
      };
      Rc.append(b);
    }
    wrap.append(L, Rc); body.append(wrap);
  },

  /** Flip every switch on. */
  switches(body, done, o = {}) {
    body.append(el("div", "mg-note", o.note || "شغّل كل المفاتيح"));
    const row = el("div", "mg-switches");
    const n = 6;
    for (let i = 0; i < n; i++) {
      const b = el("button", "mg-switch" + (Math.random() < 0.35 ? " on" : ""));
      b.onclick = () => {
        b.classList.toggle("on");
        if (row.querySelectorAll(".on").length === n) done();
      };
      row.append(b);
    }
    if (row.querySelectorAll(".on").length === n) row.firstChild.classList.remove("on");
    body.append(row);
  },

  /** Tap the moving bits (leaves out of a filter / coals for the incense). */
  clicks(body, done, o = {}) {
    body.append(el("div", "mg-note", o.note || "اضغط على كل العناصر"));
    const field = el("div", "mg-field");
    body.append(field);
    let left = 7;
    const items = [];
    for (let i = 0; i < left; i++) {
      const b = el("button", "mg-bit", o.icon || "🍂");
      const it = { b, x: rand(10, 90), y: rand(12, 88), vx: rand(-14, 14), vy: rand(-14, 14) };
      b.onpointerdown = (e) => { e.preventDefault(); b.remove(); it.gone = true; if (--left === 0) done(); };
      items.push(it); field.append(b);
    }
    let last = performance.now(), raf;
    const loop = (now) => {
      const dt = (now - last) / 1000; last = now;
      for (const it of items) {
        if (it.gone) continue;
        it.x += it.vx * dt; it.y += it.vy * dt;
        if (it.x < 6 || it.x > 94) it.vx *= -1;
        if (it.y < 8 || it.y > 92) it.vy *= -1;
        it.b.style.left = it.x + "%"; it.b.style.top = it.y + "%";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  },

  /** Stand still while the scanner runs. */
  scan(body, done) {
    body.append(el("div", "mg-note", "قف على منصة الفحص حتى يكتمل"));
    const meter = el("div", "mg-meter"); const fill = el("div"); meter.append(fill);
    const label = el("div", "mg-note", "");
    body.append(el("div", "mg-hold on", "🩺"), meter, label);
    const start = performance.now();
    let raf;
    const loop = (now) => {
      const v = Math.min(1, (now - start) / 5000);
      fill.style.width = v * 100 + "%";
      label.textContent = `النبض طبيعي — ${ar(Math.round(v * 100))}٪`;
      if (v >= 1) return done();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  },

  /** Type the code shown on screen. */
  code(body, done) {
    const code = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join("");
    body.append(el("div", "mg-note", "أدخل الرمز الظاهر"), el("div", "mg-code", ar(code)));
    const entry = el("div", "mg-entry", "");
    const pad = el("div", "mg-keypad");
    let typed = "";
    for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"]) {
      const b = el("button", "mg-tile", /\d/.test(k) ? ar(k) : k);
      b.onclick = () => {
        if (k === "⌫") typed = typed.slice(0, -1);
        else if (k === "✓") {
          if (typed === code) return done();
          typed = ""; entry.classList.remove("bad"); void entry.offsetWidth; entry.classList.add("bad");
        } else if (typed.length < 4) typed += k;
        entry.textContent = ar(typed).padEnd(4, "•");
        if (typed === code) setTimeout(done, 150);
      };
      pad.append(b);
    }
    entry.textContent = "••••";
    body.append(entry, pad);
  }
};

const VARIANTS = {
  coffee: { type: "hold", icon: "☕", note: "اضغط مطوّلاً لتصب القهوة في الفنجال" },
  engineFuel: { type: "hold", icon: "⛽", note: "اضغط مطوّلاً لتعبئة المحرك" },
  dates: { type: "sequence", note: "قدّم أطباق التمر بالترتيب من ١ إلى ٨" },
  cargo: { type: "sequence", note: "رتّب صناديق الشحنة بالترتيب من ١ إلى ٨" },
  course: { type: "slider", note: "اضبط المسار حتى تتطابق الموجتان" },
  radio: { type: "slider", note: "اضبط التردد حتى تتطابق الموجتان" },
  gauge: { type: "slider", note: "عاير الضغط حتى تتطابق الموجتان" },
  filter: { type: "clicks", icon: "🍂", note: "أخرج الأوراق من المرشح" },
  incense: { type: "clicks", icon: "🔥", note: "أشعل جمرات المبخرة" },
  power: { type: "switches", note: "وزّع الطاقة: شغّل كل المفاتيح" },
  fixLights: { type: "switches", note: "أعد الأنوار: شغّل كل المفاتيح" },
  fixComms: { type: "slider", note: "أعد الاتصال: طابق التردد" }
};

/** Mount a mini-game into `body`. Returns a cleanup function. */
export function mountGame(body, key, fallbackType, done) {
  body.innerHTML = "";
  const v = VARIANTS[key] || {};
  const game = GAMES[v.type || fallbackType] || GAMES.hold;
  let finished = false;
  const once = () => { if (!finished) { finished = true; done(); } };
  const cleanup = game(body, once, v);
  return () => { finished = true; cleanup && cleanup(); };
}
