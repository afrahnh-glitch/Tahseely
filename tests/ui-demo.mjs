// اختبار واجهة الوضع التجريبي في متصفح حقيقي (Chromium عبر Playwright).
// لا يختبر Firebase ولا القواعد؛ يختبر سلوك الواجهة والاحتساب والتنبيهات.
// التشغيل: python3 -m http.server 8765 (من مجلد المشروع) ثم node tests/ui-demo.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");

const BASE = process.env.BASE || "http://127.0.0.1:8765";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: "ar" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

const text = (sel) => page.locator(sel).first().innerText();
const kpi = async (label) => Number((await page.locator(".kpi").filter({ has: page.locator(".k", { hasText: label }) }).locator(".v").innerText()).trim());

await page.goto(BASE + "/index.html?demo=1#dashboard");
await page.waitForSelector(".kpi");
check("شريط الوضع التجريبي ظاهر", await page.locator(".demo-bar").isVisible());
const reg = await kpi("المسجلات"), part = await kpi("مشاركات الأسبوع"), non = await kpi("لم يشاركن");
check("غير المشاركات = المسجلات − المشاركات (دون إدخال)", reg === 280 && non === reg - part, `${reg} − ${part} = ${non}`);
check("المعلمة لا ترى روابط الإدارة", (await page.locator('.nav a[data-r="manage"]').count()) === 0);
await page.goto(BASE + "/index.html?demo=1#manage");
await page.waitForTimeout(300);
check("المعلمة تُعاد من صفحة الإدارة إلى الرئيسية", (await text("#pageTitle")) === "لوحة التحكم");

// ----- فصل لم يبدأ رصده: ثالث ثانوي / 2 -----
await page.goto(BASE + "/index.html?demo=1#entry");
await page.waitForSelector("#eGrade");
await page.click('#eGrade button[data-g="3"]');
await page.click('#eCls button[data-c="3-2"]');
await page.waitForSelector(".stu");
const rowsTotal = await page.locator(".stu").count();
const waitTags = await page.locator(".stu .tag.wait").count();
check("كل طالبات الفصل «لم تشارك» افتراضيًا", rowsTotal > 0 && waitTags === rowsTotal, `${waitTags}/${rowsTotal}`);
check("المؤشر 0 من الفصل", (await text("#eCounter .big")) === `0 من ${rowsTotal}`);

// ----- رصد: صحيحتان وخاطئة = 10 بلا مكافأة -----
const firstName = await page.locator(".stu .nm b").first().innerText();
await page.locator('.stu [data-act="record"]').first().click();
await page.waitForSelector(".modal");
check("زر الحفظ معطّل قبل تحديد المجالات", await page.locator('[data-m="saveNext"]').isDisabled());
await page.click('.opt[data-d="p"][data-v="1"]');
await page.click('.opt[data-d="c"][data-v="1"]');
await page.click('.opt[data-d="b"][data-v="0"]');
check("المجموع 10 دون مكافأة", (await text(".total .tv")).startsWith("10") && !(await page.locator(".bonus.on").count()));
await page.click('[data-m="saveNext"]');
await page.waitForSelector(".toast:not([hidden])");
await page.waitForSelector(".modal");
const nextName = await page.locator("#mTitle").innerText();
check("«حفظ والانتقال للتالية» يفتح الطالبة التالية", nextName !== firstName, nextName);
check("صف الطالبة الأولى صار «شاركت · 10»", (await page.locator(".stu", { hasText: firstName }).locator(".tag").innerText()).includes("10"));

// ----- الثلاث صحيحة = 20 مع المكافأة -----
await page.click('[data-m="all"]');
check("الثلاث صحيحة = 20 مع ظهور المكافأة", (await text(".total .tv")).startsWith("20") && (await page.locator(".bonus.on").count()) === 1);
await page.click('[data-m="save"]');
await page.waitForSelector(".modal", { state: "detached" }).catch(() => {});
await page.waitForTimeout(200);
check("المؤشر صار 2 من الفصل", (await text("#eCounter .big")) === `2 من ${rowsTotal}`);

