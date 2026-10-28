// واجهة «رصيد التميز التحصيلي» — لوحة المعلمات والمديرة.
import { isConfigured, loadFirebase } from "./boot.js";
import { createFirestoreStore } from "./store-firestore.js";
import { createDemoStore } from "./store-demo.js";
import { CLASSES, GRADES, parseCSV, validateImport, cleanName } from "./store-common.js";
import { DOMAINS, scoreMarks, rankRows, normalizeArabic, WEEKLY_MAX } from "./scoring.js";

/* ======================= أدوات ======================= */
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const fmt1 = (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : "0");
const clsLabel = (cid) => (CLASSES.find((c) => c.id === cid) || {}).label || cid || "";
const clsShort = (cid) => (CLASSES.find((c) => c.id === cid) || {}).short || cid || "";
const SAVE_TIMEOUT = 20000;
function toDate(t) { if (!t) return null; if (t.toDate) return t.toDate(); return new Date(t); }
function fmtTime(t) {
  const d = toDate(t); if (!d || isNaN(d)) return "";
  return d.toLocaleString("ar-SA-u-nu-latn-ca-gregory", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
const rankBadge = (r) => `<span class="rank${r <= 3 ? " r" + r : ""}">${r}</span>`;
const IC = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>'
};
const NAV = [
  { r: "dashboard", t: "لوحة التحكم", s: "الرئيسية", i: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>' },
  { r: "entry", t: "رصد المشاركات", s: "الرصد", i: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 13l2 2 4-4"/>' },
  { r: "students", t: "ترتيب الطالبات", s: "الطالبات", i: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>' },
  { r: "classes", t: "ترتيب الفصول", s: "الفصول", i: '<path d="M5 20V11M12 20V5M19 20v-6M3 20h18"/>' },
  { group: "إدارة", admin: true },
  { r: "manage", t: "إدارة الطالبات", s: "الطالبات+", admin: true, i: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16.5 11h6M19.5 8v6"/>' },
  { r: "weeks", t: "الأسابيع والمفاتيح", s: "الأسابيع", admin: true, i: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>' },
  { r: "users", t: "المستخدمات", s: "الحسابات", admin: true, i: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>' },
  { r: "audit", t: "سجل التدقيق", s: "السجل", admin: true, i: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>' },
  { sep: true },
  { r: "display", t: "شاشة العرض العامة", s: "العرض", href: "display.html", i: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>' }
];
const TITLES = Object.fromEntries(NAV.filter((n) => n.r).map((n) => [n.r, n.t]));
const ADMIN_ROUTES = new Set(NAV.filter((n) => n.admin && n.r).map((n) => n.r));

/* ======================= الحالة ======================= */
const S = { store: null, fb: null, uid: null, profile: null, config: null, classes: [], weeks: [], usersById: {} };
const isAdmin = () => S.profile && S.profile.role === "admin";
const curWeek = () => S.weeks.find((w) => w.id === (S.config && S.config.currentWeekId)) || S.weeks[S.weeks.length - 1] || null;
const STATUS = { draft: ["مسودة", "wait"], open: ["مفتوح للرصد", "ok"], closed: ["مغلق", "info"] };
const root = document.getElementById("root");

let toastT;
function toast(msg, kind) {
  const el = document.getElementById("toast");
  clearTimeout(toastT);
  el.className = "toast" + (kind === "err" ? " err" : "");
  el.textContent = msg; el.hidden = false;
  toastT = setTimeout(() => (el.hidden = true), kind === "err" ? 7000 : 4000);
}
function withTimeout(p, ms = SAVE_TIMEOUT) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: "timeout", message: "لم يصل تأكيد الحفظ من الخادم خلال 20 ثانية. لا تعتبري العملية محفوظة؛ تحققي من الاتصال ثم أعيدي فتح الصفحة للتأكد." }), ms))]);
}
async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true; btn.classList.add("busy");
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove("busy"); }
}
function offlineGuard() {
  if (!navigator.onLine) throw { code: "offline", message: "لم يُحفظ شيء: الجهاز غير متصل بالإنترنت. تحققي من الاتصال ثم أعيدي المحاولة." };
}

/* ======================= الإقلاع ======================= */
async function start() {
  if (!isConfigured()) {
    S.store = createDemoStore();
    window.__demoStore = S.store; // للاختبارات الآلية في الوضع التجريبي فقط
    renderDemoBar();
    await enterApp(S.store.demo.uid, null);
    return;
  }
  try { S.fb = await loadFirebase(); }
  catch (e) {
    root.innerHTML = fatal("تعذّر تحميل مكتبة Firebase", "تحققي من الاتصال بالإنترنت ثم أعيدي تحميل الصفحة. إن تكرر ذلك فراجعي إعدادات js/firebase-config.js.");
    return;
  }
  S.store = createFirestoreStore({ fs: S.fb.fs, db: S.fb.db, getUid: () => S.fb.auth.currentUser && S.fb.auth.currentUser.uid, getRole: () => S.profile && S.profile.role });
  S.fb.authM.onAuthStateChanged(S.fb.auth, (user) => {
    if (!user) { S.uid = null; S.profile = null; renderLogin(); }
    else enterApp(user.uid, user.email);
  });
}

function fatal(t, d) { return `<div class="login-wrap"><div class="login"><h2>${esc(t)}</h2><p class="muted">${esc(d)}</p></div></div>`; }

function renderDemoBar() {
  const bar = document.createElement("div");
  bar.className = "demo-bar";
  bar.innerHTML = `<b>وضع تجريبي ببيانات وهمية</b><span>لم تُضف إعدادات Firebase بعد، ولا يُحفظ شيء.</span>
    <label>تجربة بصلاحية <select id="demoUser">${S.store.demo.users().map((u) => `<option value="${u.id}"${u.id === S.store.demo.uid ? " selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>
    <label><input type="checkbox" id="demoOffline"> محاكاة انقطاع الإنترنت</label>`;
  document.body.prepend(bar);
  $("#demoUser").onchange = (e) => { S.store.demo.setUser(e.target.value); enterApp(e.target.value, null); };
  $("#demoOffline").onchange = (e) => S.store.demo.setOffline(e.target.checked);
}

async function enterApp(uid, email) {
  S.uid = uid;
  root.innerHTML = '<div class="loading">جارٍ التحميل…</div>';
  try { S.profile = await S.store.getProfile(uid); } catch { S.profile = null; }
  if (!S.profile || !S.profile.active || !["admin", "teacher"].includes(S.profile.role)) { renderPending(uid, email); return; }
  try {
    [S.config, S.classes, S.weeks] = await Promise.all([S.store.getConfig(), S.store.listClasses(), S.store.listWeeks()]);
  } catch (e) { root.innerHTML = fatal("تعذّر تحميل البيانات", e.message || ""); return; }
  if (!S.classes.length) { renderInit(); return; }
  S.usersById = {};
  if (isAdmin()) { try { S.usersById = Object.fromEntries((await S.store.listUsers()).map((u) => [u.id, u])); } catch {} }
  renderShell();
  route();
}

/* ======================= الدخول ======================= */
function renderLogin() {
  root.innerHTML = `<div class="login-wrap"><form class="login" id="loginForm" novalidate>
    <div class="brand"><span class="mark">ر</span><div><b>رصيد التميز التحصيلي</b><small>دخول المعلمات</small></div></div>
    <label class="fl">البريد الإلكتروني<input type="email" id="lEmail" autocomplete="username" required dir="ltr"></label>
    <label class="fl">كلمة المرور<input type="password" id="lPass" autocomplete="current-password" required dir="ltr"></label>
    <div id="lMsg"></div>
    <button class="btn btn-primary" type="submit" id="lBtn">دخول</button>
    <button class="linkbtn" type="button" id="lReset">نسيتُ كلمة المرور</button>
    <p class="muted small" style="margin:0">لا يوجد تسجيل ذاتي. تُنشئ مديرة النظام حسابات المعلمات.</p>
  </form></div>`;
  const msg = (kind, t) => ($("#lMsg").innerHTML = t ? `<div class="alert ${kind}">${esc(t)}</div>` : "");
  $("#loginForm").onsubmit = (e) => {
    e.preventDefault();
    const email = $("#lEmail").value.trim(), pass = $("#lPass").value;
    if (!email || !pass) return msg("err", "اكتبي البريد وكلمة المرور.");
    busy($("#lBtn"), async () => {
      try { await S.fb.authM.signInWithEmailAndPassword(S.fb.auth, email, pass); msg(); }
      catch (err) {
        const c = err.code || "";
        msg("err", c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found") ? "البريد أو كلمة المرور غير صحيحة."
          : c.includes("too-many-requests") ? "محاولات كثيرة. انتظري قليلًا ثم أعيدي المحاولة."
          : c.includes("network") ? "لا يوجد اتصال بالإنترنت." : "تعذّر الدخول: " + (err.message || c));
      }
    });
  };
  $("#lReset").onclick = async () => {
    const email = $("#lEmail").value.trim();
    if (!email) return msg("warn", "اكتبي بريدكِ أولًا، ثم اضغطي «نسيتُ كلمة المرور».");
    try { await S.fb.authM.sendPasswordResetEmail(S.fb.auth, email); msg("ok", "إن كان البريد مسجّلًا فستصلكِ رسالة لتعيين كلمة مرور جديدة."); }
    catch { msg("err", "تعذّر الإرسال. تحققي من البريد والاتصال."); }
  };
}

function renderPending(uid, email) {
  root.innerHTML = `<div class="login-wrap"><div class="login">
    <div class="brand"><span class="mark">ر</span><div><b>رصيد التميز التحصيلي</b><small>${esc(email || "")}</small></div></div>
    <h2 style="font-size:19px">حسابكِ بانتظار التفعيل</h2>
    <p class="muted" style="margin:0">أرسلي الرمز التالي إلى مديرة النظام لتمنحكِ الصلاحية من شاشة «المستخدمات»، ثم أعيدي تحميل الصفحة.</p>
    <div class="uid" id="uidBox">${esc(uid)}</div>
    <button class="btn btn-ghost" id="copyUid">نسخ الرمز</button>
    ${S.fb ? '<button class="btn btn-ghost" id="outBtn">تسجيل الخروج</button>' : ""}
  </div></div>`;
  $("#copyUid").onclick = async () => {
    try { await navigator.clipboard.writeText(uid); toast("نُسخ الرمز"); }
    catch { const r = document.createRange(); r.selectNodeContents($("#uidBox")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("الرمز محدد، انسخيه يدويًا"); }
  };
  if (S.fb) $("#outBtn").onclick = () => S.fb.authM.signOut(S.fb.auth);
}

function renderInit() {
  if (!isAdmin()) { root.innerHTML = fatal("النظام غير مهيأ بعد", "تحتاج مديرة النظام إلى تهيئته أولًا."); return; }
  root.innerHTML = `<div class="login-wrap"><form class="login" id="initForm">
    <div class="brand"><span class="mark">ر</span><div><b>تهيئة النظام</b><small>مرة واحدة فقط</small></div></div>
    <p class="muted" style="margin:0">ستُنشأ الفصول التسعة (أول وثاني وثالث ثانوي، 3 فصول لكل صف). بعدها أضيفي الطالبات وأول أسبوع.</p>
    <label class="fl">العام الدراسي<input type="text" id="iYear" value="1448 هـ" required></label>
    <div id="iMsg"></div>
    <button class="btn btn-primary" id="iBtn" type="submit">تهيئة النظام</button></form></div>`;
  $("#initForm").onsubmit = (e) => {
    e.preventDefault();
    busy($("#iBtn"), async () => {
      try { offlineGuard(); await withTimeout(S.store.initSystem($("#iYear").value.trim())); enterApp(S.uid); }
      catch (err) { $("#iMsg").innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
  };
}

/* ======================= الهيكل والتنقل ======================= */
function renderShell() {
  const items = NAV.filter((n) => !n.admin || isAdmin()).map((n) => {
    if (n.group) return `<div class="group">${n.group}</div>`;
    if (n.sep) return '<span class="sep"></span>';
    const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${n.i}</svg>`;
    return `<a href="${n.href || "#" + n.r}" data-r="${n.r}"${n.href ? ' target="_blank" rel="noopener"' : ""}>${icon}<span class="full">${n.t}</span><span class="short">${n.s}</span></a>`;
  }).join("");
  root.innerHTML = `<div class="safe-band" aria-hidden="true"></div><div class="app">
    <nav class="nav" aria-label="التنقل الرئيسي">
      <div class="brand"><span class="mark">ر</span><div><b>رصيد التميز التحصيلي</b><small>الثانوية الثانية بعنيزة</small></div></div>
      ${items}
      <div class="me"><span><b>${esc(S.profile.name)}</b> · ${isAdmin() ? "مديرة النظام" : "معلمة"}</span>${S.fb ? '<button type="button" id="signOut">خروج</button>' : ""}</div>
    </nav>
    <main><header class="topbar"><h1 id="pageTitle"></h1><span class="pill" id="weekPill"></span></header><section class="view" id="view"></section></main></div>`;
  if (S.fb) $("#signOut").onclick = () => S.fb.authM.signOut(S.fb.auth);
  updateWeekPill();
}
function updateWeekPill() {
  const w = curWeek(), el = $("#weekPill");
  if (!el) return;
  el.innerHTML = w ? `<span class="dot${w.status === "open" ? " open" : ""}"></span>الأسبوع الحالي: ${w.number} · ${STATUS[w.status][0]}` : "لا يوجد أسبوع بعد";
}

