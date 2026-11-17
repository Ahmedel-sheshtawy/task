1) استبدل src/index.ts في الريبو بالملف ده.
2) تأكد إن migrations/0002_auth_sessions.sql فيه جداول: users(id,email,display_name,password_hash) و auth_sessions(id,user_id,token_hash,expires_at) و user_state(user_id,state_json,updated_at).
3) npx wrangler d1 migrations apply el-helm-haqeqa-db --remote
4) npm run deploy
5) لو لسه في مشكلة: npx wrangler tail  وجرّب تسجيل الدخول وابعتلي الخطأ.
