# خطوات تشغيل ونشر «الحلم حقيقة»

## تنبيه حاسم قبل أي نشر
ملف `wrangler.jsonc` يحتوي على `database_id` تجريبي (أصفار). بهذا الشكل لن يتصل Worker بأي قاعدة D1 حقيقية، وبالتالي لن يعمل التسجيل أو الدخول أو حفظ البيانات. يجب استبداله بالمعرّف الذي يرجع من أمر إنشاء قاعدة البيانات أدناه. لا تترك القيمة التجريبية كما هي.

## 1) إنشاء قاعدة البيانات الجديدة

افتح Terminal داخل مجلد المشروع ونفّذ:

```bash
npm install
npx wrangler login
npx wrangler d1 create el-helm-haqeqa-v2-prod
```

انسخ `database_id` الحقيقي الذي يظهر لك، وافتح `wrangler.jsonc` واستبدل قيمة `00000000-0000-0000-0000-000000000000` بالمعرّف الجديد. لا تنشر قبل الاستبدال. هذه قاعدة جديدة مستقلة؛ لا تستخدم معرّف قاعدة أي مشروع قديم.

## 2) فحص وتشغيل محلي

```bash
npm run cf-typegen
npm run typecheck
npm test
npx wrangler d1 migrations apply el-helm-haqeqa-v2-prod --local
npm run dev
```

افتح عنوان localhost الذي يعرضه Wrangler، وأنشئ حساب اختبار.

## 3) نشر قاعدة البيانات والموقع

```bash
npx wrangler d1 migrations apply el-helm-haqeqa-v2-prod --remote
npm run deploy
```

## 4) ربط النشر التلقائي من GitHub

في المستودع: Settings → Secrets and variables → Actions، أضف:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

التوكن يحتاج صلاحيات Workers Scripts: Edit وD1: Edit. بعد ذلك ارفع الملفات إلى فرع `main`.

## 5) اختبار قبول النسخة

1. افتح `/api/health` وتأكد أن HTTP status يساوي 200، وأن `database` تساوي `connected` و`schema` تساوي `ready`. إذا ظهر 503 فاقرأ `diagnostic`؛ لا تختبر التسجيل قبل معالجة السبب.
2. أنشئ حسابًا ببريد جديد.
3. حدّث الصفحة؛ يجب أن تظل الجلسة فعالة.
4. أضف مهمة وعادة وملاحظة وانتظر «تم الحفظ ✓».
5. سجّل الخروج ثم الدخول؛ يجب أن تعود البيانات.
6. أنشئ حسابًا ثانيًا في نفس المتصفح؛ يجب ألا تظهر بيانات الحساب الأول.