let cleanup = null;
let G = 0; // رقم التنقل الحالي: الصفحة الأقدم لا تكتب فوق الأحدث
function route() {
  G++;
  if (!S.profile || !$("#view")) return;
  if (cleanup) { cleanup(); cleanup = null; }
  let r = (location.hash || "#dashboard").slice(1);
  if (!TITLES[r] || r === "display" || (ADMIN_ROUTES.has(r) && !isAdmin())) r = "dashboard";
  document.querySelectorAll(".nav a").forEach((a) => (a.dataset.r === r ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  $("#pageTitle").textContent = TITLES[r];
  const view = $("#view");
  view.innerHTML = '<div class="loading">جارٍ التحميل…</div>';
  window.scrollTo(0, 0);
  const fn = { dashboard: viewDashboard, entry: viewEntry, students: viewStudents, classes: viewClasses, manage: viewManage, weeks: viewWeeks, users: viewUsers, audit: viewAudit }[r];
  Promise.resolve(fn(view)).catch((e) => { view.innerHTML = `<div class="alert err">${esc(e.message || "تعذّر تحميل الصفحة")}</div>`; });
}
window.addEventListener("hashchange", route);

async function refreshBasics() {
  [S.config, S.classes, S.weeks] = await Promise.all([S.store.getConfig(), S.store.listClasses(), S.store.listWeeks()]);
  updateWeekPill();
}
const registered = () => S.classes.reduce((a, c) => a + (c.activeCount || 0), 0);
const weekOptions = (sel, onlyOpen) => S.weeks.filter((w) => !onlyOpen || w.status === "open")
  .map((w) => `<option value="${w.id}"${w.id === sel ? " selected" : ""}>الأسبوع ${w.number}${w.id === (S.config && S.config.currentWeekId) ? " (الحالي)" : ""} · ${STATUS[w.status][0]}</option>`).join("");

/* ======================= لوحة التحكم ======================= */
async function viewDashboard(view) {
  const g = G;
  await refreshBasics();
  if (g !== G) return;
  const w = curWeek();
  const reg = registered();
  if (!w) {
    view.innerHTML = `<div class="hero"><div><h2>لا يوجد أسبوع للمسابقة بعد</h2><p>${isAdmin() ? "أنشئي أول أسبوع وأدخلي مفتاح إجابته، ثم افتحيه للرصد." : "ستُنشئ مديرة النظام أول أسبوع قريبًا."}</p></div>${isAdmin() ? '<a class="btn btn-gold" href="#weeks">إنشاء أسبوع</a>' : ""}</div>`;
    return;
  }
  const top = (await S.store.topStudents({ pageSize: 5 })).rows;
  if (g !== G) return;
  const part = w.participants || 0;
  const ranked = rankRows(top, (s) => s.totalPoints, (s) => s.name);
  const cls = S.classes.filter((c) => c.activeCount > 0).map((c) => ({ c, avg: c.totalPoints / c.activeCount })).sort((a, b) => b.avg - a.avg);
  const maxAvg = cls.length ? cls[0].avg || 1 : 1;
  view.innerHTML = `
  <div class="hero"><div><h2>مسابقة الأسبوع ${w.number} · ${STATUS[w.status][0]}</h2>
    <p>${w.status === "open" ? "ارصدي بطاقات من شاركن فقط؛ من لا بطاقة لها تبقى «لم تشارك» تلقائيًا." : w.status === "draft" ? "الأسبوع مسودة ولم يُفتح للرصد بعد." : "الأسبوع مغلق، والتعديل متاح للمديرة فقط."}</p>
    <div class="formula"><span>إجابة صحيحة <b>+5</b></span><span>خاطئة <b>0</b></span><span>الثلاث صحيحة <b>+5 مكافأة</b></span><span>الحد الأسبوعي <b>20</b></span><span>رصيد كامل هذا الأسبوع <b>${w.fullMarks || 0}</b></span></div></div>
    <div class="btns"><a class="btn btn-gold" href="#entry">${IC.plus}رصد المشاركات</a><a class="btn btn-ghost" href="#students">الترتيب</a>${isAdmin() ? '<a class="btn btn-ghost" href="#manage">إدارة الطالبات</a>' : ""}</div></div>
  <div class="kpis">
    <div class="kpi"><span class="k">الطالبات المسجلات</span><span class="v">${reg}</span><span class="s">في ${S.classes.length} فصول</span></div>
    <div class="kpi"><span class="k">مشاركات الأسبوع ${w.number}</span><span class="v">${part}</span><span class="s">${reg ? Math.round((part / reg) * 100) : 0}% من الطالبات</span><div class="meter"><i style="width:${reg ? (part / reg) * 100 : 0}%"></i></div></div>
    <div class="kpi quiet"><span class="k">لم يشاركن</span><span class="v">${Math.max(reg - part, 0)}</span><span class="s">بلا إدخال: المسجلات − المشاركات</span></div>
    <div class="kpi gold"><span class="k">نقاط الأسبوع ${w.number}</span><span class="v">${w.pointsTotal || 0}</span><span class="s">مجموع ما مُنح هذا الأسبوع</span></div>
  </div>
  <div class="dash-cols">
    <div class="card"><h2>أفضل الطالبات <span class="sub">المجموع التراكمي</span></h2><div class="list">${ranked.length ? ranked.map(({ row: s, rank }) => `<div class="li">${rankBadge(rank)}<div class="who"><b>${esc(s.name)}</b><small>${clsLabel(s.classId)} · ${s.participations} مشاركات</small></div><div class="pts">${s.totalPoints}<small>نقطة</small></div></div>`).join("") : '<p class="muted">لا توجد نقاط بعد.</p>'}</div>
      <a class="linkbtn" href="#students">الترتيب الكامل ←</a></div>
    <div class="card"><h2>أفضل الفصول <span class="sub">متوسط نقاط الطالبة المسجلة</span></h2><div class="list">${cls.slice(0, 3).map((x, i) => `<div class="li">${rankBadge(i + 1)}<div class="who"><b>${x.c.label}</b><small>${x.c.activeCount} طالبة · المجموع ${x.c.totalPoints}</small><div class="minibar"><i style="width:${(x.avg / maxAvg) * 100}%"></i></div></div><div class="pts">${fmt1(x.avg)}<small>متوسط</small></div></div>`).join("")}</div>
      <a class="linkbtn" href="#classes">مقارنة الفصول التسعة ←</a></div>
  </div>
  <div class="card"><h2>رصد الأسبوع ${w.number} حسب الفصل <span class="sub">مشاركات مرصودة من عدد طالبات الفصل</span></h2><div class="prog">
    ${S.classes.map((c) => { const n = (w.perClass && w.perClass[c.id] && w.perClass[c.id].n) || 0; return `<button type="button" class="pc" data-go="${c.id}"><b>${c.label}</b><div class="bar"><i style="width:${c.activeCount ? (n / c.activeCount) * 100 : 0}%"></i></div><small class="num">${n} / ${c.activeCount}</small></button>`; }).join("")}
  </div></div>`;
  view.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { E.cid = b.dataset.go; E.grade = +E.cid[0]; location.hash = "#entry"; }));
}

