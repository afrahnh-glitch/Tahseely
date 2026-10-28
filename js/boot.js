// يختار المخزن: Firestore عند وجود الإعدادات، وإلا الوضع التجريبي.
import { firebaseConfig } from "./firebase-config.js";

export const FIREBASE_VERSION = "11.10.0";
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

// ?demo=1 في الرابط يفتح الوضع التجريبي ببيانات وهمية (للتدريب والاختبار)، ولا يلمس Firebase.
const forceDemo = typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
export const isConfigured = () => !forceDemo && !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);

let cached = null;
export async function loadFirebase() {
  if (cached) return cached;
  const [appM, authM, fs] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`)
  ]);
  const app = appM.initializeApp(firebaseConfig);
  const auth = authM.getAuth(app);
  // ذاكرة مؤقتة في الذاكرة فقط (الافتراضي): لا تُخزَّن كتابات معلّقة بلا اتصال،
  // فلا يظهر «نجاح» قبل وصول التأكيد من الخادم.
  const db = fs.getFirestore(app);
  cached = { app, auth, authM, db, fs };
  return cached;
}
