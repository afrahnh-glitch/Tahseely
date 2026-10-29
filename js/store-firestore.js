// طبقة البيانات الحقيقية (Cloud Firestore).
// كل عملية رصد تتم في transaction واحدة: المشاركة + مجموع الطالبة + مجموع الفصل
// + إحصائيات الأسبوع + قيد سجل التدقيق. إما أن تنجح كلها أو لا يُكتب شيء.
// قواعد firestore.rules تتحقق من كل رقم على الخادم وترفض أي قيمة لا تطابق القاعدة.

import { scoreMarks, entryDelta, WEEKLY_MAX, publicName, normalizeArabic } from "./scoring.js";
import { CLASSES, StoreError, studentCode } from "./store-common.js";

export function createFirestoreStore({ fs, db, getUid, getRole }) {
  const {
    doc, collection, getDoc, getDocs, query, where, orderBy, limit, startAfter,
    runTransaction, serverTimestamp, writeBatch, increment, onSnapshot, deleteField
  } = fs;

  const uid = () => {
    const u = getUid();
    if (!u) throw new StoreError("signed-out", "انتهت الجلسة. سجّلي الدخول مرة أخرى.");
    return u;
  };
  const isAdmin = () => getRole() === "admin";
  const data = (snap) => (snap.exists() ? { id: snap.id, ...snap.data() } : null);
  const list = (qs) => qs.docs.map((d) => ({ id: d.id, ...d.data() }));

  const weekRef = (w) => doc(db, "weeks", w);
  const entryRef = (w, s) => doc(db, "weeks", w, "entries", s);
  const studentRef = (s) => doc(db, "students", s);
  const classRef = (c) => doc(db, "classes", c);

  function auditDoc(tx, action, target, before, after) {
    const ref = doc(collection(db, "audit"));
    tx.set(ref, { action, actor: uid(), target, before: before ?? null, after: after ?? null, at: serverTimestamp() });
    return ref.id;
  }

  return {
    mode: "firestore",

    // ---------- قراءة ----------
    async getProfile(u) { return data(await getDoc(doc(db, "users", u))); },
    async getConfig() { return data(await getDoc(doc(db, "config", "app"))) || { currentWeekId: null }; },
    async listClasses() {
      const rows = list(await getDocs(collection(db, "classes")));
      return rows.sort((a, b) => a.grade - b.grade || a.section - b.section);
    },
    async listWeeks() { return list(await getDocs(query(collection(db, "weeks"), orderBy("number")))); },
    async getWeek(w) { return data(await getDoc(weekRef(w))); },
    async getStudent(s) { return data(await getDoc(studentRef(String(s)))); },
    /** كل الطالبات المفعّلات (للبحث الشامل) في قراءة واحدة. */
    async allStudents() {
      return list(await getDocs(query(collection(db, "students"), where("active", "==", true))));
    },
    async classStudents(cid) {
      const rows = list(await getDocs(query(collection(db, "students"), where("classId", "==", cid))));
      return rows.sort((a, b) => a.name.localeCompare(b.name, "ar"));
    },
    async classEntries(w, cid) {
      return list(await getDocs(query(collection(db, "weeks", w, "entries"), where("classIdAtEntry", "==", cid))));
    },
    /** استماع لحظي لمشاركات فصل واحد فقط في أسبوع واحد (لا لمجموعات كاملة). */
    watchClassEntries(w, cid, cb, onErr) {
      return onSnapshot(
        query(collection(db, "weeks", w, "entries"), where("classIdAtEntry", "==", cid)),
        (qs) => cb(list(qs)),
        (e) => onErr && onErr(mapError(e))
      );
    },
    async getEntry(w, s) { return data(await getDoc(entryRef(w, s))); },
    async weekEntries(w) {
      return list(await getDocs(query(collection(db, "weeks", w, "entries"), orderBy("points", "desc"))));
    },
    /** صفحة من ترتيب الطالبات حسب المجموع التراكمي. cursor = آخر مستند من الصفحة السابقة. */
    async topStudents({ classIds = null, pageSize = 50, cursor = null } = {}) {
      const base = collection(db, "students");
      const parts = classIds
        ? [where("classId", "in", classIds), orderBy("totalPoints", "desc")]
        : [where("active", "==", true), orderBy("totalPoints", "desc")];
      if (cursor) parts.push(startAfter(cursor));
      parts.push(limit(pageSize));
      const qs = await getDocs(query(base, ...parts));
      return {
        rows: list(qs).filter((r) => r.active !== false),
        cursor: qs.docs.length === pageSize ? qs.docs[qs.docs.length - 1] : null
      };
    },
    async getBoard() { return data(await getDoc(doc(db, "public", "board"))); },

    // ---------- الرصد ----------
    async saveEntry({ weekId, studentId, marks, mode }) {
      const score = scoreMarks(marks);
      const me = uid();
      try {
        return await runTransaction(db, async (tx) => {
          const wS = await tx.get(weekRef(weekId));
          const sS = await tx.get(studentRef(studentId));
          const eS = await tx.get(entryRef(weekId, studentId));
          if (!wS.exists()) throw new StoreError("no-week", "الأسبوع غير موجود.");
          const w = wS.data();
          if (w.status !== "open" && !isAdmin()) throw new StoreError("closed", "هذا الأسبوع غير مفتوح للرصد.");
          if (!sS.exists()) throw new StoreError("no-student", "الطالبة غير موجودة.");
          const s = sS.data();
          const old = eS.exists() ? eS.data() : null;
          if (mode === "create" && old) throw new StoreError("duplicate", "سبق رصد هذه الطالبة في هذا الأسبوع.", { existing: { id: studentId, ...old } });
          if (mode === "edit" && !old) throw new StoreError("missing", "لم تعد هذه المشاركة موجودة.");
          if (!old && s.active === false) throw new StoreError("inactive", "الطالبة موقوفة، فعّليها أولًا من إدارة الطالبات.");
          if (old && !isAdmin() && old.recordedBy !== me) throw new StoreError("not-owner", "تعديل هذه المشاركة متاح للمعلمة التي رصدتها وللمديرة.");

          const cid = old ? old.classIdAtEntry : s.classId;
          const cS = await tx.get(classRef(cid));
          const c = cS.data();
          const d = entryDelta(old, score);
          const now = serverTimestamp();
          const target = `weeks/${weekId}/entries/${studentId}`;
          const auditId = auditDoc(tx, old ? "entry.update" : "entry.create", target,
            old ? { marks: old.marks, points: old.points } : null,
            { marks, points: score.points, student: s.name });

          if (old) {
            tx.update(entryRef(weekId, studentId), {
              marks, points: score.points, correctCount: score.correctCount,
              updatedBy: me, updatedAt: now, auditId
            });
          } else {
            tx.set(entryRef(weekId, studentId), {
              marks, points: score.points, correctCount: score.correctCount,
              classIdAtEntry: cid, studentName: s.name,
              recordedBy: me, recordedAt: now, updatedBy: me, updatedAt: now, auditId
            });
          }
          tx.update(studentRef(studentId), {
            totalPoints: s.totalPoints + d.points,
            participations: s.participations + d.participations,
            correctCount: s.correctCount + d.correct,
            lastEntryWeek: weekId, updatedAt: now
          });
          tx.update(classRef(cid), {
            totalPoints: c.totalPoints + d.points,
            participations: c.participations + d.participations,
            lastEntryWeek: weekId, lastEntryStudent: studentId, updatedAt: now
          });
          const pc = (w.perClass && w.perClass[cid]) || { n: 0, pts: 0 };
          const wUpd = {
            participants: w.participants + d.participations,
            pointsTotal: w.pointsTotal + d.points,
            fullMarks: w.fullMarks + d.fullMarks,
            [`perClass.${cid}`]: { n: pc.n + d.participations, pts: pc.pts + d.points },
            lastEntryStudent: studentId, updatedAt: now
          };
          if (!w.keyLockedAt) wUpd.keyLockedAt = now;
          tx.update(weekRef(weekId), wUpd);
          return { id: studentId, marks, points: score.points, correctCount: score.correctCount, classIdAtEntry: cid, recordedBy: old ? old.recordedBy : me };
        });
      } catch (e) { throw mapError(e); }
    },

    // ---------- إدارة (للمديرة؛ القواعد ترفضها لغيرها) ----------
    async initSystem(academicYear) {
      try {
        const b = writeBatch(db);
        for (const c of CLASSES) {
          b.set(classRef(c.id), { grade: c.grade, section: c.section, label: c.label, activeCount: 0, totalPoints: 0, participations: 0 }, { merge: true });
        }
        b.set(doc(db, "config", "app"), { currentWeekId: null, academicYear }, { merge: true });
        const a = doc(collection(db, "audit"));
        b.set(a, { action: "system.init", actor: uid(), target: "classes", before: null, after: { academicYear }, at: serverTimestamp() });
        await b.commit();
      } catch (e) { throw mapError(e); }
    },

    async addStudent({ name, classId }) {
      const ids = await this.importStudents(classId, [name]);
      return ids[0];
    },

    async updateStudent(id, { name, classId, active }) {
      try {
        await runTransaction(db, async (tx) => {
          const sS = await tx.get(studentRef(id));
          if (!sS.exists()) throw new StoreError("no-student", "الطالبة غير موجودة.");
          const s = sS.data();
          const upd = {};
          if (name != null && name !== s.name) { upd.name = name; upd.nameNorm = normalizeArabic(name); }
          const newClass = classId || s.classId;
          const newActive = active == null ? s.active : active;
          if (newClass !== s.classId) upd.classId = newClass;
          if (newActive !== s.active) upd.active = newActive;
          if (!Object.keys(upd).length) return;
          // عدد المسجّلات في كل فصل (مقام المتوسط). النقاط السابقة لا تنتقل.
          if (upd.classId || upd.active !== undefined) {
            if (s.active) tx.update(classRef(s.classId), { activeCount: increment(-1) });
            if (newActive) tx.update(classRef(newClass), { activeCount: increment(1) });
          }
          tx.update(studentRef(id), { ...upd, updatedAt: serverTimestamp() });
          auditDoc(tx, "student.update", `students/${id}`,
            { name: s.name, classId: s.classId, active: s.active },
            { name: upd.name ?? s.name, classId: newClass, active: newActive });
        });
      } catch (e) { throw mapError(e); }
    },

    /** أسماء طالبات فصل (مطبَّعة) لكشف التكرار قبل الاستيراد. */
    async classNameSet(cid) {
      const rows = list(await getDocs(query(collection(db, "students"), where("classId", "==", cid))));
      return new Set(rows.map((r) => r.nameNorm || normalizeArabic(r.name)));
    },

    /**
     * استيراد أسماء فصل واحد في عملية واحدة. يولّد لكل طالبة رمزًا داخليًا
     * (الفصل + تسلسل) ويحجز التسلسل في مستند الفصل، فلا يتكرر رمز أبدًا.
     */
    async importStudents(classId, names) {
      if (!names.length) return [];
      if (names.length > 150) throw new StoreError("too-many", "الحد 150 اسمًا في المرة الواحدة.");
      try {
        return await runTransaction(db, async (tx) => {
          const cS = await tx.get(classRef(classId));
          if (!cS.exists()) throw new StoreError("no-class", "الفصل غير موجود. هيّئي النظام أولًا.");
          let seq = cS.data().nextSeq || 0;
          const ids = [];
          // نتأكد أن الرمز غير مستخدم (احتياطًا لبيانات أُدخلت قبل نظام التسلسل)
          while (ids.length < names.length) {
            seq++;
            const id = studentCode(classId, seq);
            if (!(await tx.get(studentRef(id))).exists()) ids.push(id);
          }
          names.forEach((name, i) => {
            tx.set(studentRef(ids[i]), { name, nameNorm: normalizeArabic(name), classId, active: true, totalPoints: 0, participations: 0, correctCount: 0, createdAt: serverTimestamp() });
          });
          tx.update(classRef(classId), { nextSeq: seq, activeCount: increment(names.length) });
          auditDoc(tx, names.length === 1 ? "student.create" : "student.import", names.length === 1 ? `students/${ids[0]}` : `classes/${classId}`, null,
            names.length === 1 ? { name: names[0], classId } : { count: names.length, classId });
          return ids;
        });
      } catch (e) { throw mapError(e); }
    },

    async createWeek({ number, startDate, answerKey }) {
      const id = "w" + String(number).padStart(2, "0");
      try {
        await runTransaction(db, async (tx) => {
          const ex = await tx.get(weekRef(id));
          if (ex.exists()) throw new StoreError("duplicate-week", `الأسبوع ${number} موجود مسبقًا.`);
          tx.set(weekRef(id), { number, startDate, status: "draft", answerKey, keyLockedAt: null, participants: 0, pointsTotal: 0, fullMarks: 0, perClass: {}, createdAt: serverTimestamp() });
          auditDoc(tx, "week.create", `weeks/${id}`, null, { number, startDate, answerKey });
        });
        return id;
      } catch (e) { throw mapError(e); }
    },

    async setWeekStatus(id, status) {
      try {
        await runTransaction(db, async (tx) => {
          const w = (await tx.get(weekRef(id))).data();
          tx.update(weekRef(id), { status });
          auditDoc(tx, "week.status", `weeks/${id}`, { status: w.status }, { status });
        });
      } catch (e) { throw mapError(e); }
    },

    async setCurrentWeek(id) {
      try {
        await runTransaction(db, async (tx) => {
          const c = (await tx.get(doc(db, "config", "app"))).data() || {};
          tx.set(doc(db, "config", "app"), { currentWeekId: id }, { merge: true });
          auditDoc(tx, "config.currentWeek", "config/app", { currentWeekId: c.currentWeekId ?? null }, { currentWeekId: id });
        });
      } catch (e) { throw mapError(e); }
    },

    async updateAnswerKey(id, answerKey) {
      try {
        await runTransaction(db, async (tx) => {
          const w = (await tx.get(weekRef(id))).data();
          tx.update(weekRef(id), { answerKey });
          auditDoc(tx, w.keyLockedAt ? "week.key.changeAfterLock" : "week.key", `weeks/${id}`, { answerKey: w.answerKey }, { answerKey, entriesAtChange: w.participants });
        });
      } catch (e) { throw mapError(e); }
    },

    async listUsers() { return list(await getDocs(collection(db, "users"))); },
    async upsertUser(u, { name, email, role, active }) {
      try {
        await runTransaction(db, async (tx) => {
          const ref = doc(db, "users", u);
          const old = await tx.get(ref);
          const val = { name, email, role, active };
          tx.set(ref, val);
          auditDoc(tx, old.exists() ? "user.update" : "user.create", `users/${u}`, old.exists() ? old.data() : null, val);
        });
      } catch (e) { throw mapError(e); }
    },
    async listAudit(n = 60) {
      return list(await getDocs(query(collection(db, "audit"), orderBy("at", "desc"), limit(n))));
    },

    async publishBoard({ week, classes }) {
      try {
        const top = await this.topStudents({ pageSize: 10 });
        const full = week ? list(await getDocs(query(collection(db, "weeks", week.id, "entries"), where("points", "==", WEEKLY_MAX)))) : [];
        const board = buildBoard({ week, classes, top: top.rows, full });
        const b = writeBatch(db);
        b.set(doc(db, "public", "board"), { ...board, publishedAt: serverTimestamp() });
        b.set(doc(collection(db, "audit")), { action: "board.publish", actor: uid(), target: "public/board", before: null, after: { weekNumber: board.weekNumber }, at: serverTimestamp() });
        await b.commit();
      } catch (e) { throw mapError(e); }
    }
  };
}