/* ======================= الرصد ======================= */
const E = { weekId: null, grade: 1, cid: "1-1", q: "", filter: "all", students: [], entries: {}, unsub: null };

async function viewEntry(view) {
  const g = G;
  await refreshBasics();
  if (g !== G) return;
  const usable = S.weeks.filter((w) => w.status === "open" || isAdmin());
  if (!usable.length) {
    view.innerHTML = `<div class="card empty">${IC.done}<b>لا يوجد أسبوع مفتوح للرصد</b><span>${isAdmin() ? 'افتحي أسبوعًا من <a href="#weeks">الأسابيع والمفاتيح</a>.' : "ستفتح مديرة النظام الأسبوع للرصد."}</span></div>`;
    return;
  }
  if (!usable.find((w) => w.id === E.weekId)) {
    const cw = curWeek();
    E.weekId = usable.find((w) => cw && w.id === cw.id) ? cw.id : usable[usable.length - 1].id;
  }
  view.innerHTML = `
  <div class="card entry-top">
    <div class="row">
      <label class="fl">الأسبوع<select id="eWeek">${weekOptions(E.weekId, !isAdmin())}</select></label>
      <label class="fl">بحث باسم الطالبة<input type="search" id="eQ" placeholder="اكتبي جزءًا من الاسم" value="${esc(E.q)}" autocomplete="off" inputmode="search"></label>
    </div>
    <div class="fl">الصف<div class="seg" id="eGrade">${GRADES.map((g) => `<button type="button" data-g="${g.grade}" aria-pressed="${g.grade === E.grade}">${g.name}</button>`).join("")}</div></div>
    <div class="fl">الفصل<div class="seg" id="eCls"></div></div>
    <div class="counter" id="eCounter"></div>
    <div class="filters"><div class="seg" id="eFilter">${[["all", "الكل"], ["todo", "لم تشارك"], ["done", "شاركت"]].map(([k, t]) => `<button type="button" data-f="${k}" aria-pressed="${E.filter === k}">${t}</button>`).join("")}</div><span class="muted small" id="eKey"></span></div>
  </div>
  <div id="eWeekNote"></div>
  <div class="stu-list" id="eList"><div class="loading">جارٍ التحميل…</div></div>`;
  $("#eWeek").onchange = (e) => { E.weekId = e.target.value; loadClass(); };
  $("#eQ").oninput = (e) => { E.q = e.target.value; renderList(); };
  view.querySelectorAll("#eGrade button").forEach((b) => (b.onclick = () => { E.grade = +b.dataset.g; E.cid = `${E.grade}-1`; E.q = ""; $("#eQ").value = ""; view.querySelectorAll("#eGrade button").forEach((x) => x.setAttribute("aria-pressed", x === b)); loadClass(); }));
  view.querySelectorAll("#eFilter button").forEach((b) => (b.onclick = () => { E.filter = b.dataset.f; view.querySelectorAll("#eFilter button").forEach((x) => x.setAttribute("aria-pressed", x === b)); renderList(); }));
  $("#eList").onclick = onListClick;
  cleanup = () => { if (E.unsub) { E.unsub(); E.unsub = null; } closeModal(true); };
  await loadClass();
}
const entryWeek = () => S.weeks.find((w) => w.id === E.weekId);

