// Offline preview entry: the normal client plus a small panel to pick bots and your role.
import "../public/client/main.js";

const $ = (id) => document.getElementById(id);
let net = null;

function previewHome() {
  document.querySelector(".join-row")?.classList.add("hidden");
  $("createBtn").querySelector("span").textContent = "ابدأ التجربة مع لاعبين آليين";
  const note = document.createElement("p");
  note.className = "preview-note";
  note.textContent = "نسخة تجربة على جهازك: تلعب مع لاعبين آليين يتحركون وينجزون المهام ويصوّتون. النسخة الأونلاين للعائلة تُنشر بعد إنشاء المستودع.";
  $("createBtn").before(note);
}

function previewLobby() {
  document.querySelector(".lobby-share")?.classList.add("hidden");
  const col = document.querySelector(".lobby-body .lobby-col");
  const box = document.createElement("div");
  box.className = "preview-box";
  box.innerHTML = `
    <h3>إعدادات التجربة</h3>
    <div class="setting"><span>اللاعبون الآليون</span><div class="stepper"><button id="botMinus">−</button><b id="botCount"></b><button id="botPlus">+</button></div></div>
    <div class="setting"><span>دورك</span><div class="role-pick" id="rolePick">
      <button data-r="">عشوائي</button><button data-r="crew">طاقم</button><button data-r="imp">دخيل</button></div></div>`;
  col.append(box);
  const AR = "٠١٢٣٤٥٦٧٨٩";
  const paint = () => {
    if (!net) return;
    $("botCount").textContent = String(net.bots.list.length).replace(/\d/g, (d) => AR[d]);
    const r = net.room.forceRole?.role || "";
    for (const b of $("rolePick").children) b.classList.toggle("sel", b.dataset.r === r);
  };
  const bump = (d) => { net.bots.setCount(net.bots.list.length + d); net.room.dirty = true; paint(); };
  $("botMinus").onclick = () => bump(-1);
  $("botPlus").onclick = () => bump(1);
  for (const b of $("rolePick").children) {
    b.onclick = () => {
      const me = [...net.room.players.values()].find((p) => p.conn === net.conn);
      net.room.forceRole = b.dataset.r ? { id: me.id, role: b.dataset.r } : null;
      paint();
    };
  }
  addEventListener("preview-room", (e) => { net = e.detail; paint(); });
}

previewHome();
previewLobby();
