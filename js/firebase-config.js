// ============================================================
//  إعدادات مشروع Firebase الخاص بكِ
// ============================================================
//  ما دامت القيمة null يعمل النظام في «الوضع التجريبي» ببيانات وهمية،
//  ويظهر أعلى كل صفحة شريط يوضّح ذلك. لا شيء يُحفظ في هذا الوضع.
//
//  عند الربط: انسخي كتلة firebaseConfig من
//  Firebase Console ← ⚙️ Project settings ← General ← Your apps ← SDK setup and configuration ← Config
//  واستبدلي null بها (الخطوات كاملة في README.md، القسم 2).
//
//  هذه القيم ليست سرية بحسب تصميم Firebase؛ الحماية في firestore.rules.
//  لا تضعي هنا أبدًا كلمة مرور، ولا محتوى ملف Service account أو Private key.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyCkb21Odm8cvD5t_b-UfvCOTETrLTkw7ao",
  authDomain: "tahseely.firebaseapp.com",
  projectId: "tahseely",
  storageBucket: "tahseely.firebasestorage.app",
  messagingSenderId: "534162019834",
  appId: "1:534162019834:web:22de8cf914ef9327544043"
};

/*  شكل الكتلة فقط — هذه ليست قيمًا حقيقية، لا تنسخيها:
export const firebaseConfig = {
  apiKey: "ضعي-القيمة-من-الكونسول",
  authDomain: "اسم-مشروعك.firebaseapp.com",
  projectId: "اسم-مشروعك",
  storageBucket: "اسم-مشروعك.firebasestorage.app",
  messagingSenderId: "ضعي-القيمة-من-الكونسول",
  appId: "ضعي-القيمة-من-الكونسول"
};
*/