async function loadClass() {
  if (E.unsub) { E.unsub(); E.unsub = null; }
  $("#eCls").innerHTML = CLASSES.filter((c) => c.grade === E.grade).map((c) => `<button type="button" data-c="${c.id}" aria-pressed="${c.id === E.cid}">فصل ${c.section}</button>`).join("");
  document.querySelectorAll("#eCls button").forEach((b) => (b.onclick = () => { E.cid = b.dataset.c; document.querySelectorAll("#eCls button").forEach((x) => x.setAttribute("aria-pressed", x === b)); loadClass(); }));
  const w = entryWeek();
  $("#eKey").innerHTML = w && w.answerKey ? `مفتاح الأسبوع ${w.number}: ف ${esc(w.answerKey.p)} · ك ${esc(w.answerKey.c)} · أ ${esc(w.answerKey.b)}` : "";
  $("#eWeekNote").innerHTML = w && w.status !== "open" ? `<div class="alert warn">هذا الأسبوع ${STATUS[w.status][0]}. يمكنكِ بصفتكِ مديرة الرصد والتعديل فيه، وكل تعديل يُسجَّل.</div>` : "";
  $("#eList").innerHTML = '<div class="loading">جارٍ التحميل…</div>';
  const cid = E.cid, wid = E.weekId;
  try {
    E.students = (await S.store.classStudents(cid)).filter((s) => s.active !== false);
    if (cid !== E.cid || wid !== E.weekId || !$("#eList")) return;
    E.entries = {};
    E.unsub = S.store.watchClassEntries(wid, cid, (rows) => {
      E.entries = Object.fromEntries(rows.map((r) => [r.id, r]));
      renderList();
    }, (err) => toast(err.message, "err"));
    renderList();
  } catch (e) { if ($("#eList")) $("#eList").innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
}

function visibleStudents() {
  const q = normalizeArabic(E.q);
  return E.students.filter((s) => {
    if (q && !(s.nameNorm || normalizeArabic(s.name)).includes(q)) return false;
    const has = !!E.entries[s.id];
    return E.filter === "all" || (E.filter === "done" ? has : !has);
  });
}
const canEdit = (en) => isAdmin() || (en.recordedBy === S.uid && entryWeek() && entryWeek().status === "open");

function renderList() {
  const list = $("#eList"); if (!list) return;
  const total = E.students.length;
  const done = E.students.filter((s) => E.entries[s.id]).length;
  $("#eCounter").innerHTML = `<span class="big">${done} من ${total}</span><span>شاركت من طالبات ${clsLabel(E.cid)}</span><div class="bar"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div><span class="muted small">لم يشاركن: ${total - done}</span>`;
  const rows = visibleStudents();
  if (!rows.length) {
    list.innerHTML = `<div class="card empty">${IC.done}<b>${E.q ? "لا توجد طالبة بهذا الاسم في هذا الفصل" : !E.students.length ? "لا توجد طالبات مسجلات في هذا الفصل" : E.filter === "todo" ? "كل طالبات الفصل مرصودات" : "لا توجد مشاركات مرصودة بعد في هذا الفصل"}</b></div>`;
    return;
  }
  list.innerHTML = rows.map((s) => {
    const en = E.entries[s.id];
    const status = en ? `<span class="tag ok">شاركت · ${en.points}</span>` : '<span class="tag wait">لم تشارك</span>';
    const action = !en
      ? `<button type="button" class="btn btn-primary" data-act="record" data-s="${s.id}">${IC.plus}<span class="lbl">رصد مشاركة</span></button>`
      : canEdit(en) ? `<button type="button" class="btn btn-ghost" data-act="edit" data-s="${s.id}">${IC.edit}<span class="lbl">تعديل</span></button>`
      : `<span class="muted small">رصدتها ${esc(userName(en.recordedBy))}</span>`;
    return `<div class="stu${en ? " done" : ""}" id="row-${s.id}"><div class="nm"><b>${esc(s.name)}</b></div><span class="st">${status}</span>${action}</div>`;
  }).join("");
}
function userName(u) { if (u === S.uid) return "أنتِ"; return (S.usersById[u] && S.usersById[u].name) || "معلمة أخرى"; }

async function onListClick(e) {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const s = E.students.find((x) => x.id === b.dataset.s);
  if (b.dataset.act === "record") openModal(s, "create");
  if (b.dataset.act === "edit") openModal(s, "edit", E.entries[s.id]);
}

/* ---------- نافذة الرصد ---------- */
let M = null;
function openModal(student, mode, existing) {
  M = { student, mode, marks: existing ? { ...existing.marks } : { p: null, c: null, b: null }, saving: false, error: null, dup: null, existing };
  let ov = document.getElementById("overlay");
  if (!ov) { ov = document.createElement("div"); ov.id = "overlay"; ov.className = "overlay"; document.body.appendChild(ov); }
  ov.hidden = false;
  ov.onclick = (e) => { if (e.target === ov && !M.saving) closeModal(); };
  document.addEventListener("keydown", escClose);
  renderModal();
  setTimeout(() => { const f = ov.querySelector(".opt"); if (f) f.focus(); }, 30);
}
function escClose(e) { if (e.key === "Escape" && M && !M.saving) closeModal(); }
function closeModal(silent) {
  const ov = document.getElementById("overlay");
  if (ov) { ov.hidden = true; ov.innerHTML = ""; }
  document.removeEventListener("keydown", escClose);
  if (!silent && M && M.student) { const r = document.getElementById("row-" + M.student.id); if (r) r.querySelector("button")?.focus(); }
  M = null;
}
function renderModal() {
  const ov = document.getElementById("overlay"); if (!ov || !M) return;
  const w = entryWeek(), m = M.marks;
  const complete = DOMAINS.every((d) => m[d.key] === true || m[d.key] === false);
  const sc = complete ? scoreMarks(m) : { points: DOMAINS.reduce((a, d) => a + (m[d.key] === true ? 5 : 0), 0), correctCount: DOMAINS.filter((d) => m[d.key] === true).length, bonus: 0 };
  const allC = complete && sc.correctCount === 3;
  const COLORS = { p: "#0B6B73", c: "#2F4F8F", b: "#3D7A45" };
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">
    <div class="modal-head"><div><small>${M.mode === "edit" ? "تعديل مشاركة" : "رصد مشاركة"} · الأسبوع ${w.number}</small><h3 id="mTitle">${esc(M.student.name)}</h3><small>${clsLabel(M.existing ? M.existing.classIdAtEntry : M.student.classId)}</small></div>
      <button type="button" class="xbtn" data-m="close" aria-label="إغلاق"${M.saving ? " disabled" : ""}>${IC.x}</button></div>
    ${w.answerKey ? `<div class="keyref">مفتاح الإجابة: ${DOMAINS.map((d) => `<span>${d.name}: ${esc(w.answerKey[d.key])}</span>`).join("")}</div>` : ""}
    <div>${DOMAINS.map((d) => { const v = m[d.key]; return `<div class="dom"><div class="dn"><i style="background:${COLORS[d.key]}">${d.letter}</i>${d.name}</div>
      <div class="opts" role="group" aria-label="${d.name}"><button type="button" class="opt" data-m="set" data-d="${d.key}" data-v="1" aria-pressed="${v === true}">${IC.check}صحيحة</button><button type="button" class="opt" data-m="set" data-d="${d.key}" data-v="0" aria-pressed="${v === false}">${IC.x}خاطئة</button></div>
      <div class="dp${v === true ? " plus" : ""}">${v === true ? "+5" : v === false ? "0" : "—"}</div></div>`; }).join("")}</div>
    <div class="bonus${allC ? " on" : ""}">${IC.star}${allC ? "مكافأة الإتقان: الإجابات الثلاث صحيحة" : "مكافأة الإتقان (+5) عند صحة الإجابات الثلاث"}<span class="bp">${allC ? "+5" : "0"}</span></div>
    <div class="total"><div class="tl"><b>المجموع لهذا الأسبوع</b>${complete ? `${sc.correctCount} صحيحة${allC ? " + مكافأة" : ""}` : "حددي حالة المجالات الثلاثة"}</div><div class="tv">${sc.points}<small> / ${WEEKLY_MAX}</small></div></div>
    ${M.error ? `<div class="alert err" role="alert">${esc(M.error)}</div>` : ""}
    ${M.dup ? `<div class="alert warn" role="alert"><div><b>هذه الطالبة مرصودة مسبقًا في الأسبوع ${w.number}</b> (${M.dup.points} نقطة، رصدتها ${esc(userName(M.dup.recordedBy))}). لا تُسجَّل الطالبة مرتين في الأسبوع نفسه.</div>
      ${canEdit(M.dup) ? '<div class="actions"><button type="button" class="btn btn-warn btn-sm" data-m="toEdit">فتح المشاركة الموجودة للتعديل</button></div>' : '<div>التعديل متاح للمعلمة التي رصدتها وللمديرة.</div>'}</div>` : ""}
    <div class="mactions">
      <button type="button" class="btn btn-ghost" data-m="all"${M.saving ? " disabled" : ""}>${IC.check}الثلاث صحيحة</button>
      ${M.mode === "create"
        ? `<button type="button" class="btn btn-ghost" data-m="save"${!complete || M.saving || M.dup ? " disabled" : ""}>حفظ المشاركة</button>
           <button type="button" class="btn btn-primary" data-m="saveNext"${!complete || M.saving || M.dup ? " disabled" : ""}>حفظ والانتقال للتالية</button>`
        : `<button type="button" class="btn btn-primary" data-m="save"${!complete || M.saving ? " disabled" : ""}>حفظ التعديل</button>`}
    </div></div>`;
  ov.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => onModal(b)));
}
async function onModal(b) {
  if (!M || M.saving) return;
  const act = b.dataset.m;
  if (act === "close") return closeModal();
  if (act === "set") { M.marks[b.dataset.d] = b.dataset.v === "1"; M.error = null; return renderModal(); }
  if (act === "all") { M.marks = { p: true, c: true, b: true }; M.error = null; return renderModal(); }
  if (act === "toEdit") { M.mode = "edit"; M.existing = M.dup; M.marks = { ...M.dup.marks }; M.dup = null; return renderModal(); }
  if (act === "save" || act === "saveNext") {
    M.saving = true; M.error = null; renderModal();
    const btn = document.querySelector(`#overlay [data-m="${act}"]`); if (btn) btn.classList.add("busy");
    const { student, mode, marks } = M;
    try {
      offlineGuard();
      const saved = await withTimeout(S.store.saveEntry({ weekId: E.weekId, studentId: student.id, marks, mode }));
      E.entries[student.id] = { ...(E.entries[student.id] || {}), ...saved, id: student.id };
      renderList();
      toast(`${mode === "edit" ? "عُدّلت" : "حُفظت"} مشاركة ${student.name.split(" ")[0]} · ${saved.points} نقطة`);
      if (act === "saveNext") {
        const vis = visibleStudents().filter((s) => !E.entries[s.id]);
        const order = E.students.map((s) => s.id);
        const after = vis.find((s) => order.indexOf(s.id) > order.indexOf(student.id)) || vis[0];
        closeModal(true);
        if (after) { openModal(after, "create"); document.getElementById("row-" + after.id)?.scrollIntoView({ block: "center" }); }
        else toast("لا توجد طالبات أخريات بانتظار الرصد في هذه القائمة");
      } else closeModal();
    } catch (err) {
      if (!M) return;
      M.saving = false;
      if (err.code === "duplicate") { M.dup = err.existing; E.entries[student.id] = err.existing; renderList(); }
      else M.error = err.message || "تعذّر الحفظ.";
      renderModal();
    }
  }
}

