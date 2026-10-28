// تعريفات مشتركة بين المخزن الحقيقي والمخزن التجريبي.

export const GRADES = [
  { grade: 1, name: "أول ثانوي", short: "أول" },
  { grade: 2, name: "ثاني ثانوي", short: "ثاني" },
  { grade: 3, name: "ثالث ثانوي", short: "ثالث" }
];

export const CLASSES = GRADES.flatMap((g) =>
  [1, 2, 3].map((s) => ({ id: `${g.grade}-${s}`, grade: g.grade, section: s, label: `${g.name} / ${s}`, short: `${g.short} ${s}` }))
);

export class StoreError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/** يقرأ صف CSV واحدًا مع دعم الحقول بين علامتي تنصيص. */
export function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === ";" || ch === "\t") { row.push(cur.trim()); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur.trim()); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur.length || row.length) { row.push(cur.trim()); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ""));
}

const GRADE_WORDS = { "1": 1, "اول": 1, "أول": 1, "الاول": 1, "الأول": 1, "2": 2, "ثاني": 2, "الثاني": 2, "3": 3, "ثالث": 3, "الثالث": 3 };
const DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
export const toLatinDigits = (t) => String(t || "").replace(/[٠-٩]/g, (d) => DIGITS[d]);

/** الرمز الداخلي للطالبة: الفصل عند الإضافة + تسلسل، مثل 1-2-007. لا يُعرض للعامة. */
export const studentCode = (classId, n) => `${classId}-${String(n).padStart(3, "0")}`;

/** تنظيف اسم مُدخل أو مستخرج. */
export const cleanName = (t) => String(t || "").replace(/[\u0640\u200e\u200f]/g, "").replace(/\d+/g, " ").replace(/\s+/g, " ").trim();

/**
 * يحوّل صفوف CSV إلى طالبات مع حالة لكل صف.
 * الأعمدة بالترتيب: الاسم، الصف، الفصل. يُتجاهل صف العناوين إن وُجد.
 * existingNames: Map(classId → Set(اسم مطبَّع)) لكشف المسجّلات مسبقًا.
 */
export function validateImport(rows, existingNames, normalize) {
  const out = [];
  const seen = new Set();
  rows.forEach((r, i) => {
    const gradeCell = toLatinDigits(r[1] || "").replace(/ثانوي/g, "").trim();
    if (i === 0 && !GRADE_WORDS[gradeCell] && !GRADE_WORDS[gradeCell.replace(/\s/g, "")]) return; // صف العناوين
    const name = cleanName(r[0]);
    const grade = GRADE_WORDS[gradeCell] || GRADE_WORDS[gradeCell.replace(/\s/g, "")];
    const section = parseInt(toLatinDigits(r[2]), 10);
    const classId = grade && section >= 1 && section <= 3 ? `${grade}-${section}` : null;
    const key = classId + "|" + normalize(name);
    let status = "new", note = "";
    if (!name || name.split(" ").length < 2) { status = "error"; note = "الاسم ناقص"; }
    else if (!grade) { status = "error"; note = "الصف غير مفهوم"; }
    else if (!classId) { status = "error"; note = "الفصل يجب أن يكون 1 أو 2 أو 3"; }
    else if (seen.has(key)) { status = "dup-file"; note = "مكرر داخل الملف"; }
    else if (existingNames.get(classId)?.has(normalize(name))) { status = "exists"; note = "مسجّلة مسبقًا في الفصل"; }
    seen.add(key);
    out.push({ line: i + 1, name, classId, status, note });
  });
  return out;
}