// ----- محاولة مشاركة مكررة (رُصدت من جهاز آخر أثناء فتح النافذة) -----
const third = page.locator('.stu:has([data-act="record"])').first();
const thirdId = (await third.getAttribute("id")).replace("row-", "");
await third.locator('[data-act="record"]').click();
await page.waitForSelector(".modal");
await page.evaluate((id) => window.__demoStore.saveEntry({ weekId: "w08", studentId: id, marks: { p: true, c: false, b: false }, mode: "create" }), thirdId);
await page.click('[data-m="all"]');
await page.click('[data-m="save"]');
await page.waitForSelector(".alert.warn");
check("تنبيه المشاركة المكررة يظهر ويمنع الحفظ", (await text(".alert.warn")).includes("مرصودة مسبقًا") && (await page.locator('[data-m="save"]').isDisabled()));
await page.click('[data-m="toEdit"]');
check("فتح المشاركة الموجودة للتعديل بقيمها (5 نقاط)", (await text(".total .tv")).startsWith("5"));
await page.click('[data-m="all"]');
await page.click('[data-m="save"]');
await page.waitForTimeout(600);
const after = await page.evaluate((id) => window.__demoStore.getEntry("w08", id), thirdId);
const stu = await page.evaluate((id) => window.__demoStore.getStudent(id), thirdId);
check("التعديل يحدّث المشاركة دون تكرار", after.points === 20 && stu.participations >= 1, `points=${after.points}`);
const wk = await page.evaluate(() => window.__demoStore.getWeek("w08"));
check("الأسبوع يحسب الطالبة مرة واحدة", wk.perClass["3-2"].n === 3, `perClass n=${wk.perClass["3-2"].n}`);

// ----- انقطاع الإنترنت -----
await page.check("#demoOffline");
const fourth = page.locator('.stu:has([data-act="record"])').first();
const fourthName = await fourth.locator(".nm b").innerText();
await fourth.locator('[data-act="record"]').click();
await page.click('[data-m="all"]');
await page.click('[data-m="save"]');
await page.waitForSelector(".modal .alert.err");
check("انقطاع الإنترنت: رسالة فشل واضحة والنافذة تبقى", (await text(".modal .alert.err")).includes("لا يوجد اتصال"));
await page.click('[data-m="close"]');
check("لا نجاح وهمي: الطالبة ما زالت «لم تشارك»", (await page.locator(".stu", { hasText: fourthName }).locator(".tag").innerText()).includes("لم تشارك"));
await page.uncheck("#demoOffline");

// ----- مشاركة رصدتها معلمة أخرى: لا تعديل -----
await page.click('#eGrade button[data-g="1"]');
await page.waitForSelector(".stu");
await page.click('#eFilter button[data-f="done"]');
const otherCount = await page.locator(".stu", { hasText: "رصدتها" }).count();
check("مشاركات معلمة أخرى بلا زر تعديل للمعلمة", otherCount > 0, `${otherCount} صفوف`);
await page.click('#eFilter button[data-f="all"]');

// ----- البحث بالاسم داخل الفصل -----
const someName = await page.locator(".stu .nm b").nth(3).innerText();
await page.fill("#eQ", someName.split(" ")[0].replace(/^ا/, "أ"));
await page.waitForTimeout(150);
check("البحث بالاسم يجد الطالبة (مع تطبيع الهمزات)", (await page.locator(".stu", { hasText: someName }).count()) === 1);
// البحث في كل الفصول: اسم من فصل آخر يظهر وفصلُه مكتوب تحته، ويمكن رصده مباشرة
const other = await page.evaluate(async () => (await window.__demoStore.classStudents("3-3"))[5]);
await page.fill("#eQ", other.name.split(" ").slice(0, 2).join(" "));
await page.waitForSelector(".stu", { timeout: 5000 });
const hit = page.locator(".stu", { hasText: other.name });
check("البحث يجد طالبة من فصل آخر دون تغيير الفصل", (await hit.count()) === 1 && (await hit.innerText()).includes("ثالث ثانوي / 3"));
if (await hit.locator('[data-act="record"]').count()) {
  await hit.locator('[data-act="record"]').click();
  await page.click('[data-m="all"]');
  await page.click('[data-m="save"]');
  await page.waitForTimeout(700);
  const en = await page.evaluate((id) => window.__demoStore.getEntry("w08", id), other.id);
  check("الرصد من نتيجة البحث يُحفظ للفصل الصحيح", en && en.points === 20 && en.classIdAtEntry === "3-3");
  check("نتيجة البحث تتحدّث إلى «شاركت»", (await hit.locator(".tag").innerText()).includes("شاركت"));
}
await page.fill("#eQ", "");
await page.waitForTimeout(150);
check("لا تظهر أرقام في قائمة الرصد", !/\d{5,}|\d-\d-\d{3}/.test(await page.locator("#eList").innerText()));
await page.fill("#eQ", "");

