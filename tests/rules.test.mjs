// اختبارات قواعد Firestore على المحاكي (Firebase Emulator).
// ⚠️ لم تُشغَّل بعد: بيئة العمل التي كُتبت فيها لم تسمح بتنزيل أدوات Firebase.
// التشغيل على كمبيوتر فيه Node 20+ وJava 17+:
//   cd tests && npm install && npx firebase emulators:exec --only firestore --project demo-rased "node --test rules.test.mjs"
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import * as fs from "firebase/firestore";
import { createFirestoreStore } from "../js/store-firestore.js";

const { doc, setDoc, getDoc, updateDoc, serverTimestamp, writeBatch, collection } = fs;
let env;

before(async () => {
  globalThis.navigator ??= { onLine: true };
  env = await initializeTestEnvironment({
    projectId: "demo-rased",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") }
  });
});
after(async () => env && env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/admin"), { name: "مديرة", role: "admin", active: true });
    await setDoc(doc(db, "users/t1"), { name: "معلمة 1", role: "teacher", active: true });
    await setDoc(doc(db, "users/t2"), { name: "معلمة 2", role: "teacher", active: true });
    for (const id of ["1-1", "1-2"]) await setDoc(doc(db, "classes", id), { grade: 1, section: +id[2], label: id, activeCount: 1, totalPoints: 0, participations: 0 });
    await setDoc(doc(db, "students/1001"), { name: "نورة عبدالله العتيبي", classId: "1-1", active: true, totalPoints: 30, participations: 2, correctCount: 5 });
    await setDoc(doc(db, "students/1002"), { name: "ريم محمد السليم", classId: "1-2", active: true, totalPoints: 0, participations: 0, correctCount: 0 });
    await setDoc(doc(db, "weeks/w01"), { number: 1, status: "open", answerKey: { p: "ب", c: "د", b: "أ" }, keyLockedAt: null, participants: 0, pointsTotal: 0, fullMarks: 0, perClass: {} });
    await setDoc(doc(db, "weeks/w02"), { number: 2, status: "closed", answerKey: { p: "أ", c: "أ", b: "أ" }, keyLockedAt: null, participants: 0, pointsTotal: 0, fullMarks: 0, perClass: {} });
    await setDoc(doc(db, "public/board"), { weekNumber: 1, topStudents: [], topClasses: [], fullMarks: [] });
  });
});

const as = (uid, role) => {
  const db = env.authenticatedContext(uid).firestore();
  return { db, store: createFirestoreStore({ fs, db, getUid: () => uid, getRole: () => role }) };
};
const anon = () => env.unauthenticatedContext().firestore();
const ALL = { p: true, c: true, b: true };

test("الزائر لا يقرأ الطالبات ولا المشاركات", async () => {
  await assertFails(getDoc(doc(anon(), "students/1001")));
  await assertFails(getDoc(doc(anon(), "weeks/w01")));
});
test("الزائر يقرأ لوحة العرض فقط ولا يكتب فيها", async () => {
  await assertSucceeds(getDoc(doc(anon(), "public/board")));
  await assertFails(setDoc(doc(anon(), "public/board"), { weekNumber: 9 }));
});
test("حساب بلا مستند صلاحية لا يقرأ شيئًا", async () => {
  await assertFails(getDoc(doc(env.authenticatedContext("stranger").firestore(), "students/1001")));
});

test("رصد صحيح من معلمة: 20 نقطة وتحديث المجاميع", async () => {
  const { store, db } = as("t1", "teacher");
  await assertSucceeds(store.saveEntry({ weekId: "w01", studentId: "1001", marks: ALL, mode: "create" }));
  const s = (await getDoc(doc(db, "students/1001"))).data();
  const w = (await getDoc(doc(db, "weeks/w01"))).data();
  assert.equal(s.totalPoints, 50); assert.equal(s.participations, 3);
  assert.equal(w.participants, 1); assert.equal(w.fullMarks, 1); assert.deepEqual(w.perClass["1-1"], { n: 1, pts: 20 });
});
test("مجال واحد صحيح = 5 فقط", async () => {
  const { store, db } = as("t1", "teacher");
  await store.saveEntry({ weekId: "w01", studentId: "1002", marks: { p: true, c: false, b: false }, mode: "create" });
  assert.equal((await getDoc(doc(db, "weeks/w01/entries/1002"))).data().points, 5);
});