/* ======================= ترتيب الطالبات ======================= */
const R = { view: "all", grade: "all", cid: "all", weekId: null, rows: [], cursor: null, weekMap: {}, q: "" };
async function viewStudents(view) {
  const g = G;
  await refreshBasics();
  if (g !== G) return;
  if (!R.weekId || !S.weeks.find((w) => w.id === R.weekId)) R.weekId = curWeek() ? curWeek().id : null;
  view.innerHTML = `
  <div class="card"><div class="toolbar">
    <div class="fl">العرض<div class="seg" id="rView"><button type="button" data-v="all" aria-pressed="${R.view === "all"}">جميع الطالبات</button><button type="button" data-v="week" aria-pressed="${R.view === "week"}">مشاركات الأسبوع</button></div></div>
    <label class="fl">الصف<select id="rG"><option value="all">كل الصفوف</option>${GRADES.map((g) => `<option value="${g.grade}"${String(g.grade) === R.grade ? " selected" : ""}>${g.name}</option>`).join("")}</select></label>
    <label class="fl">الفصل<select id="rC"></select></label>
    <label class="fl">الأسبوع<select id="rW">${weekOptions(R.weekId)}</select></label>
    <label class="fl">بحث في القائمة<input type="search" id="rQ" placeholder="اسم الطالبة" value="${esc(R.q)}"></label>
  </div></div>
  <div class="note">${IC.info}<span id="rNote"></span></div>
  <div class="tablewrap"><table><thead id="rHead"></thead><tbody id="rBody"><tr><td colspan="7" class="muted">جارٍ التحميل…</td></tr></tbody></table></div>
  <div class="more" id="rMore"></div>`;
  const fillC = () => ($("#rC").innerHTML = '<option value="all">كل الفصول</option>' + CLASSES.filter((c) => R.grade === "all" || String(c.grade) === R.grade).map((c) => `<option value="${c.id}"${c.id === R.cid ? " selected" : ""}>${c.label}</option>`).join(""));
  fillC();
  view.querySelectorAll("#rView button").forEach((b) => (b.onclick = () => { R.view = b.dataset.v; view.querySelectorAll("#rView button").forEach((x) => x.setAttribute("aria-pressed", x === b)); loadRank(true); }));
  $("#rG").onchange = (e) => { R.grade = e.target.value; R.cid = "all"; fillC(); loadRank(true); };
  $("#rC").onchange = (e) => { R.cid = e.target.value; loadRank(true); };
  $("#rW").onchange = (e) => { R.weekId = e.target.value; loadRank(true); };
  $("#rQ").oninput = (e) => { R.q = e.target.value; drawRank(); };
  await loadRank(true);
}
const rClassIds = () => (R.cid !== "all" ? [R.cid] : R.grade !== "all" ? CLASSES.filter((c) => String(c.grade) === R.grade).map((c) => c.id) : null);
async function loadRank(reset) {
  const w = S.weeks.find((x) => x.id === R.weekId);
  if (reset) { R.rows = []; R.cursor = null; R.weekMap = {}; $("#rBody").innerHTML = '<tr><td colspan="7" class="muted">جارٍ التحميل…</td></tr>'; }
  try {
    if (reset && w) { const es = await S.store.weekEntries(w.id); R.weekMap = Object.fromEntries(es.map((e) => [e.id, e])); }
    if (R.view === "all") {
      const page = await S.store.topStudents({ classIds: rClassIds(), pageSize: 50, cursor: R.cursor });
      R.rows = R.rows.concat(page.rows); R.cursor = page.cursor;
    }
    if ($("#rBody")) drawRank();
  } catch (e) { if ($("#rBody")) $("#rBody").innerHTML = `<tr><td colspan="7"><div class="alert err">${esc(e.message)}</div></td></tr>`; }
}
function drawRank() {
  const w = S.weeks.find((x) => x.id === R.weekId);
  const wn = w ? w.number : "—";
  const q = normalizeArabic(R.q);
  if (R.view === "all") {
    $("#rNote").textContent = `الترتيب حسب المجموع التراكمي من المشاركات المرصودة فقط. المتساويات يتشاركن المركز. عمود الأسبوع يوضح حالة المشاركة في الأسبوع ${wn}.`;
    $("#rHead").innerHTML = `<tr><th>المركز</th><th>الطالبة</th><th>الصف / الفصل</th><th>الأسبوع ${wn}</th><th>المجموع التراكمي</th><th>المشاركات</th><th>الإجابات الصحيحة</th></tr>`;
    let last = null, rank = 0;
    const ranked = R.rows.map((s, i) => { if (s.totalPoints !== last) { rank = i + 1; last = s.totalPoints; } return { s, rank }; });
    const shown = ranked.filter(({ s }) => !q || normalizeArabic(s.name).includes(q));
    $("#rBody").innerHTML = shown.map(({ s, rank }) => {
      const en = R.weekMap[s.id];
      return `<tr><td>${rankBadge(rank)}</td><td><b>${esc(s.name)}</b></td><td>${clsLabel(s.classId)}</td><td class="n">${en ? en.points + (en.points === WEEKLY_MAX ? ' <span class="tag gold">كامل</span>' : "") : '<span class="wk0">لم تشارك</span>'}</td><td class="n big">${s.totalPoints}</td><td class="n">${s.participations}</td><td class="n">${s.correctCount}</td></tr>`;
    }).join("") || '<tr><td colspan="7" class="muted">لا توجد نتائج</td></tr>';
    $("#rMore").innerHTML = R.cursor ? '<button class="btn btn-ghost" id="rMoreBtn">عرض 50 طالبة أخرى</button>' : "";
    if (R.cursor) $("#rMoreBtn").onclick = (e) => busy(e.currentTarget, () => loadRank(false));
  } else {
    $("#rNote").textContent = `من شاركن في الأسبوع ${wn} فقط، مرتبات حسب نقاط الأسبوع. غير المشاركات لا يظهرن هنا بصفر.`;
    $("#rHead").innerHTML = `<tr><th>المركز</th><th>الطالبة</th><th>الفصل وقت المشاركة</th><th>نقاط الأسبوع ${wn}</th><th>الصحيحة</th><th>المكافأة</th></tr>`;
    const ids = rClassIds();
    const rows = Object.values(R.weekMap).filter((e) => !ids || ids.includes(e.classIdAtEntry));
    const ranked = rankRows(rows, (e) => e.points, (e) => e.studentName).filter(({ row }) => !q || normalizeArabic(row.studentName).includes(q));
    $("#rBody").innerHTML = ranked.map(({ row: e, rank }) => `<tr><td>${rankBadge(rank)}</td><td><b>${esc(e.studentName)}</b></td><td>${clsLabel(e.classIdAtEntry)}</td><td class="n big">${e.points}</td><td class="n">${e.correctCount} من 3</td><td>${e.points === WEEKLY_MAX ? '<span class="tag gold">+5</span>' : '<span class="wk0">—</span>'}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">لا توجد مشاركات مرصودة في الأسبوع ${wn} لهذا الاختيار</td></tr>`;
    $("#rMore").innerHTML = "";
  }
}

/* ======================= ترتيب الفصول ======================= */
const C = { scope: "cum", weekId: null };
async function viewClasses(view) {
  const g = G;
  await refreshBasics();
  if (g !== G) return;
  if (!C.weekId || !S.weeks.find((w) => w.id === C.weekId)) C.weekId = curWeek() ? curWeek().id : null;
  const w = S.weeks.find((x) => x.id === C.weekId);
  const stats = S.classes.map((c) => {
    const pc = (w && w.perClass && w.perClass[c.id]) || { n: 0, pts: 0 };
    const total = C.scope === "cum" ? c.totalPoints : pc.pts;
    const parts = C.scope === "cum" ? c.participations : pc.n;
    return { c, total, parts, weekN: pc.n, avg: c.activeCount ? total / c.activeCount : 0, perPart: parts ? total / parts : 0 };
  }).sort((a, b) => b.avg - a.avg || b.total - a.total);
  const max = (stats[0] && stats[0].avg) || 1;
  view.innerHTML = `
  <div class="card"><div class="toolbar">
    <div class="fl">نطاق المقارنة<div class="seg" id="cScope"><button type="button" data-s="cum" aria-pressed="${C.scope === "cum"}">التراكمي</button><button type="button" data-s="week" aria-pressed="${C.scope === "week"}">أسبوع محدد</button></div></div>
    <label class="fl">الأسبوع<select id="cW"${C.scope === "cum" ? " disabled" : ""}>${weekOptions(C.weekId)}</select></label>
  </div></div>
  <div class="note">${IC.info}<span>الترتيب حسب <b>متوسط النقاط لكل طالبة مسجلة</b> = مجموع نقاط الفصل ÷ عدد طالباته المسجلات. عدد المشاركات معروض بجانبه للمقارنة، ولا يجعل الفصل فائزًا وحده.</span></div>
  ${stats.length >= 3 ? `<div class="podium">${stats.slice(0, 3).map((x, i) => `<div class="pod p${i + 1}">${rankBadge(i + 1)}<b>${x.c.label}</b><span class="v">${fmt1(x.avg)}</span><small class="muted">متوسط نقاط الطالبة</small></div>`).join("")}</div>` : ""}
  <div class="card"><h2>الفصول التسعة <span class="sub">${C.scope === "cum" ? "منذ بداية العام" : w ? "الأسبوع " + w.number : ""}</span></h2>
    ${stats.map((x, i) => `<div class="cls-row${i === 0 ? " first" : ""}">${rankBadge(i + 1)}<div class="cn"><b>${x.c.label}</b><small>${x.c.activeCount} مسجلة · المجموع <span class="num">${x.total}</span></small><small>المشاركات ${x.parts} · متوسط المشاركة ${fmt1(x.perPart)}</small></div><div class="cbar"><i style="width:${(x.avg / max) * 100}%"></i><span>${C.scope === "cum" ? `${x.parts} مشاركة` : `${x.parts} من ${x.c.activeCount} شاركن`}</span></div><div class="avg">${fmt1(x.avg)}<small>لكل مسجلة</small></div></div>`).join("")}
  </div>`;
  view.querySelectorAll("#cScope button").forEach((b) => (b.onclick = () => { C.scope = b.dataset.s; viewClasses(view); }));
  $("#cW").onchange = (e) => { C.weekId = e.target.value; viewClasses(view); };
}

/* ======================= إدارة الطالبات ======================= */
const MG = { cid: "1-1", q: "", edit: null, rows: [], csv: null, imp: null };
// imp = { classId, source: "pdf"|"paste", fileName, detected: {grade, section}, text }

async function viewManage(view) {
  const g = G;
  await refreshBasics();
  if (g !== G) return;
  const s = MG.edit;
  view.innerHTML = `
  <div class="two"><div class="grid">
    <div class="card"><h2>${s ? "تعديل بيانات طالبة" : "إضافة طالبة"}</h2><form class="form" id="mForm" novalidate>
      <label class="fl">اسم الطالبة<input type="text" id="mName" value="${s ? esc(s.name) : ""}" placeholder="الاسم كما في الكشف"></label>
      <label class="fl">الصف والفصل<select id="mCls">${CLASSES.map((c) => `<option value="${c.id}"${(s ? s.classId : MG.cid) === c.id ? " selected" : ""}>${c.label}</option>`).join("")}</select></label>
      ${s ? '<p class="muted small" style="margin:0">نقل الطالبة لا يغيّر نقاطها، ومشاركاتها السابقة تبقى محسوبة لفصلها وقت المشاركة.</p>' : ""}
      <div class="err" id="mErr"></div>
      <div class="mactions"><button type="submit" class="btn btn-primary" id="mSave">${s ? "حفظ التعديل" : "إضافة الطالبة"}</button>${s ? `<button type="button" class="btn ${s.active ? "btn-danger" : "btn-ghost"}" id="mToggle">${s.active ? "إيقاف الطالبة" : "تفعيل الطالبة"}</button><button type="button" class="btn btn-ghost" id="mCancel">إلغاء</button>` : ""}</div>
      <div id="mConfirm"></div>
    </form></div>
    <div class="card"><h2>الفصول التسعة</h2><div class="list">${S.classes.map((c) => `<div class="li"><div class="who"><b>${c.label}</b><small>${c.activeCount} مسجلة · ${c.totalPoints} نقطة</small></div></div>`).join("")}</div></div>
  </div>
  <div class="grid">
    <div class="card" id="impCard"></div>
    <div class="card"><h2>قائمة الطالبات <span class="sub" id="mCount"></span></h2>
      <div class="toolbar" style="margin-bottom:12px"><label class="fl">الفصل<select id="mF">${CLASSES.map((c) => `<option value="${c.id}"${MG.cid === c.id ? " selected" : ""}>${c.label}</option>`).join("")}</select></label>
        <label class="fl">بحث<input type="search" id="mQ" value="${esc(MG.q)}" placeholder="اسم الطالبة"></label></div>
      <div class="tablewrap"><table style="min-width:520px"><thead><tr><th>الطالبة</th><th>الحالة</th><th>المجموع</th><th>المشاركات</th><th></th></tr></thead><tbody id="mBody"></tbody></table></div></div>
  </div></div>`;
  $("#mF").onchange = (e) => { MG.cid = e.target.value; loadManageList(); };
  $("#mQ").oninput = (e) => { MG.q = e.target.value; drawManageList(); };
  if ($("#mCancel")) $("#mCancel").onclick = () => { MG.edit = null; viewManage(view); };
  if ($("#mToggle")) $("#mToggle").onclick = () => {
    $("#mConfirm").innerHTML = `<div class="alert warn"><div>${s.active ? "إيقاف الطالبة يخفيها من قوائم الرصد ومن مقام متوسط الفصل، ويحتفظ بكل مشاركاتها ونقاطها." : "التفعيل يعيدها إلى قوائم الرصد."}</div><div class="actions"><button type="button" class="btn btn-warn btn-sm" id="mToggleYes">${s.active ? "تأكيد الإيقاف" : "تأكيد التفعيل"}</button></div></div>`;
    $("#mToggleYes").onclick = (e) => busy(e.currentTarget, async () => {
      try { offlineGuard(); await withTimeout(S.store.updateStudent(s.id, { active: !s.active })); toast(s.active ? "أُوقفت الطالبة" : "فُعّلت الطالبة"); MG.edit = null; viewManage(view); }
      catch (err) { $("#mErr").textContent = err.message; }
    });
  };
  $("#mForm").onsubmit = (e) => {
    e.preventDefault();
    const name = cleanName($("#mName").value);
    const classId = $("#mCls").value;
    if (name.split(" ").length < 2) return ($("#mErr").textContent = "اكتبي الاسم الثنائي على الأقل.");
    busy($("#mSave"), async () => {
      try {
        offlineGuard();
        if (s) { await withTimeout(S.store.updateStudent(s.id, { name, classId })); toast("حُفظ التعديل"); MG.edit = null; MG.cid = classId; }
        else {
          const names = await S.store.classNameSet(classId);
          if (names.has(normalizeArabic(name)) && !$("#mErr").dataset.confirmDup) {
            $("#mErr").dataset.confirmDup = "1";
            $("#mErr").textContent = "يوجد اسم مطابق في هذا الفصل. اضغطي «إضافة الطالبة» مرة أخرى إن كانت طالبة مختلفة.";
            return;
          }
          await withTimeout(S.store.addStudent({ name, classId })); toast(`أُضيفت ${name.split(" ")[0]} إلى ${clsLabel(classId)}`); MG.cid = classId;
        }
        viewManage(view);
      } catch (err) { $("#mErr").textContent = err.message; }
    });
  };
  $("#mBody").onclick = (e) => { const b = e.target.closest("[data-e]"); if (!b) return; MG.edit = MG.rows.find((r) => r.id === b.dataset.e); viewManage(view); window.scrollTo(0, 0); };
  drawImport(view);
  loadManageList();
}

/* ---------- استيراد كشف فصل (PDF أو لصق) ---------- */
function impNames() { return (MG.imp.text || "").split("\n").map(cleanName).filter((n) => n.length); }

async function drawImport(view) {
  const card = $("#impCard"); if (!card) return;
  if (!MG.imp) {
    card.innerHTML = `<h2>استيراد كشف فصل</h2>
      <p class="muted small" style="margin-top:0">ارفعي «كشف أسماء الطالبات بالفصل» من نور بصيغة PDF، فصلًا في كل مرة. يُقرأ الاسم فقط، ولا يُقرأ رقم السجل المدني ولا يُحفظ.</p>
      <div class="drop"><b>ملف PDF لفصل واحد</b><input type="file" id="impPdf" accept="application/pdf,.pdf"></div>
      <div class="mactions" style="margin-top:12px"><button type="button" class="btn btn-ghost" id="impPaste">لصق الأسماء يدويًا</button><button type="button" class="btn btn-ghost" id="impCsvBtn">ملف CSV لعدة فصول</button></div>
      <div id="impMsg"></div>
      <div id="csvBox" hidden><div class="drop" style="margin-top:12px"><span>الأعمدة بالترتيب: <code>الاسم</code> <code>الصف (1 أو أول)</code> <code>الفصل (1–3)</code></span><input type="file" id="mFile" accept=".csv,text/csv"></div><div id="mPreview"></div></div>`;
    $("#impPdf").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      $("#impMsg").innerHTML = '<div class="loading">جارٍ قراءة الكشف…</div>';
      try {
        const { extractNamesFromPdf } = await import("./pdf-names.js");
        const r = await extractNamesFromPdf(await f.arrayBuffer());
        if (!r.names.length) { $("#impMsg").innerHTML = '<div class="alert warn">لم أجد أسماء في هذا الملف. جرّبي «لصق الأسماء يدويًا»، أو تأكدي أنه كشف أسماء الفصل من نور.</div>'; return; }
        const cid = r.grade && r.section >= 1 && r.section <= 3 ? `${r.grade}-${r.section}` : null;
        MG.imp = { classId: cid || MG.cid, detected: !!cid, source: "pdf", fileName: f.name, text: r.names.join("\n") };
        drawImport(view);
      } catch (err) { $("#impMsg").innerHTML = `<div class="alert err">تعذّرت قراءة الملف (${esc(err.message || "")}). جرّبي «لصق الأسماء يدويًا».</div>`; }
    };
    $("#impPaste").onclick = () => { MG.imp = { classId: MG.cid, detected: false, source: "paste", fileName: "", text: "" }; drawImport(view); };
    $("#impCsvBtn").onclick = () => { $("#csvBox").hidden = !$("#csvBox").hidden; };
    $("#mFile").onchange = (e) => onCsv(e, view);
    return;
  }
  const im = MG.imp;
  card.innerHTML = `<h2>${im.source === "pdf" ? "مراجعة الكشف" : "لصق أسماء فصل"} <span class="sub">${im.fileName ? esc(im.fileName) : ""}</span></h2>
    <div class="form">
      <label class="fl">الفصل الذي ستُضاف إليه الأسماء<select id="impCls">${CLASSES.map((c) => `<option value="${c.id}"${im.classId === c.id ? " selected" : ""}>${c.label}</option>`).join("")}</select></label>
      ${im.source === "pdf" ? (im.detected ? `<div class="note">${IC.info}<span>اكتُشف الفصل من رأس الكشف: <b>${clsLabel(im.classId)}</b>. غيّريه إن لم يكن صحيحًا.</span></div>` : `<div class="alert warn">لم أستطع تحديد الفصل من الكشف. اختاريه بنفسكِ.</div>`) : ""}
      <label class="fl">الأسماء: اسم في كل سطر. صحّحي أي اسم أو احذفي أي سطر ليس اسمًا.<textarea id="impText" rows="12" style="border:1px solid var(--line);border-radius:var(--radius-s);padding:10px 12px;font:inherit;font-size:15px;line-height:1.9;width:100%;resize:vertical">${esc(im.text)}</textarea></label>
      <div id="impCheck"></div>
      <div class="mactions"><button type="button" class="btn btn-primary" id="impGo">استيراد</button><button type="button" class="btn btn-ghost" id="impCancel">إلغاء</button></div>
    </div>`;
  $("#impCls").onchange = (e) => { im.classId = e.target.value; checkImport(); };
  $("#impText").oninput = (e) => { im.text = e.target.value; checkImport(); };
  $("#impCancel").onclick = () => { MG.imp = null; drawImport(view); };
  $("#impGo").onclick = (e) => busy(e.currentTarget, async () => {
    const r = await checkImport();
    if (!r || !r.toAdd.length) return;
    try {
      offlineGuard();
      await withTimeout(S.store.importStudents(im.classId, r.toAdd), 60000);
      toast(`استُوردت ${r.toAdd.length} طالبة إلى ${clsLabel(im.classId)}`);
      MG.cid = im.classId; MG.imp = null; viewManage(view);
    } catch (err) { $("#impCheck").innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
  });
  checkImport();
}

let impCheckSeq = 0;
async function checkImport() {
  const el = $("#impCheck"); if (!el || !MG.imp) return null;
  const seq = ++impCheckSeq;
  const names = impNames();
  let existing;
  try { existing = await S.store.classNameSet(MG.imp.classId); } catch (e) { el.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return null; }
  if (seq !== impCheckSeq) return null;
  const seen = new Set(), toAdd = [], skipped = [], short = [], dupFile = [];
  for (const n of names) {
    const k = normalizeArabic(n);
    if (n.split(" ").length < 2) short.push(n);
    else if (seen.has(k)) dupFile.push(n);
    else if (existing.has(k)) skipped.push(n);
    else toAdd.push(n);
    seen.add(k);
  }
  const lines = [];
  lines.push(`<b>${toAdd.length}</b> اسمًا سيُضاف إلى ${clsLabel(MG.imp.classId)}.`);
  if (skipped.length) lines.push(`${skipped.length} مسجّلة مسبقًا في الفصل وستُتجاهل: ${skipped.map(esc).join("، ")}`);
  if (dupFile.length) lines.push(`${dupFile.length} مكررة في القائمة وستُضاف مرة واحدة: ${dupFile.map(esc).join("، ")}`);
  if (short.length) lines.push(`${short.length} سطر ليس اسمًا كاملًا وسيُتجاهل: ${short.map(esc).join("، ")}`);
  el.innerHTML = `<div class="alert ${skipped.length || dupFile.length || short.length ? "warn" : "ok"}">${lines.map((l) => `<div>${l}</div>`).join("")}</div>`;
  const go = $("#impGo"); if (go && !go.classList.contains("busy")) go.disabled = !toAdd.length;
  return { toAdd };
}

async function onCsv(e, view) {
  const f = e.target.files[0]; if (!f) return;
  $("#mPreview").innerHTML = '<div class="loading">جارٍ قراءة الملف…</div>';
  try {
    const text = await f.text();
    const rows = parseCSV(text);
    const classIds = [...new Set(CLASSES.map((c) => c.id))];
    const existing = new Map(await Promise.all(classIds.map(async (cid) => [cid, await S.store.classNameSet(cid)])));
    MG.csv = validateImport(rows, existing, normalizeArabic);
    drawCsvPreview(view);
  } catch (err) { $("#mPreview").innerHTML = `<div class="alert err">تعذّرت قراءة الملف: ${esc(err.message)}</div>`; }
}
function drawCsvPreview(view) {
  const p = MG.csv;
  const ok = p.filter((r) => r.status === "new");
  const counts = { exists: p.filter((r) => r.status === "exists").length, dup: p.filter((r) => r.status === "dup-file").length, err: p.filter((r) => r.status === "error").length };
  const tag = { new: '<span class="tag ok">جديدة</span>', exists: '<span class="tag wait">مسجّلة مسبقًا</span>', "dup-file": '<span class="tag bad">مكررة في الملف</span>', error: '<span class="tag bad">خطأ</span>' };
  $("#mPreview").innerHTML = `<div class="alert ${counts.err || counts.dup ? "warn" : "ok"}" style="margin-top:12px"><div><b>${ok.length}</b> جديدة · ${counts.exists} مسجّلة مسبقًا (تُتجاهل) · ${counts.dup} مكررة في الملف · ${counts.err} بها خطأ</div>
    ${ok.length ? `<div class="actions"><button type="button" class="btn btn-primary btn-sm" id="mImport">استيراد ${ok.length} طالبة</button></div>` : ""}</div>
    <div class="tablewrap" style="margin-top:10px;max-height:300px"><table style="min-width:420px"><thead><tr><th>السطر</th><th>الاسم</th><th>الفصل</th><th>الحالة</th></tr></thead><tbody>${p.map((r) => `<tr><td class="n">${r.line}</td><td>${esc(r.name)}</td><td>${r.classId ? clsShort(r.classId) : "—"}</td><td>${tag[r.status]} <span class="muted small">${esc(r.note)}</span></td></tr>`).join("")}</tbody></table></div>`;
  if ($("#mImport")) $("#mImport").onclick = (e) => busy(e.currentTarget, async () => {
    try {
      offlineGuard();
      const byClass = {};
      ok.forEach((r) => (byClass[r.classId] = byClass[r.classId] || []).push(r.name));
      for (const [cid, names] of Object.entries(byClass)) await withTimeout(S.store.importStudents(cid, names), 60000);
      toast(`استُوردت ${ok.length} طالبة`); MG.csv = null; viewManage(view);
    } catch (err) { toast(err.message, "err"); }
  });
}

async function loadManageList() {
  if (!$("#mBody")) return;
  $("#mBody").innerHTML = '<tr><td colspan="5" class="muted">جارٍ التحميل…</td></tr>';
  try { MG.rows = await S.store.classStudents(MG.cid); if ($("#mBody")) drawManageList(); }
  catch (e) { if ($("#mBody")) $("#mBody").innerHTML = `<tr><td colspan="5"><div class="alert err">${esc(e.message)}</div></td></tr>`; }
}
function drawManageList() {
  const q = normalizeArabic(MG.q);
  const rows = MG.rows.filter((s) => !q || normalizeArabic(s.name).includes(q));
  $("#mCount").textContent = `${rows.length} طالبة في ${clsLabel(MG.cid)}`;
  $("#mBody").innerHTML = rows.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${s.active ? '<span class="tag ok">مفعّلة</span>' : '<span class="tag wait">موقوفة</span>'}</td><td class="n">${s.totalPoints}</td><td class="n">${s.participations}</td><td><button type="button" class="linkbtn" data-e="${esc(s.id)}">تعديل</button></td></tr>`).join("") || '<tr><td colspan="5" class="muted">لا توجد طالبات في هذا الفصل بعد</td></tr>';
}

/* ======================= الأسابيع والمفاتيح ======================= */
const WK = { keyEdit: null };
async function viewWeeks(view) {
  const g = G;
  await refreshBasics();
  let board = null; try { board = await S.store.getBoard(); } catch {}
  if (g !== G) return;
  const last = S.weeks[S.weeks.length - 1];
  const nextNum = last ? last.number + 1 : 1;
  const nextDate = last && last.startDate ? new Date(Date.parse(last.startDate) + 7 * 864e5).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const cur = S.config && S.config.currentWeekId;
  view.innerHTML = `
  <div class="two"><div class="grid">
    <div class="card"><h2>أسبوع جديد</h2><form class="form" id="wForm" novalidate>
      <div class="row"><label class="fl">رقم الأسبوع<input type="number" id="wNum" min="1" max="60" value="${nextNum}"></label><label class="fl">يبدأ في<input type="date" id="wDate" value="${nextDate}"></label></div>
      <div class="fl">مفتاح الإجابة (مرجع للمعلمات أثناء التصحيح)<div class="keyinputs">${DOMAINS.map((d) => `<label class="fl">${d.name}<input type="text" id="wK${d.key}" maxlength="40" placeholder="مثال: ب"></label>`).join("")}</div></div>
      <div class="err" id="wErr"></div>
      <button type="submit" class="btn btn-primary" id="wSave">إنشاء الأسبوع كمسودة</button></form></div>
    <div class="card"><h2>شاشة العرض العامة</h2>
      <p class="muted small" style="margin-top:0">تعرض الشاشة آخر نسخة منشورة فقط: الاسم الأول والعائلة والفصل، دون أرقام طلابية. ${board && board.publishedAt ? "آخر نشر: " + fmtTime(board.publishedAt) : "لم تُنشر نتائج بعد."}</p>
      <div class="mactions"><button type="button" class="btn btn-gold" id="wPublish">نشر النتائج الحالية</button><a class="btn btn-ghost" href="display.html" target="_blank" rel="noopener">فتح شاشة العرض</a></div></div>
  </div>
  <div class="card"><h2>الأسابيع</h2>
    <div class="tablewrap"><table><thead><tr><th>الأسبوع</th><th>يبدأ</th><th>الحالة</th><th>المشاركات</th><th>النقاط</th><th>المفتاح</th><th></th></tr></thead><tbody>
    ${S.weeks.slice().reverse().map((w) => `<tr><td><b>الأسبوع ${w.number}</b>${w.id === cur ? ' <span class="tag gold">الحالي</span>' : ""}</td><td class="n">${esc(w.startDate || "")}</td><td><span class="tag ${STATUS[w.status][1]}">${STATUS[w.status][0]}</span></td><td class="n">${w.participants}</td><td class="n">${w.pointsTotal}</td>
      <td>${w.answerKey ? DOMAINS.map((d) => `${d.letter}: ${esc(w.answerKey[d.key])}`).join(" · ") : "—"}${w.keyLockedAt ? ' <span class="tag info">مقفل</span>' : ""}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap">
        ${w.status !== "open" ? `<button class="btn btn-ghost btn-sm" data-w="open" data-id="${w.id}">${w.status === "closed" ? "إعادة فتح" : "فتح للرصد"}</button>` : `<button class="btn btn-ghost btn-sm" data-w="closed" data-id="${w.id}">إغلاق</button>`}
        ${w.id !== cur ? `<button class="btn btn-ghost btn-sm" data-w="current" data-id="${w.id}">تعيينه حاليًا</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-w="key" data-id="${w.id}">المفتاح</button></td></tr>
      ${WK.keyEdit === w.id ? `<tr><td colspan="7" style="white-space:normal"><div class="form" style="max-width:640px">
        ${w.keyLockedAt ? `<div class="alert warn">بدأ رصد هذا الأسبوع (${w.participants} مشاركة). تغيير المفتاح يُسجَّل في سجل التدقيق، ولا يُعاد احتساب النتائج تلقائيًا لأن الرصد تم بـ«صحيحة / خاطئة». راجعي مشاركات المجال المتأثر وعدّليها يدويًا من شاشة الرصد.</div>` : ""}
        <div class="keyinputs">${DOMAINS.map((d) => `<label class="fl">${d.name}<input type="text" id="kE${d.key}" maxlength="40" value="${esc(w.answerKey ? w.answerKey[d.key] : "")}"></label>`).join("")}</div>
        <div class="mactions"><button type="button" class="btn ${w.keyLockedAt ? "btn-warn" : "btn-primary"}" data-w="keySave" data-id="${w.id}">${w.keyLockedAt ? "تأكيد تغيير المفتاح" : "حفظ المفتاح"}</button><button type="button" class="btn btn-ghost" data-w="keyCancel">إلغاء</button></div></div></td></tr>` : ""}`).join("") || '<tr><td colspan="7" class="muted">لا توجد أسابيع بعد</td></tr>'}
    </tbody></table></div></div></div>`;
  $("#wForm").onsubmit = (e) => {
    e.preventDefault();
    const number = parseInt($("#wNum").value, 10), startDate = $("#wDate").value;
    const answerKey = Object.fromEntries(DOMAINS.map((d) => [d.key, $("#wK" + d.key).value.trim()]));
    if (!(number >= 1)) return ($("#wErr").textContent = "رقم الأسبوع غير صحيح.");
    if (!startDate) return ($("#wErr").textContent = "حددي تاريخ البداية.");
    if (DOMAINS.some((d) => !answerKey[d.key])) return ($("#wErr").textContent = "أدخلي مفتاح الإجابة للمجالات الثلاثة.");
    busy($("#wSave"), async () => {
      try { offlineGuard(); await withTimeout(S.store.createWeek({ number, startDate, answerKey })); toast(`أُنشئ الأسبوع ${number} كمسودة`); viewWeeks(view); }
      catch (err) { $("#wErr").textContent = err.message; }
    });
  };
  $("#wPublish").onclick = (e) => busy(e.currentTarget, async () => {
    try { offlineGuard(); await withTimeout(S.store.publishBoard({ week: curWeek(), classes: S.classes })); toast("نُشرت النتائج لشاشة العرض"); viewWeeks(view); }
    catch (err) { toast(err.message, "err"); }
  });
  view.querySelectorAll("[data-w]").forEach((b) => (b.onclick = () => {
    const id = b.dataset.id, act = b.dataset.w;
    if (act === "key") { WK.keyEdit = WK.keyEdit === id ? null : id; return viewWeeks(view); }
    if (act === "keyCancel") { WK.keyEdit = null; return viewWeeks(view); }
    busy(b, async () => {
      try {
        offlineGuard();
        if (act === "open" || act === "closed") { await withTimeout(S.store.setWeekStatus(id, act)); toast(act === "open" ? "فُتح الأسبوع للرصد" : "أُغلق الأسبوع"); }
        if (act === "current") { await withTimeout(S.store.setCurrentWeek(id)); toast("عُيّن الأسبوع الحالي"); }
        if (act === "keySave") {
          const key = Object.fromEntries(DOMAINS.map((d) => [d.key, $("#kE" + d.key).value.trim()]));
          if (DOMAINS.some((d) => !key[d.key])) { toast("أدخلي المفتاح للمجالات الثلاثة", "err"); return; }
          await withTimeout(S.store.updateAnswerKey(id, key)); WK.keyEdit = null; toast("حُفظ المفتاح وسُجّل التغيير");
        }
        viewWeeks(view);
      } catch (err) { toast(err.message, "err"); }
    });
  }));
}

/* ======================= المستخدمات ======================= */
const U = { edit: null };
async function viewUsers(view) {
  const g = G;
  const users = await S.store.listUsers();
  if (g !== G) return;
  S.usersById = Object.fromEntries(users.map((u) => [u.id, u]));
  const u = U.edit;
  const self = u && u.id === S.uid;
  view.innerHTML = `<div class="two">
    <div class="card"><h2>${u ? "تعديل صلاحية" : "إضافة مستخدمة"}</h2><form class="form" id="uForm" novalidate>
      <div class="note">${IC.info}<span>أنشئي حساب المعلمة أولًا في Firebase Console ← Authentication. عند دخولها أول مرة يظهر لها «رمز الحساب»؛ الصقيه هنا.</span></div>
      <label class="fl">رمز الحساب (UID)<input type="text" id="uId" dir="ltr" value="${u ? esc(u.id) : ""}"${u ? " readonly" : ""}></label>
      <label class="fl">الاسم<input type="text" id="uName" value="${u ? esc(u.name) : ""}"></label>
      <label class="fl">البريد<input type="email" id="uEmail" dir="ltr" value="${u ? esc(u.email || "") : ""}"></label>
      <label class="fl">الصلاحية<select id="uRole"${self ? " disabled" : ""}><option value="teacher"${!u || u.role === "teacher" ? " selected" : ""}>معلمة: ترصد وتعدّل ما رصدته</option><option value="admin"${u && u.role === "admin" ? " selected" : ""}>مديرة النظام: كل الصلاحيات</option></select></label>
      <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="uActive"${!u || u.active ? " checked" : ""}${self ? " disabled" : ""}> الحساب مفعّل</label>
      ${self ? '<p class="muted small" style="margin:0">لا يمكنكِ تغيير صلاحية حسابكِ أو إيقافه من هنا.</p>' : ""}
      <div class="err" id="uErr"></div>
      <div class="mactions"><button type="submit" class="btn btn-primary" id="uSave">${u ? "حفظ" : "إضافة"}</button>${u ? '<button type="button" class="btn btn-ghost" id="uCancel">إلغاء</button>' : ""}</div></form></div>
    <div class="card"><h2>الحسابات <span class="sub">${users.length}</span></h2><div class="tablewrap"><table><thead><tr><th>الاسم</th><th>البريد</th><th>الصلاحية</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${users.map((x) => `<tr><td><b>${esc(x.name)}</b>${x.id === S.uid ? ' <span class="tag info">أنتِ</span>' : ""}</td><td dir="ltr">${esc(x.email || "")}</td><td>${x.role === "admin" ? '<span class="tag gold">مديرة</span>' : '<span class="tag info">معلمة</span>'}</td><td>${x.active ? '<span class="tag ok">مفعّل</span>' : '<span class="tag wait">موقوف</span>'}</td><td><button class="linkbtn" data-u="${esc(x.id)}">تعديل</button></td></tr>`).join("")}
    </tbody></table></div></div></div>`;
  view.querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => { U.edit = users.find((x) => x.id === b.dataset.u); viewUsers(view); }));
  if ($("#uCancel")) $("#uCancel").onclick = () => { U.edit = null; viewUsers(view); };
  $("#uForm").onsubmit = (e) => {
    e.preventDefault();
    const id = $("#uId").value.trim(), name = $("#uName").value.trim(), email = $("#uEmail").value.trim();
    const role = self ? u.role : $("#uRole").value, active = self ? true : $("#uActive").checked;
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(id)) return ($("#uErr").textContent = "رمز الحساب غير صحيح. انسخيه كما يظهر للمعلمة.");
    if (!name) return ($("#uErr").textContent = "اكتبي الاسم.");
    busy($("#uSave"), async () => {
      try { offlineGuard(); await withTimeout(S.store.upsertUser(id, { name, email, role, active })); toast("حُفظت الصلاحية"); U.edit = null; viewUsers(view); }
      catch (err) { $("#uErr").textContent = err.message; }
    });
  };
}

