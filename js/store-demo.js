// مخزن تجريبي في الذاكرة ببيانات وهمية. يعمل فقط حين لا توجد إعدادات Firebase،
// والواجهة تعرض شريطًا واضحًا «وضع تجريبي». لا شيء هنا يُحفظ أو يُرسل.

import { scoreMarks, entryDelta, WEEKLY_MAX, normalizeArabic } from "./scoring.js";
import { CLASSES, StoreError, studentCode } from "./store-common.js";
import { buildBoard } from "./store-firestore.js";

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function createDemoStore() {
  const R = rng(20261028);
  const FIRST = "نورة سارة ريم لمى جود رهف شهد غلا دانة لين جنى رغد هيا العنود منيرة لطيفة حصة مها أسيل ديما رنا وعد ملاك شوق بشاير الجوهرة نوف أريج رزان تالا ليان ميار يارا سديم وجدان عبير هند فاطمة مريم أمل".split(" ");
  const FATHER = "عبدالله محمد إبراهيم سليمان صالح فهد عبدالعزيز خالد ناصر حمد عبدالرحمن سعد يوسف منصور علي تركي".split(" ");
  const FAM = "العتيبي القحطاني الشمري السبيعي الدوسري المطيري الرشيدي الخالدي العنزي السليم البسام الزامل الخريجي الجربوع الصالح العمر المحيميد الغنام الوهيبي الفوزان الربيعي الحمدان التويجري الرميح اليحيى السويلم المنيع الشبل الذكير العقيل".split(" ");
  const SIZES = [31, 31, 31, 32, 31, 31, 31, 31, 31];

  const users = {
    "demo-admin": { id: "demo-admin", name: "مديرة النظام (تجريبي)", email: "admin@example.com", role: "admin", active: true },
    "demo-teacher": { id: "demo-teacher", name: "معلمة الفيزياء (تجريبي)", email: "teacher1@example.com", role: "teacher", active: true },
    "demo-teacher-2": { id: "demo-teacher-2", name: "معلمة الكيمياء (تجريبي)", email: "teacher2@example.com", role: "teacher", active: true }
  };
  let currentUid = "demo-teacher";
  let offline = false;

  const classes = {};
  CLASSES.forEach((c, ci) => { classes[c.id] = { id: c.id, grade: c.grade, section: c.section, label: c.label, activeCount: 0, totalPoints: 0, participations: 0, nextSeq: SIZES[ci] }; });
  const students = {};
  const used = new Set();
  let n = 0;
  CLASSES.forEach((c, ci) => {
    for (let i = 0; i < SIZES[ci]; i++) {
      let nm;
      do { nm = `${FIRST[Math.floor(R() * FIRST.length)]} ${FATHER[Math.floor(R() * FATHER.length)]} ${FAM[Math.floor(R() * FAM.length)]}`; } while (used.has(nm));
      used.add(nm);
      const id = studentCode(c.id, i + 1); n++;
      students[id] = { id, name: nm, nameNorm: normalizeArabic(nm), classId: c.id, active: true, totalPoints: 0, participations: 0, correctCount: 0, _eng: 0.08 + R() * 0.35, _skill: 0.35 + R() * 0.5 };
      classes[c.id].activeCount++;
    }
  });

  const CUR = 8;
  const start = Date.UTC(2026, 8, 6);
  const weeks = {};
  const entries = {}; // weekId -> { sid: entry }
  const audit = [];
  const keyLetters = "أبجد";
  for (let w = 1; w <= CUR; w++) {
    const id = "w" + String(w).padStart(2, "0");
    weeks[id] = {
      id, number: w, startDate: new Date(start + (w - 1) * 7 * 864e5).toISOString().slice(0, 10),
      status: w < CUR ? "closed" : "open",
      answerKey: { p: keyLetters[Math.floor(R() * 4)], c: keyLetters[Math.floor(R() * 4)], b: keyLetters[Math.floor(R() * 4)] },
      keyLockedAt: null, participants: 0, pointsTotal: 0, fullMarks: 0, perClass: {}
    };
    entries[id] = {};
  }
  const cfg = { currentWeekId: "w08", academicYear: "1448 هـ" };

  function apply(weekId, sid, marks, by, at) {
    const w = weeks[weekId], s = students[sid];
    const old = entries[weekId][sid] || null;
    const sc = scoreMarks(marks);
    const cid = old ? old.classIdAtEntry : s.classId;
    const d = entryDelta(old, sc);
    entries[weekId][sid] = old
      ? { ...old, marks, points: sc.points, correctCount: sc.correctCount, updatedBy: by, updatedAt: at }
      : { id: sid, marks, points: sc.points, correctCount: sc.correctCount, classIdAtEntry: cid, studentName: s.name, recordedBy: by, recordedAt: at, updatedBy: by, updatedAt: at };
    s.totalPoints += d.points; s.participations += d.participations; s.correctCount += d.correct;
    const c = classes[cid]; c.totalPoints += d.points; c.participations += d.participations;
    w.participants += d.participations; w.pointsTotal += d.points; w.fullMarks += d.fullMarks;
    const pc = w.perClass[cid] || { n: 0, pts: 0 };
    w.perClass[cid] = { n: pc.n + d.participations, pts: pc.pts + d.points };
    if (!w.keyLockedAt) w.keyLockedAt = at;
    return { old, entry: entries[weekId][sid] };
  }
  // مشاركات وهمية: الأسابيع 1–7 مكتملة، والأسبوع الحالي جزئي، وثالث 2 لم يبدأ.
  const curDone = { "1-1": 0.9, "1-2": 0.7, "1-3": 0.5, "2-1": 0.8, "2-2": 0.4, "2-3": 0.6, "3-1": 0.7, "3-2": 0, "3-3": 0.3 };
  Object.values(students).forEach((s) => {
    for (let w = 1; w <= CUR; w++) {
      const p = w < CUR ? s._eng : s._eng * curDone[s.classId];
      if (R() < p) {
        const m = {}; ["p", "c", "b"].forEach((k, j) => { m[k] = R() < s._skill + (j - 1) * 0.05; });
        apply("w" + String(w).padStart(2, "0"), s.id, m, R() < 0.6 ? "demo-teacher" : "demo-teacher-2", new Date(start + (w - 1) * 7 * 864e5 + 3 * 864e5));
      }
    }
  });

  const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms));
  const guard = () => { if (offline || !navigator.onLine) throw new StoreError("offline", "لم يُحفظ شيء: لا يوجد اتصال بالإنترنت. تحققي من الاتصال ثم أعيدي المحاولة."); };
  const isAdmin = () => users[currentUid].role === "admin";
  const needAdmin = () => { if (!isAdmin()) throw new StoreError("denied", "لا تملكين صلاحية هذه العملية."); };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const log = (action, target, before, after) => audit.unshift({ id: "a" + audit.length, action, actor: currentUid, target, before, after, at: new Date().toISOString() });
  let board = null;

  const store = {
    mode: "demo",
    demo: {
      get uid() { return currentUid; },
      setUser(u) { currentUid = u; },
      users: () => Object.values(users),
      get offline() { return offline; },
      setOffline(v) { offline = v; }
    },
    async getProfile(u) { return clone(users[u] || null); },
    async getConfig() { return clone(cfg); },
    async listClasses() { await wait(60); return clone(Object.values(classes)); },
    async listWeeks() { return clone(Object.values(weeks).sort((a, b) => a.number - b.number)); },
    async getWeek(w) { return clone(weeks[w] || null); },
    async getStudent(s) { await wait(80); return students[s] ? clone(students[s]) : null; },
    async allStudents() { await wait(120); return clone(Object.values(students).filter((s) => s.active)); },
    async classStudents(cid) { await wait(80); return clone(Object.values(students).filter((s) => s.classId === cid).sort((a, b) => a.name.localeCompare(b.name, "ar"))); },
    async classEntries(w, cid) { return clone(Object.values(entries[w] || {}).filter((e) => e.classIdAtEntry === cid)); },
    watchClassEntries(w, cid, cb) { cb(clone(Object.values(entries[w] || {}).filter((e) => e.classIdAtEntry === cid))); return () => {}; },
    async getEntry(w, s) { return entries[w] && entries[w][s] ? clone(entries[w][s]) : null; },
    async weekEntries(w) { await wait(80); return clone(Object.values(entries[w] || {}).sort((a, b) => b.points - a.points)); },
    async topStudents({ classIds = null, pageSize = 50, cursor = null } = {}) {
      await wait(80);
      const all = Object.values(students).filter((s) => s.active && (!classIds || classIds.includes(s.classId)))
        .sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name, "ar"));
      const from = cursor || 0;
      const rows = all.slice(from, from + pageSize);
      return { rows: clone(rows), cursor: from + pageSize < all.length ? from + pageSize : null };
    },
    async getBoard() {
      if (!board) await store.publishBoard({ week: weeks[cfg.currentWeekId], classes: Object.values(classes) }, true);
      return clone(board);
    },

    async saveEntry({ weekId, studentId, marks, mode }) {
      scoreMarks(marks);
      await wait(350);
      guard();
      const w = weeks[weekId];
      if (!w) throw new StoreError("no-week", "الأسبوع غير موجود.");
      if (w.status !== "open" && !isAdmin()) throw new StoreError("closed", "هذا الأسبوع غير مفتوح للرصد.");
      const s = students[studentId];
      if (!s) throw new StoreError("no-student", "الطالبة غير موجودة.");
      const old = entries[weekId][studentId];
      if (mode === "create" && old) throw new StoreError("duplicate", "سبق رصد هذه الطالبة في هذا الأسبوع.", { existing: clone(old) });
      if (mode === "edit" && !old) throw new StoreError("missing", "لم تعد هذه المشاركة موجودة.");
      if (!old && !s.active) throw new StoreError("inactive", "الطالبة موقوفة، فعّليها أولًا من إدارة الطالبات.");
      if (old && !isAdmin() && old.recordedBy !== currentUid) throw new StoreError("not-owner", "تعديل هذه المشاركة متاح للمعلمة التي رصدتها وللمديرة.");
      const r = apply(weekId, studentId, marks, currentUid, new Date());
      log(old ? "entry.update" : "entry.create", `weeks/${weekId}/entries/${studentId}`, old ? { marks: old.marks, points: old.points } : null, { marks, points: r.entry.points, student: s.name });
      return clone(r.entry);
    },

    async initSystem() { needAdmin(); },
    async addStudent({ name, classId }) { return (await store.importStudents(classId, [name]))[0]; },
    async updateStudent(id, { name, classId, active }) {
      await wait(); guard(); needAdmin();
      const s = students[id];
      const before = { name: s.name, classId: s.classId, active: s.active };
      const newClass = classId || s.classId, newActive = active == null ? s.active : active;
      if (newClass !== s.classId || newActive !== s.active) {
        if (s.active) classes[s.classId].activeCount--;
        if (newActive) classes[newClass].activeCount++;
      }
      if (name) { s.name = name; s.nameNorm = normalizeArabic(name); }
      s.classId = newClass; s.active = newActive;
      log("student.update", `students/${id}`, before, { name: s.name, classId: newClass, active: newActive });
    },
    async classNameSet(cid) { return new Set(Object.values(students).filter((s) => s.classId === cid).map((s) => s.nameNorm)); },
    async importStudents(classId, names) {
      await wait(400); guard(); needAdmin();
      const c = classes[classId];
      const ids = names.map((name) => {
        c.nextSeq++;
        const id = studentCode(classId, c.nextSeq);
        students[id] = { id, name, nameNorm: normalizeArabic(name), classId, active: true, totalPoints: 0, participations: 0, correctCount: 0 };
        c.activeCount++;
        return id;
      });
      log(names.length === 1 ? "student.create" : "student.import", names.length === 1 ? `students/${ids[0]}` : `classes/${classId}`, null, names.length === 1 ? { name: names[0], classId } : { count: names.length, classId });
      return ids;
    },
    async createWeek({ number, startDate, answerKey }) {
      await wait(); guard(); needAdmin();
      const id = "w" + String(number).padStart(2, "0");
      if (weeks[id]) throw new StoreError("duplicate-week", `الأسبوع ${number} موجود مسبقًا.`);
      weeks[id] = { id, number, startDate, status: "draft", answerKey, keyLockedAt: null, participants: 0, pointsTotal: 0, fullMarks: 0, perClass: {} };
      entries[id] = {};
      log("week.create", `weeks/${id}`, null, { number, startDate, answerKey });
      return id;
    },
    async setWeekStatus(id, status) { await wait(); guard(); needAdmin(); log("week.status", `weeks/${id}`, { status: weeks[id].status }, { status }); weeks[id].status = status; },
    async setCurrentWeek(id) { await wait(); guard(); needAdmin(); log("config.currentWeek", "config/app", { currentWeekId: cfg.currentWeekId }, { currentWeekId: id }); cfg.currentWeekId = id; },
    async updateAnswerKey(id, key) {
      await wait(); guard(); needAdmin();
      const w = weeks[id];
      log(w.keyLockedAt ? "week.key.changeAfterLock" : "week.key", `weeks/${id}`, { answerKey: w.answerKey }, { answerKey: key, entriesAtChange: w.participants });
      w.answerKey = key;
    },
    async listUsers() { needAdmin(); return clone(Object.values(users)); },
    async upsertUser(u, val) {
      await wait(); guard(); needAdmin();
      log(users[u] ? "user.update" : "user.create", `users/${u}`, users[u] ? clone(users[u]) : null, val);
      users[u] = { id: u, ...val };
    },
    async listAudit() { needAdmin(); return clone(audit.slice(0, 60)); },
    async publishBoard({ week, classes: cls }, silent) {
      if (!silent) { await wait(); guard(); needAdmin(); }
      const top = (await store.topStudents({ pageSize: 10 })).rows;
      const full = week ? Object.values(entries[week.id]).filter((e) => e.points === WEEKLY_MAX) : [];
      board = { ...buildBoard({ week, classes: cls, top, full }), publishedAt: new Date().toISOString() };
      if (!silent) log("board.publish", "public/board", null, { weekNumber: board.weekNumber });
    }
  };
  return store;
}