test("نقاط مزوّرة تُرفض (25 بدل 20)", async () => {
  const { db } = as("t1", "teacher");
  const b = writeBatch(db);
  const a = doc(collection(db, "audit"));
  b.set(a, { action: "x", actor: "t1", target: "", before: null, after: null, at: serverTimestamp() });
  b.set(doc(db, "weeks/w01/entries/1001"), { marks: ALL, points: 25, correctCount: 3, classIdAtEntry: "1-1", studentName: "نورة عبدالله العتيبي", recordedBy: "t1", recordedAt: serverTimestamp(), updatedBy: "t1", updatedAt: serverTimestamp(), auditId: a.id });
  b.update(doc(db, "students/1001"), { totalPoints: 55, participations: 3, correctCount: 8, lastEntryWeek: "w01", updatedAt: serverTimestamp() });
  b.update(doc(db, "classes/1-1"), { totalPoints: 25, participations: 1, lastEntryWeek: "w01", lastEntryStudent: "1001", updatedAt: serverTimestamp() });
  b.update(doc(db, "weeks/w01"), { participants: 1, pointsTotal: 25, fullMarks: 0, "perClass.1-1": { n: 1, pts: 25 }, keyLockedAt: serverTimestamp(), lastEntryStudent: "1001", updatedAt: serverTimestamp() });
  await assertFails(b.commit());
});
test("مشاركة دون تحديث مجموع الطالبة تُرفض", async () => {
  const { db } = as("t1", "teacher");
  const a = doc(collection(db, "audit"));
  const b = writeBatch(db);
  b.set(a, { action: "x", actor: "t1", target: "", before: null, after: null, at: serverTimestamp() });
  b.set(doc(db, "weeks/w01/entries/1001"), { marks: ALL, points: 20, correctCount: 3, classIdAtEntry: "1-1", studentName: "نورة عبدالله العتيبي", recordedBy: "t1", recordedAt: serverTimestamp(), updatedBy: "t1", updatedAt: serverTimestamp(), auditId: a.id });
  await assertFails(b.commit());
});
test("المعلمة لا تعدّل مجموع طالبة مباشرة", async () => {
  const { db } = as("t1", "teacher");
  await assertFails(updateDoc(doc(db, "students/1001"), { totalPoints: 999 }));
});

test("مشاركة مكررة في الأسبوع نفسه تُرفض", async () => {
  const { store } = as("t1", "teacher");
  await store.saveEntry({ weekId: "w01", studentId: "1001", marks: ALL, mode: "create" });
  await assert.rejects(store.saveEntry({ weekId: "w01", studentId: "1001", marks: ALL, mode: "create" }), (e) => e.code === "duplicate");
});
test("تعديل نتيجة سابقة: يتغير المجموع بالفرق ولا تزيد المشاركات", async () => {
  const { store, db } = as("t1", "teacher");
  await store.saveEntry({ weekId: "w01", studentId: "1001", marks: ALL, mode: "create" });
  await assertSucceeds(store.saveEntry({ weekId: "w01", studentId: "1001", marks: { p: true, c: false, b: true }, mode: "edit" }));
  const s = (await getDoc(doc(db, "students/1001"))).data();
  assert.equal(s.totalPoints, 40); assert.equal(s.participations, 3);
});
test("معلمة أخرى لا تعدّل مشاركة لم ترصدها", async () => {
  await as("t1", "teacher").store.saveEntry({ weekId: "w01", studentId: "1001", marks: ALL, mode: "create" });
  // نتجاوز فحص الواجهة لنختبر القواعد نفسها
  const { store } = as("t2", "admin");
  await assertFails(store.saveEntry({ weekId: "w01", studentId: "1001", marks: { p: false, c: false, b: false }, mode: "edit" }));
});
test("أسبوع مغلق: المعلمة لا ترصد، والمديرة ترصد", async () => {
  const t = as("t1", "admin"); // الواجهة تسمح، والقواعد يجب أن ترفض
  await assertFails(t.store.saveEntry({ weekId: "w02", studentId: "1001", marks: ALL, mode: "create" }));
  await assertSucceeds(as("admin", "admin").store.saveEntry({ weekId: "w02", studentId: "1001", marks: ALL, mode: "create" }));
});
test("المعلمة لا تغيّر مفتاح الإجابة ولا حالة الأسبوع", async () => {
  const { db } = as("t1", "teacher");
  await assertFails(updateDoc(doc(db, "weeks/w01"), { answerKey: { p: "أ", c: "أ", b: "أ" } }));
  await assertFails(updateDoc(doc(db, "weeks/w01"), { status: "closed" }));
});
test("المعلمة لا تمنح نفسها صلاحية مديرة", async () => {
  const { db } = as("t1", "teacher");
  await assertFails(updateDoc(doc(db, "users/t1"), { role: "admin" }));
});
test("سجل التدقيق لا يُعدَّل ولا يُحذف", async () => {
  const { store, db } = as("admin", "admin");
  await store.saveEntry({ weekId: "w01", studentId: "1001", marks: ALL, mode: "create" });
  const id = (await getDoc(doc(db, "weeks/w01/entries/1001"))).data().auditId;
  await assertFails(updateDoc(doc(db, "audit", id), { action: "hidden" }));
});
test("نقل طالبة لا يغيّر نقاط فصلها السابق", async () => {
  const t = as("t1", "teacher");
  await t.store.saveEntry({ weekId: "w01", studentId: "1001", marks: ALL, mode: "create" });
  const a = as("admin", "admin");
  await a.store.updateStudent("1001", { classId: "1-2" });
  const c1 = (await getDoc(doc(a.db, "classes/1-1"))).data();
  const s = (await getDoc(doc(a.db, "students/1001"))).data();
  assert.equal(c1.totalPoints, 20); assert.equal(s.totalPoints, 50); assert.equal(s.classId, "1-2");
});
test("أسبوع جديد بلا مشاركات لا يُنشئ أي مستند للطالبات", async () => {
  const a = as("admin", "admin");
  await a.store.createWeek({ number: 3, startDate: "2026-09-20", answerKey: { p: "ب", c: "ب", b: "ب" } });
  const qs = await fs.getDocs(collection(a.db, "weeks/w03/entries"));
  assert.equal(qs.size, 0);
});
