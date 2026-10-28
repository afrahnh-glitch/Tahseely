// اختبارات قاعدة الاحتساب (تعمل بـ node دون أي اعتماديات): node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { scoreMarks, entryDelta, rankRows, publicName } from "../js/scoring.js";
import { parseCSV, validateImport, studentCode } from "../js/store-common.js";

test("مجال واحد صحيح = 5 نقاط", () => {
  assert.deepEqual(scoreMarks({ p: true, c: false, b: false }), { correctCount: 1, bonus: 0, points: 5 });
});
test("الثلاث صحيحة = 20 نقطة مع المكافأة", () => {
  assert.deepEqual(scoreMarks({ p: true, c: true, b: true }), { correctCount: 3, bonus: 5, points: 20 });
});
test("خطأ في مجال واحد = 10 بلا مكافأة", () => {
  assert.deepEqual(scoreMarks({ p: true, c: true, b: false }), { correctCount: 2, bonus: 0, points: 10 });
});
test("الثلاث خاطئة = 0 لكنها مشاركة", () => {
  const s = scoreMarks({ p: false, c: false, b: false });
  assert.equal(s.points, 0);
  assert.equal(entryDelta(null, s).participations, 1);
});
test("لا تُقبل حالة ناقصة", () => {
  assert.throws(() => scoreMarks({ p: true, c: null, b: true }));
});
test("الحد الأعلى 20 في كل الحالات الثماني", () => {
  for (let i = 0; i < 8; i++) {
    const m = { p: !!(i & 1), c: !!(i & 2), b: !!(i & 4) };
    assert.ok(scoreMarks(m).points <= 20);
  }
});
test("تعديل نتيجة سابقة يضيف الفرق فقط ولا يزيد المشاركات", () => {
  const old = { points: 20, correctCount: 3 };
  const d = entryDelta(old, scoreMarks({ p: true, c: false, b: true }));
  assert.deepEqual(d, { points: -10, correct: -1, participations: 0, fullMarks: -1 });
});
test("التعادل يُعطي المركز نفسه دون نقاط إضافية", () => {
  const r = rankRows([{ n: "ب", v: 30 }, { n: "أ", v: 30 }, { n: "ج", v: 10 }], (x) => x.v, (x) => x.n);
  assert.deepEqual(r.map((x) => x.rank), [1, 1, 3]);
  assert.deepEqual(r.map((x) => x.row.v), [30, 30, 10]);
});
test("اسم العرض العام بلا اسم الأب", () => {
  assert.equal(publicName("نورة عبدالله العتيبي"), "نورة العتيبي");
});
test("استيراد CSV بالاسم: عناوين، مكرر، موجود مسبقًا، خطأ", () => {
  const norm = (t) => t.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").trim();
  const csv = "الاسم,الصف,الفصل\nنورة عبدالله العتيبي,أول,1\nريم محمد السليم,2,3\nنورة عبدالله العتيبي,1,1\nهيا,1,1\nجود سعد الزامل,ثالث,4\nسارة فهد المطيري,ثاني,٢";
  const existing = new Map([["2-3", new Set([norm("ريم محمد السليم")])]]);
  const out = validateImport(parseCSV(csv), existing, norm);
  assert.deepEqual(out.map((r) => r.status), ["new", "exists", "dup-file", "error", "error", "new"]);
  assert.equal(out[0].classId, "1-1");
  assert.equal(out[5].classId, "2-2");
});
test("رمز الطالبة الداخلي", () => {
  assert.equal(studentCode("1-2", 7), "1-2-007");
});
