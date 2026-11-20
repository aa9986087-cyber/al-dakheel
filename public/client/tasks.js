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

  /** Connect each coloured wire to its match: tap a left plug, then the matching right plug. */
  wires(body, done) {
    body.append(el("div", "mg-note", "اضغط قابسًا من اليسار ثم مثيله في اليمين"));
    const colors = ["#e0524f", "#e6a817", "#2bb3a0", "#4fb3e8"];
    const wrap = el("div", "mg-wires");
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 420 230");
    svg.setAttribute("preserveAspectRatio", "none");
    wrap.append(svg);
    const left = colors.slice().sort(() => Math.random() - 0.5);
    const right = colors.slice().sort(() => Math.random() - 0.5);
    const Y = (i) => 22 + i * 54;
    const plug = (c, i, side) => {
      const b = el("button", "mg-wire");
      b.style.background = c; b.style.top = Y(i) + "px";
      b.style[side === "L" ? "left" : "right"] = "0";
      b.dataset.c = c; b.dataset.i = i;
      return b;
    };
    const line = (x1, y1, x2, y2, c) => {
      const p = document.createElementNS(svgNS, "path");
      p.setAttribute("d", `M${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`);
      p.setAttribute("stroke", c); p.setAttribute("stroke-width", "10"); p.setAttribute("fill", "none"); p.setAttribute("stroke-linecap", "round");
      p.style.filter = "drop-shadow(0 3px 0 #1d110a)";
      svg.append(p);
      const len = p.getTotalLength ? p.getTotalLength() : 400;
      p.style.strokeDasharray = len; p.style.strokeDashoffset = len; p.style.transition = "stroke-dashoffset .35s ease-out";
      requestAnimationFrame(() => (p.style.strokeDashoffset = 0));
    };
    let sel = null, todo = 4;
    left.forEach((c, i) => {
      const b = plug(c, i, "L");
      b.onclick = () => { if (b.classList.contains("done")) return; wrap.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); sel = b; };
      wrap.append(b);
    });
    right.forEach((c, i) => {
      const b = plug(c, i, "R");
      b.onclick = () => {
        if (!sel || b.classList.contains("done")) return;
        if (sel.dataset.c === c) {
          line(58, Y(+sel.dataset.i) + 17, 362, Y(i) + 17, c);
          sel.classList.remove("sel"); sel.classList.add("done"); b.classList.add("done"); sel = null;
          if (--todo === 0) setTimeout(done, 380);
        } else { b.classList.remove("bad"); void b.offsetWidth; b.classList.add("bad"); }
      };
      wrap.append(b);
    });
    body.append(wrap);
  },

  /** Pour Arabic coffee from the dallah into the finjan: hold, and stop inside the gold band. */
  pour(body, done) {
    body.append(el("div", "mg-note", "اضغط مطوّلاً لتصب القهوة، وارفع إصبعك داخل الحد الذهبي"));
    const cv = el("canvas", "mg-pour"); cv.width = 360; cv.height = 220;
    const btn = el("button", "btn gold", "صُبّ");
    btn.style.minWidth = "140px";
    body.append(cv, btn);
    const g = cv.getContext("2d");
    let level = 0, pouring = false, tilt = 0, raf, last = performance.now(), finished = false;
    const lo = 0.62, hi = 0.82;
    const draw = (now) => {
      const dt = (now - last) / 1000; last = now;
      tilt += ((pouring ? 1 : 0) - tilt) * Math.min(1, dt * 10);
      if (pouring && tilt > 0.6) level = Math.min(1.05, level + dt * 0.32);
      g.clearRect(0, 0, 360, 220);
      // table
      g.fillStyle = "#5a361d"; g.fillRect(0, 180, 360, 40);
      g.fillStyle = "#c9973f"; g.fillRect(0, 180, 360, 4);
      // finjan
      const fx = 230, fy = 175;
      g.fillStyle = "#f7f3ea"; g.strokeStyle = "#1d110a"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(fx - 34, fy - 56); g.lineTo(fx + 34, fy - 56); g.lineTo(fx + 24, fy); g.lineTo(fx - 24, fy); g.closePath(); g.fill(); g.stroke();
      g.save(); g.beginPath(); g.moveTo(fx - 31, fy - 53); g.lineTo(fx + 31, fy - 53); g.lineTo(fx + 22, fy - 3); g.lineTo(fx - 22, fy - 3); g.closePath(); g.clip();
      const h = 50 * Math.min(1, level);
      g.fillStyle = level > hi ? "#c0392b" : "#c99a3a"; g.fillRect(fx - 40, fy - 3 - h, 80, h);
      g.fillStyle = "rgba(255,240,200,.5)"; g.fillRect(fx - 40, fy - 3 - h, 80, 2);
      g.restore();
      g.strokeStyle = "#e6a817"; g.lineWidth = 2; g.setLineDash([5, 4]);
      g.beginPath(); g.moveTo(fx - 40, fy - 3 - 50 * lo); g.lineTo(fx + 40, fy - 3 - 50 * lo); g.moveTo(fx - 40, fy - 3 - 50 * hi); g.lineTo(fx + 40, fy - 3 - 50 * hi); g.stroke(); g.setLineDash([]);
      g.fillStyle = "rgba(230,168,23,.18)"; g.fillRect(fx - 40, fy - 3 - 50 * hi, 80, 50 * (hi - lo));
      // dallah
      g.save(); g.translate(110, 92); g.rotate(tilt * 0.75);
      g.fillStyle = "#e7c27a"; g.strokeStyle = "#1d110a"; g.lineWidth = 3;
      g.beginPath(); g.ellipse(0, 26, 40, 30, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-20, 4); g.lineTo(-14, -40); g.lineTo(14, -40); g.lineTo(20, 4); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(0, -62); g.lineTo(-18, -40); g.lineTo(18, -40); g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = "#e7c27a"; g.lineWidth = 9; g.beginPath(); g.moveTo(34, 14); g.quadraticCurveTo(66, -10, 72, -40); g.stroke();
      g.strokeStyle = "#1d110a"; g.lineWidth = 2; g.stroke();
      g.fillStyle = "rgba(255,255,255,.5)"; g.beginPath(); g.ellipse(-14, 18, 7, 13, -0.4, 0, Math.PI * 2); g.fill();
      g.restore();
      // stream
      if (pouring && tilt > 0.6 && level < 1.05) {
        const sx = 110 + Math.cos(0.75 * tilt) * 72 + Math.sin(0.75 * tilt) * 40, sy = 92 + Math.sin(0.75 * tilt) * 72 - 40 * Math.cos(0.75 * tilt);
        g.strokeStyle = "#a8742a"; g.lineWidth = 5; g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(fx, sy, fx, fy - 10); g.stroke();
      }
      // steam
      for (let i = 0; i < 3; i++) { const p = ((now / 1600) + i / 3) % 1; g.fillStyle = `rgba(255,255,255,${0.3 * (1 - p)})`; g.beginPath(); g.arc(fx + Math.sin(now / 300 + i) * 6, fy - 60 - p * 40, 5 + p * 8, 0, Math.PI * 2); g.fill(); }
      if (!finished) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const stop = (e) => {
      if (e) e.preventDefault();
      if (!pouring) return;
      pouring = false;
      if (level >= lo && level <= hi) { finished = true; setTimeout(done, 250); }
      else if (level > hi) { level = 0; body.querySelector(".mg-note").textContent = "انسكبت! حاول مرة ثانية"; }
    };
    btn.addEventListener("pointerdown", (e) => { e.preventDefault(); pouring = true; });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, stop);
    return () => { finished = true; cancelAnimationFrame(raf); };
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
      b.onpointerdown = (e) => { e.preventDefault(); if (it.gone) return; it.gone = true; b.classList.add("gone"); setTimeout(() => b.remove(), 300); if (--left === 0) setTimeout(done, 300); };
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
  coffee: { type: "pour" },
  engineFuel: { type: "hold", icon: "⛽", note: "اضغط مطوّلاً لتعبئة المحرك" },
  dates: { type: "sequence", note: "قدّم أطباق التمر بالترتيب من ١ إلى ٨" },
  cargo: { type: "sequence", note: "رتّب صناديق الشحنة بالترتيب من ١ إلى ٨" },
  course: { type: "slider", note: "اضبط المسار حتى تتطابق الموجتان" },
  radio: { type: "slider", note: "اضبط التردد حتى تتطابق الموجتان" },
  gauge: { type: "slider", note: "عاير الضغط حتى تتطابق الموجتان" },
  filter: { type: "clicks", icon: "🍂", note: "أخرج الأوراق من المرشح" },
  incense: { type: "clicks", icon: "🔥", note: "أشعل جمرات المبخرة" },
  power: { type: "switches", note: "وزّع الطاقة: شغّل كل المفاتيح" },
  valves: { type: "switches", note: "افتح كل الصمامات" },
  airClean: { type: "clicks", icon: "💨", note: "التقط الغبار العالق في الهواء" },
  scrolls: { type: "sequence", note: "رتّب المخطوطات من ١ إلى ٨" },
  cipher: { type: "code" },
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