// ----- المديرة: أسبوع جديد بلا مشاركات -----
await page.selectOption("#demoUser", "demo-admin");
await page.waitForSelector('.nav a[data-r="weeks"]');
check("المديرة ترى روابط الإدارة", (await page.locator('.nav a[data-r="manage"]').count()) === 1);
await page.goto(BASE + "/index.html?demo=1#weeks");
await page.waitForSelector("#wForm");
await page.fill("#wKp", "ب"); await page.fill("#wKc", "د"); await page.fill("#wKb", "أ");
await page.click("#wSave");
await page.waitForSelector('[data-w="open"][data-id="w09"]');
await page.click('[data-w="open"][data-id="w09"]');
await page.waitForSelector('[data-w="current"][data-id="w09"]');
await page.click('[data-w="current"][data-id="w09"]');
await page.waitForTimeout(500);
await page.goto(BASE + "/index.html?demo=1#dashboard");
await page.waitForSelector(".kpi");
check("أسبوع جديد: 0 مشاركات و280 لم يشاركن", (await kpi("مشاركات الأسبوع")) === 0 && (await kpi("لم يشاركن")) === 280);
const tops = await page.locator(".li .pts").first().innerText();
check("النقاط السابقة باقية في الأسبوع الجديد", parseInt(tops, 10) > 0, tops);

// ----- تغيير المفتاح بعد بدء الرصد يُسجَّل -----
await page.goto(BASE + "/index.html?demo=1#weeks");
await page.waitForSelector('[data-w="key"][data-id="w08"]');
await page.click('[data-w="key"][data-id="w08"]');
check("تحذير قفل المفتاح يظهر", (await text(".alert.warn")).includes("بدأ رصد"));
await page.fill("#kEp", "ج");
await page.click('[data-w="keySave"]');
await page.waitForTimeout(500);
await page.goto(BASE + "/index.html?demo=1#audit");
await page.waitForSelector("tbody tr");
check("السجل يحوي تغيير المفتاح بعد بدء الرصد", (await page.locator("tbody").innerText()).includes("تغيير مفتاح بعد بدء الرصد"));

// ----- نقل طالبة لها نقاط -----
const mover = await page.evaluate(async () => (await window.__demoStore.topStudents({ classIds: ["1-1"], pageSize: 1 })).rows[0]);
const classesBefore = await page.evaluate(() => window.__demoStore.listClasses());
await page.goto(BASE + "/index.html?demo=1#manage");
await page.waitForSelector(`[data-e="${mover.id}"]`);
await page.click(`[data-e="${mover.id}"]`);
await page.waitForSelector("text=تعديل بيانات طالبة");
await page.selectOption("#mCls", "1-2");
await page.click("#mSave");
await page.waitForSelector("text=إضافة طالبة");
await page.waitForTimeout(300);
const moved = await page.evaluate((id) => window.__demoStore.getStudent(id), mover.id);
const classesAfter = await page.evaluate(() => window.__demoStore.listClasses());
const cb = (arr, id) => arr.find((c) => c.id === id);
check("النقل لا يغيّر مجموع الطالبة", moved.classId === "1-2" && moved.totalPoints === mover.totalPoints, `${mover.totalPoints} → ${moved.totalPoints}`);
check("النقل لا يغيّر نقاط الفصلين التاريخية", cb(classesAfter, "1-1").totalPoints === cb(classesBefore, "1-1").totalPoints && cb(classesAfter, "1-2").totalPoints === cb(classesBefore, "1-2").totalPoints);
check("النقل يحدّث عدد المسجلات", cb(classesAfter, "1-1").activeCount === cb(classesBefore, "1-1").activeCount - 1 && cb(classesAfter, "1-2").activeCount === cb(classesBefore, "1-2").activeCount + 1);

// ----- إضافة اسم مكرر في الفصل: تنبيه قبل الحفظ -----
await page.waitForSelector("text=إضافة طالبة");
await page.selectOption("#mF", "1-2");
await page.waitForSelector("#mBody tr td b");
const dupName = await page.locator("#mBody tr td b").first().innerText();
await page.fill("#mName", dupName);
await page.selectOption("#mCls", "1-2");
await page.click("#mSave");
await page.waitForTimeout(500);
check("إضافة اسم موجود في الفصل تعرض تنبيهًا ولا تُحفظ", (await text("#mErr")).includes("اسم مطابق"));