/** يبني النسخة المنشورة لشاشة العرض: أسماء مختصرة وفصول فقط، دون أرقام طلابية. */
export function buildBoard({ week, classes, top, full }) {
  const label = (cid) => (classes.find((c) => c.id === cid) || {}).label || "";
  const cls = classes
    .filter((c) => c.activeCount > 0)
    .map((c) => ({ label: c.label, avg: Math.round((c.totalPoints / c.activeCount) * 10) / 10 }))
    .sort((a, b) => b.avg - a.avg);
  return {
    weekNumber: week ? week.number : null,
    topStudents: top.slice(0, 10).map((s) => ({ name: publicName(s.name), classLabel: label(s.classId), points: s.totalPoints })),
    topClasses: cls.slice(0, 6),
    fullMarks: full.map((e) => publicName(e.studentName))
  };
}

function mapError(e) {
  if (e instanceof StoreError) return e;
  const code = e && e.code;
  if (code === "permission-denied") return new StoreError("denied", "لا تملكين صلاحية هذه العملية.");
  if (code === "unavailable" || code === "deadline-exceeded" || code === "failed-precondition" && !navigator.onLine)
    return new StoreError("offline", "لم يُحفظ شيء: لا يوجد اتصال بالإنترنت. تحققي من الاتصال ثم أعيدي المحاولة.");
  if (code === "aborted") return new StoreError("conflict", "تزامن الحفظ مع تعديل آخر. أعيدي المحاولة.");
  if (code === "failed-precondition") return new StoreError("index", "تحتاج قاعدة البيانات فهرسًا. افتحي الرابط الظاهر في وحدة التحكم أو راجعي دليل الإعداد.", { raw: e.message });
  return new StoreError("unknown", "تعذّر إكمال العملية: " + (e && e.message ? e.message : "خطأ غير معروف"));
}
