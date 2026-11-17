الحلم حقيقة — Backend Authentication & Persistence patch

المراجعة تمت على ملفات GitHub الحالية بتاريخ 2026-11-17.

1) استبدل src/index.ts في Repository task بالملف الموجود هنا.
2) تأكد أن migrations/0002_auth_sessions.sql موجود كما هو في المستودع الحالي. لا تنشئ جدولًا مكررًا.
3) في Cloudflare Workers > Settings > Builds، تأكد أن Root directory فارغ (جذر المستودع) وأن Deploy command هو npm run deploy.
4) طبّق migrations على قاعدة D1 الحالية مرة واحدة:
   npx wrangler d1 migrations apply el-helm-haqeqa-db --remote
5) انشر:
   npm run deploy
6) اختبر:
   GET /api/health
   POST /api/auth/register {"displayName":"Test User","email":"you@example.com","password":"atleast8chars"}
   ثم GET /api/auth/me
   ثم PUT /api/state و GET /api/state.

مهم: الملف يطابق أسماء الـ API المستخدمة بالفعل في public/index.html:
/api/auth/register, /api/auth/login, /api/auth/logout, /api/auth/me, /api/state.
لا تحذف قاعدة D1 ولا تعِد إنشاءها. إذا كانت Migration 0002 قد طُبقت بالفعل، Wrangler لن يعيد تطبيقها.
