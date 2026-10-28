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

/**
 * يحوّل صفوف CSV إلى طالبات مع حالة لكل صف.
 * الأعمدة بالترتيب: الاسم، الرقم الطلابي، الصف، الفصل. يُتجاهل صف العناوين إن وُجد.
 */
export function validateImport(rows, existingIds) {
  const out = [];
  const seen = new Set();
  rows.forEach((r, i) => {
    if (i === 0 && !/\d/.test(toLatinDigits(r[1] || ""))) return; // صف العناوين
    const name = (r[0] || "").replace(/\s+/g, " ").trim();
    const id = toLatinDigits(r[1]).replace(/\D/g, "");
    const gradeRaw = toLatinDigits(r[2]).replace(/ثانوي/g, "").trim();
    const grade = GRADE_WORDS[gradeRaw] || GRADE_WORDS[gradeRaw.replace(/\s/g, "")];
    const section = parseInt(toLatinDigits(r[3]), 10);
    let status = "new", note = "";
    if (!name || name.split(" ").length < 2) { status = "error"; note = "الاسم ناقص"; }
    else if (!id) { status = "error"; note = "الرقم الطلابي ناقص"; }
    else if (!grade) { status = "error"; note = "الصف غير مفهوم"; }
    else if (!(section >= 1 && section <= 3)) { status = "error"; note = "الفصل يجب أن يكون 1 أو 2 أو 3"; }
    else if (seen.has(id)) { status = "dup-file"; note = "مكرر داخل الملف"; }
    else if (existingIds.has(id)) { status = "exists"; note = "مسجّل مسبقًا"; }
    seen.add(id);
    out.push({ line: i + 1, name, id, classId: grade && section ? `${grade}-${section}` : null, status, note });
  });
  return out;
}
