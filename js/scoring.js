// احتساب النقاط — المصدر الوحيد للقاعدة في الواجهة.
// القاعدة نفسها مكتوبة أيضًا في firestore.rules، والخادم يرفض أي رقم لا يطابقها.

export const DOMAINS = [
  { key: "p", name: "الفيزياء", letter: "ف" },
  { key: "c", name: "الكيمياء", letter: "ك" },
  { key: "b", name: "الأحياء", letter: "أ" }
];

export const POINTS_PER_CORRECT = 5;
export const ALL_CORRECT_BONUS = 5;
export const WEEKLY_MAX = 20;

/**
 * marks = { p: true|false, c: true|false, b: true|false }
 * true = صحيحة، false = خاطئة. لا توجد حالة «لم تشارك» هنا:
 * عدم المشاركة = عدم وجود مشاركة أصلًا.
 */
export function scoreMarks(marks) {
  if (!marks) throw new Error("marks required");
  let correct = 0;
  for (const d of DOMAINS) {
    const v = marks[d.key];
    if (v !== true && v !== false) throw new Error("كل مجال يجب أن يكون صحيحة أو خاطئة");
    if (v) correct++;
  }
  const bonus = correct === 3 ? ALL_CORRECT_BONUS : 0;
  return { correctCount: correct, bonus, points: correct * POINTS_PER_CORRECT + bonus };
}

/** الفروق التي تُضاف إلى المجاميع عند إنشاء مشاركة أو تعديلها. */
export function entryDelta(oldEntry, newScore) {
  const oldPts = oldEntry ? oldEntry.points : 0;
  const oldCorrect = oldEntry ? oldEntry.correctCount : 0;
  const oldFull = oldEntry && oldEntry.points === WEEKLY_MAX ? 1 : 0;
  return {
    points: newScore.points - oldPts,
    correct: newScore.correctCount - oldCorrect,
    participations: oldEntry ? 0 : 1,
    fullMarks: (newScore.points === WEEKLY_MAX ? 1 : 0) - oldFull
  };
}

/** ترتيب بمراكز مشتركة عند التعادل (1، 1، 3) وترتيب أبجدي داخل التعادل للعرض فقط. */
export function rankRows(rows, valueOf, nameOf) {
  const sorted = rows.slice().sort((a, b) => valueOf(b) - valueOf(a) || nameOf(a).localeCompare(nameOf(b), "ar"));
  let last = null, rank = 0;
  return sorted.map((r, i) => {
    const v = valueOf(r);
    if (v !== last) { rank = i + 1; last = v; }
    return { row: r, rank };
  });
}

/** اسم العرض العام: الاسم الأول + اسم العائلة، دون الأرقام. */
export function publicName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] || "";
  return parts[0] + " " + parts[parts.length - 1];
}

export function normalizeArabic(t) {
  return String(t || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .trim();
}
