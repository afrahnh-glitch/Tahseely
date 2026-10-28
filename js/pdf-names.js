// استخراج أسماء الطالبات من كشف PDF (كشف أسماء الطالبات بالفصل من نظام نور).
// يُقرأ الاسم فقط. أرقام السجل المدني وأي أرقام أخرى تُتجاهل ولا تُخزَّن.
//
// ملاحظة تقنية: كشوف نور المولّدة بـ Microsoft Reporting Services تحمل خريطة
// ترميز خاطئة: كل حرف عربي يظهر كرمز في المدى U+0300–U+03FF بدل أشكال الحروف
// العربية (U+FB00 + الرمز)، والمسافة تظهر كرمز 0x03، والكلمات بترتيب بصري.
// نعيد الترميز ثم نعكس الترتيب ونحوّل الأشكال إلى حروف عادية (NFKC).

const ALLAH = "";
const SPECIAL = { 0x03: " ", 0x2ef: "ء", 0xbcc: ALLAH, 0x10: "-" };

function isBroken(s) { return /[΀-Ͽ]/.test(s); }

export function decodeRun(s) {
  if (!isBroken(s)) return s.normalize("NFKC");
  let out = "";
  for (const ch of s) {
    const k = ch.codePointAt(0);
    if (SPECIAL[k] !== undefined) out += SPECIAL[k];
    else if (k >= 0x300 && k <= 0x3ff) out += String.fromCodePoint(k + 0xfb00);
    else out += ch;
  }
  // البصري ← المنطقي، مع إبقاء الأرقام بترتيبها
  out = [...out].reverse().join("").normalize("NFKC").split(ALLAH).join("الله");
  return out.replace(/\d+/g, (m) => [...m].reverse().join(""));
}

const hasArabic = (s) => /[ء-ي]/.test(s);
const clean = (s) => s.replace(/[ـ‏‎]/g, "").replace(/\s+/g, " ").trim();
const LABELS = /^(الاسم|م|رقم|المملكة|وزارة|التعليم|الإدارة|المدرسة|المعلم|الصف|القسم|الفصل|النظام|كشف)(\s|:|$)/;
const GRADES = [[/(^|\s)(الأول|الاول)(\s|$)/, 1], [/(^|\s)الثاني(\s|$)/, 2], [/(^|\s)الثالث(\s|$)/, 3]];

let pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) {
    const base = new URL("./vendor/", import.meta.url);
    pdfjsP = import(new URL("pdf.min.mjs", base).href).then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", base).href;
      return m;
    });
  }
  return pdfjsP;
}

/**
 * يعيد { grade, section, names, pages } أو يرمي خطأً مفهومًا.
 * grade/section = ما اكتُشف من رأس الكشف (قد يكون null).
 */
export async function extractNamesFromPdf(arrayBuffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false }).promise;
  let grade = null, section = null;
  const names = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent({ disableNormalization: true });
    // تجميع العناصر في أسطر حسب الارتفاع
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim() && it.str !== "\u0003") continue;
      const y = Math.round(it.transform[5]);
      let key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2);
      if (key === undefined) { key = y; rows.set(key, []); }
      rows.get(key).push({ x: it.transform[4], s: decodeRun(it.str) });
    }
    const ys = [...rows.keys()].sort((a, b) => b - a); // من الأعلى للأسفل
    let headerSeen = false;
    for (const y of ys) {
      const parts = rows.get(y).sort((a, b) => b.x - a.x); // من اليمين لليسار
      const arabic = parts.filter((p) => hasArabic(p.s)).map((p) => clean(p.s));
      const line = arabic.join(" ");
      const digits = parts.map((p) => p.s.trim()).filter((s) => /^\d+$/.test(s));
      if (grade === null && arabic.some((a) => /^الصف(\s|:|$)/.test(a))) {
        for (const [re, g] of GRADES) if (re.test(line)) { grade = g; break; }
      }
      if (section === null && digits.length && arabic.some((a) => /^الفصل(\s|:|$)/.test(a))) section = parseInt(digits[0], 10) || null;
      if (/^الاسم/.test(line) || arabic.includes("الاسم")) { headerSeen = true; continue; }
      if (!headerSeen) continue;
      // سطر الاسم: نص عربي من كلمتين فأكثر، ليس عنوانًا
      for (const a of arabic) {
        const name = clean(a.replace(/[\d:]/g, " "));
        if (name.split(" ").length >= 2 && !LABELS.test(name)) names.push(name);
      }
    }
  }
  return { grade, section, names, pages: doc.numPages };
}