/* ======================= سجل التدقيق ======================= */
const ACTIONS = { "entry.create": "رصد مشاركة", "entry.update": "تعديل مشاركة", "student.create": "إضافة طالبة", "student.update": "تعديل طالبة", "student.import": "استيراد طالبات", "week.create": "إنشاء أسبوع", "week.status": "تغيير حالة أسبوع", "week.key": "مفتاح إجابة", "week.key.changeAfterLock": "تغيير مفتاح بعد بدء الرصد", "config.currentWeek": "تغيير الأسبوع الحالي", "user.create": "إضافة مستخدمة", "user.update": "تعديل صلاحية", "board.publish": "نشر لشاشة العرض", "system.init": "تهيئة النظام" };
function summarize(a) {
  const b = a.before || {}, f = a.after || {};
  if (a.action.startsWith("entry")) return `${esc(f.student || "")} ${a.before ? `${b.points} ← ` : ""}${f.points} نقطة`;
  if (a.action.startsWith("week.key")) return `${b.answerKey ? DOMAINS.map((d) => b.answerKey[d.key]).join("/") + " ← " : ""}${f.answerKey ? DOMAINS.map((d) => f.answerKey[d.key]).join("/") : ""}`;
  if (a.action === "student.update") return `${esc(f.name || "")}${b.classId !== f.classId ? ` نُقلت من ${clsShort(b.classId)} إلى ${clsShort(f.classId)}` : ""}${b.active !== f.active ? (f.active ? " فُعّلت" : " أُوقفت") : ""}`;
  if (a.action === "student.import") return `${f.count} طالبة`;
  if (a.action === "week.status") return `${STATUS[b.status] ? STATUS[b.status][0] : ""} ← ${STATUS[f.status] ? STATUS[f.status][0] : ""}`;
  return esc(f.name || f.number || f.weekNumber || "");
}
async function viewAudit(view) {
  const g = G;
  const [rows, users] = await Promise.all([S.store.listAudit(60), S.store.listUsers()]);
  if (g !== G) return;
  S.usersById = Object.fromEntries(users.map((u) => [u.id, u]));
  view.innerHTML = `<div class="note">${IC.info}<span>آخر 60 عملية. السجل لا يقبل التعديل أو الحذف من أي حساب.</span></div>
  <div class="tablewrap"><table><thead><tr><th>الوقت</th><th>المستخدمة</th><th>العملية</th><th>التفاصيل</th><th>المسار</th></tr></thead><tbody>
  ${rows.map((a) => `<tr><td class="small">${fmtTime(a.at)}</td><td>${esc(userName(a.actor))}</td><td>${ACTIONS[a.action] || esc(a.action)}</td><td>${summarize(a)}</td><td class="muted small" dir="ltr">${esc(a.target)}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">لا توجد عمليات بعد</td></tr>'}
  </tbody></table></div>`;
}

start();
