// شاشة العرض العامة: تقرأ مستند public/board فقط (قراءة عامة بحسب القواعد).
// لا تسجيل دخول، ولا أي عملية كتابة.
import { isConfigured, loadFirestoreLite } from "./boot.js";

const REFRESH_MS = 5 * 60 * 1000;
const el = document.getElementById("board");
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const rank = (r) => `<span class="rank${r <= 3 ? " r" + r : ""}">${r}</span>`;
const fmt = (t) => { const d = t && t.toDate ? t.toDate() : t ? new Date(t) : null; return d && !isNaN(d) ? d.toLocaleString("ar-SA-u-nu-latn-ca-gregory", { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }) : ""; };

let getBoard;
async function init() {
  if (!isConfigured()) {
    const { createDemoStore } = await import("./store-demo.js");
    const store = createDemoStore();
    getBoard = () => store.getBoard();
  } else {
    const fb = await loadFirestoreLite(); // نسخة خفيفة: الشاشة تقرأ مستندًا واحدًا فقط ولا تحتاج تسجيل دخول
    const { doc, getDoc } = fb.fs;
    getBoard = async () => { const s = await getDoc(doc(fb.db, "public", "board")); return s.exists() ? s.data() : null; };
  }
  await draw();
  setInterval(draw, REFRESH_MS);
}

async function draw() {
  let b;
  try { b = await getBoard(); }
  catch { if (!el.querySelector(".board-head")) el.innerHTML = '<div class="board-in"><p class="board-msg">تعذّر تحميل النتائج. ستُعاد المحاولة تلقائيًا.</p></div>'; return; }
  if (!b) { el.innerHTML = '<div class="board-in"><p class="board-msg">لم تُنشر نتائج بعد.</p></div>'; return; }
  // ترتيب مشترك عند التعادل
  let last = null, r = 0;
  const top = (b.topStudents || []).map((s, i) => { if (s.points !== last) { r = i + 1; last = s.points; } return { ...s, rank: r }; });
  const cls = b.topClasses || [];
  const full = b.fullMarks || [];
  el.innerHTML = `<div class="board-in">
    <div class="board-head"><span class="mark">ر</span><h1>رصيد التميز التحصيلي<small>فيزياء · كيمياء · أحياء — المتصدرات حتى الآن</small></h1>${b.weekNumber ? `<span class="wk">الأسبوع ${b.weekNumber}</span>` : ""}</div>
    <div class="board-cols">
      <div class="panel"><h2>العشر الأوائل</h2>${top.map((s) => `<div class="brow">${rank(s.rank)}<b>${esc(s.name)}<small>${esc(s.classLabel)}</small></b><span class="bv">${s.points}</span></div>`).join("") || '<p class="board-msg" style="padding:20px 0">لا توجد نقاط بعد</p>'}</div>
      <div style="display:flex;flex-direction:column;gap:22px;min-width:0">
        <div class="panel"><h2>الفصول المتميزة</h2>
          ${cls.length >= 3 ? `<div class="bpod">${cls.slice(0, 3).map((c, i) => `<div class="b${i + 1}"><b>${esc(c.label)}</b><span>${c.avg}</span><small>متوسط نقاط الطالبة</small></div>`).join("")}</div>` : ""}
          ${cls.slice(cls.length >= 3 ? 3 : 0).map((c, i) => `<div class="brow">${rank(i + (cls.length >= 3 ? 4 : 1))}<b>${esc(c.label)}</b><span class="bv">${c.avg}</span></div>`).join("")}</div>
        <div class="panel"><h2>رصيد كامل هذا الأسبوع · 20 من 20</h2><div class="stars">${full.length ? full.slice(0, 24).map((n) => `<span>${esc(n)}</span>`).join("") + (full.length > 24 ? `<span>و${full.length - 24} أخريات</span>` : "") : "<span>لا يوجد بعد</span>"}</div></div>
      </div>
    </div>
    <p class="board-foot">آخر تحديث للنتائج: ${fmt(b.publishedAt)}</p>
  </div>`;
}

init().catch(() => { el.innerHTML = '<div class="board-in"><p class="board-msg">تعذّر تشغيل شاشة العرض. تحققي من الاتصال.</p></div>'; });
