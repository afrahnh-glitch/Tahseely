// يختار المخزن: Firestore عند وجود الإعدادات، وإلا الوضع التجريبي.
// مكتبات Firebase تُحمَّل على أجزاء: صفحة الدخول تحتاج app + auth فقط،
// وقاعدة البيانات (أكبر ملف) تُنزَّل بالتوازي ولا تؤخر ظهور صفحة الدخول.
import { firebaseConfig } from "./firebase-config.js";

// ⚠️ إن غيّرتِ الإصدار فغيّريه أيضًا في روابط modulepreload داخل index.html وdisplay.html
export const FIREBASE_VERSION = "11.10.0";
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

// ?demo=1 في الرابط يفتح الوضع التجريبي ببيانات وهمية (للتدريب والاختبار)، ولا يلمس Firebase.
const forceDemo = typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
export const isConfigured = () => !forceDemo && !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);

let appP = null, authP = null, fsP = null, liteP = null;

function getApp() {
  return (appP ||= import(`${CDN}/firebase-app.js`).then((m) => m.initializeApp(firebaseConfig)));
}

/** التطبيق + تسجيل الدخول (لصفحة الدخول ومعرفة المستخدمة الحالية). */
export function loadAuth() {
  return (authP ||= Promise.all([getApp(), import(`${CDN}/firebase-auth.js`)])
    .then(([app, authM]) => ({
      authM,
      // initializeAuth بدل getAuth: نستخدم البريد وكلمة المرور فقط، فلا حاجة لمكوّن النوافذ المنبثقة
      // الذي يحمّل إطارًا إضافيًا من خوادم Google عند كل فتح على Safari والآيباد قبل معرفة حالة الدخول.
      auth: authM.initializeAuth(app, { persistence: [authM.indexedDBLocalPersistence, authM.browserLocalPersistence] })
    })));
}

/** قاعدة البيانات الكاملة (رصد، معاملات، استماع لحظي). */
export function loadFirestore() {
  // ذاكرة مؤقتة في الذاكرة فقط (الافتراضي): لا تُخزَّن كتابات معلّقة بلا اتصال،
  // فلا يظهر «نجاح» قبل وصول التأكيد من الخادم.
  return (fsP ||= Promise.all([getApp(), import(`${CDN}/firebase-firestore.js`)])
    .then(([app, fs]) => ({ fs, db: fs.getFirestore(app) })));
}

/** نسخة خفيفة للقراءة فقط (شاشة العرض)، مع رجوع للنسخة الكاملة إن تعذّر تحميلها. */
export function loadFirestoreLite() {
  return (liteP ||= Promise.all([getApp(), import(`${CDN}/firebase-firestore-lite.js`)])
    .then(([app, fs]) => ({ fs, db: fs.getFirestore(app) }))
    .catch(() => loadFirestore()));
}

/** للتوافق: كل شيء معًا. */
export async function loadFirebase() {
  const [a, f] = await Promise.all([loadAuth(), loadFirestore()]);
  return { ...a, ...f };
}

/* ---------- دعوة المعلمات (للمديرة) ----------
 * لا خادم ولا مفاتيح سرية: ننشئ حساب المعلمة من نسخة ثانية مؤقتة من التطبيق
 * (حتى لا تُسجَّل المديرة خروجًا)، بكلمة مرور عشوائية لا يعرفها أحد،
 * ثم يُرسل Firebase إلى بريد المعلمة رابطًا لتعيين كلمة مرورها بنفسها.
 */
function randomPassword() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%"[b % 61]).join("");
}

/** ينشئ حساب دخول جديد ويعيد رمزه (UID). */
export async function createLoginAccount(email) {
  const [appM, authM] = await Promise.all([import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`)]);
  const second = appM.initializeApp(firebaseConfig, "invite-" + Date.now());
  try {
    const auth2 = authM.initializeAuth(second, { persistence: authM.inMemoryPersistence });
    const cred = await authM.createUserWithEmailAndPassword(auth2, email, randomPassword());
    await authM.signOut(auth2);
    return cred.user.uid;
  } finally {
    appM.deleteApp(second).catch(() => {});
  }
}

/** يرسل إلى البريد رسالة بالعربية فيها رابط تعيين كلمة المرور، ثم الرجوع إلى النظام. */
export async function sendLoginEmail(email) {
  const { auth, authM } = await loadAuth();
  auth.languageCode = "ar";
  const back = location.origin + location.pathname.replace(/[^/]*$/, "");
  try {
    await authM.sendPasswordResetEmail(auth, email, { url: back });
  } catch (e) {
    // إن لم يكن نطاق الموقع ضمن Authorized domains نرسل الرسالة بلا زر الرجوع
    if (/continue-uri|unauthorized-domain/.test(e.code || "")) await authM.sendPasswordResetEmail(auth, email);
    else throw e;
  }
}