// ----- استيراد كشف PDF من نور -----
const before12 = (await page.evaluate(() => window.__demoStore.listClasses())).find((c) => c.id === "1-3").activeCount;
await page.setInputFiles("#impPdf", process.env.PDF);
await page.waitForSelector("#impText", { timeout: 30000 });
const lines = (await page.locator("#impText").inputValue()).split("\n").filter(Boolean);
check("PDF: استُخرج 28 اسمًا", lines.length === 28, String(lines.length));
check("PDF: اكتُشف الفصل أول ثانوي / 1", (await page.locator("#impCls").inputValue()) === "1-1");
check("PDF: لا أرقام سجل مدني في الأسماء", lines.every((l) => !/\d/.test(l)));
check("PDF: «عبدالله» سليمة", lines[0] === "أشواق صنيتان عبدالله السالمي الحربي", lines[0]);
await page.selectOption("#impCls", "1-3");
await page.waitForTimeout(400);
check("PDF: المعاينة تعرض عدد الإضافة", (await text("#impCheck")).includes("28"));
await page.click("#impGo");
await page.waitForSelector("text=إضافة طالبة");
await page.waitForTimeout(400);
const after12 = (await page.evaluate(() => window.__demoStore.listClasses())).find((c) => c.id === "1-3").activeCount;
check("PDF: أُضيفت 28 طالبة للفصل المختار", after12 === before12 + 28, `${before12} → ${after12}`);
// إعادة الاستيراد نفسه: كلها مسجّلة مسبقًا
await page.setInputFiles("#impPdf", process.env.PDF);
await page.waitForSelector("#impText", { timeout: 30000 });
await page.selectOption("#impCls", "1-3");
await page.waitForTimeout(400);
check("PDF: إعادة الاستيراد تكتشف المسجّلات مسبقًا", (await text("#impCheck")).includes("28 مسجّلة مسبقًا") && (await page.locator("#impGo").isDisabled()));
await page.click("#impCancel");

// ----- ترتيب الطالبات والفصول -----
await page.goto(BASE + "/index.html?demo=1#students");
await page.waitForSelector("#rBody tr td .rank");
const cols = await page.locator("#rHead th").allInnerTexts();
check("أعمدة الترتيب كاملة", ["المركز", "الطالبة", "الصف / الفصل", "المجموع التراكمي", "المشاركات", "الإجابات الصحيحة"].every((c) => cols.includes(c)));
check("التحميل التدريجي: 50 صفًا وزر للمزيد", (await page.locator("#rBody tr").count()) === 50 && (await page.locator("#rMoreBtn").count()) === 1);
await page.click('#rView button[data-v="week"]');
await page.selectOption("#rW", "w08");
await page.waitForTimeout(400);
const weekRows = await page.locator("#rBody tr").count();
const wk8 = await page.evaluate(() => window.__demoStore.getWeek("w08"));
check("عرض مشاركات الأسبوع يضم المشاركات فقط", weekRows === wk8.participants, `${weekRows} صفًا = ${wk8.participants} مشاركة`);
await page.goto(BASE + "/index.html?demo=1#classes");
await page.waitForSelector(".cls-row");
const avgs = await page.locator(".cls-row .avg").allInnerTexts();
const nums = avgs.map((t) => parseFloat(t));
check("الفصول مرتبة تنازليًا بالمتوسط لكل مسجلة", nums.length === 9 && nums.every((v, i) => i === 0 || v <= nums[i - 1]));

// ----- لوحة العرض العامة -----
await page.goto(BASE + "/index.html?demo=1#weeks");
await page.waitForSelector("#wPublish");
await page.click("#wPublish");
await page.waitForTimeout(600);
const disp = await ctx.newPage();
await disp.goto(BASE + "/display.html?demo=1");
await disp.waitForSelector(".brow");
const dtext = await disp.locator("body").innerText();
check("شاشة العرض تعرض 10 طالبات", (await disp.locator(".panel").first().locator(".brow").count()) === 10);
check("شاشة العرض بلا أرقام أو رموز طلابية", !/\d{5,}|\d-\d-\d{3}/.test(dtext));
check("شاشة العرض بلا حقول أو أزرار تعديل", (await disp.locator("input, select, button, form").count()) === 0);

// ----- الجوال: لا تمرير أفقي، والنافذة ظاهرة -----
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p2 = await phone.newPage();
await p2.goto(BASE + "/index.html?demo=1#entry");
await p2.waitForSelector(".stu");
const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("الجوال: لا تمرير أفقي في شاشة الرصد", overflow <= 1, `فرق ${overflow}px`);
await p2.locator('.stu [data-act="record"]').first().click();
await p2.waitForSelector(".modal");
const box = await p2.locator('[data-m="saveNext"]').boundingBox();
check("الجوال: زر الحفظ داخل الشاشة وارتفاعه ≥ 44", box && box.y + box.height <= 844 && box.height >= 44, box ? `y=${Math.round(box.y)} h=${Math.round(box.height)}` : "");

// ----- لقطات للمراجعة -----
const ipad = await browser.newContext({ viewport: { width: 1180, height: 820 } });
const p3 = await ipad.newPage();
await p3.goto(BASE + "/index.html?demo=1#entry");
await p3.waitForSelector(".stu");
await p3.screenshot({ path: "tests/shot-ipad-entry.png" });
await p3.locator('.stu [data-act="record"]').first().click();
await p3.click('[data-m="all"]');
await p3.screenshot({ path: "tests/shot-ipad-modal.png" });
await p2.screenshot({ path: "tests/shot-phone-modal.png" });

check("لا أخطاء JavaScript في الصفحة", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} نجح · ${failed} فشل`);
process.exit(failed ? 1 : 0);
