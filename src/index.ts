import { StudyRoom } from './study-room';
export { StudyRoom };

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  STUDY_ROOMS: DurableObjectNamespace<StudyRoom>;
}

const SESSION_DAYS = 30;
const json = (data: unknown, status = 200, extra: HeadersInit = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
});
const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const fromB64url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function sha256(value: string): Promise<string> { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210000 }, key, 256);
  return `pbkdf2$210000$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, rounds, salt, expected] = stored.split('$');
  if (kind !== 'pbkdf2' || !rounds || !salt || !expected) return false;
  const actual = await hashPassword(password, fromB64url(salt));
  return actual === stored;
}
function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
async function currentUser(request: Request, env: Env) {
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)hh_session=([^;]+)/)?.[1];
  if (!token) return null;
  const tokenHash = await sha256(decodeURIComponent(token));
  return env.DB.prepare(`SELECT u.id, u.email, u.display_name AS displayName FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`)
    .bind(tokenHash, Date.now()).first<{id:string;email:string;displayName:string}>();
}
async function authRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith('/api/auth/') && path !== '/api/state') return null;
  if (path === '/api/auth/register' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as {email?:string;password?:string;displayName?:string}|null;
    const email = String(body?.email || '').trim().toLowerCase();
    const displayName = String(body?.displayName || '').trim().slice(0,60);
    const password = String(body?.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !displayName) return json({error:'أدخل اسمك وبريدًا صحيحًا وكلمة مرور من 8 أحرف على الأقل.'},400);
    const id = crypto.randomUUID();
    try {
      const passwordHash = await hashPassword(password);
      await env.DB.prepare('INSERT INTO users (id,email,display_name,password_hash) VALUES (?,?,?,?)').bind(id,email,displayName,passwordHash).run();
      await env.DB.prepare('INSERT INTO user_state (user_id,state_json) VALUES (?,?)').bind(id,'{}').run();
      return await createSession(env,id,{id,email,displayName});
    } catch (error) {
      const message = String(error);
      if (message.includes('UNIQUE')) return json({error:'البريد الإلكتروني مسجل بالفعل. سجّل الدخول بدلًا من ذلك.'},409);
      return json({error:'تعذر إنشاء الحساب. حاول مرة أخرى.'},500);
    }
  }
  if (path === '/api/auth/login' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as {email?:string;password?:string}|null;
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const user = await env.DB.prepare('SELECT id,email,display_name AS displayName,password_hash AS passwordHash FROM users WHERE email=? LIMIT 1').bind(email).first<{id:string;email:string;displayName:string;passwordHash:string}>();
    if (!user || !(await verifyPassword(password,user.passwordHash))) return json({error:'البريد الإلكتروني أو كلمة المرور غير صحيحة.'},401);
    return createSession(env,user.id,{id:user.id,email:user.email,displayName:user.displayName});
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)hh_session=([^;]+)/)?.[1];
    if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await sha256(decodeURIComponent(token))).run();
    return json({ok:true},200,{ 'set-cookie':cookie('hh_session','',0) });
  }
  if (path === '/api/auth/me' && request.method === 'GET') {
    const user = await currentUser(request,env);
    return user ? json({user}) : json({user:null},401);
  }
  if (path === '/api/state' && (request.method === 'GET' || request.method === 'PUT')) {
    const user = await currentUser(request,env);
    if (!user) return json({error:'يلزم تسجيل الدخول.'},401);
    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT state_json AS state FROM user_state WHERE user_id=?').bind(user.id).first<{state:string}>();
      let state = {}; try { state = row?.state ? JSON.parse(row.state) : {}; } catch {}
      return json({state});
    }
    const body = await request.json().catch(() => null) as {state?:unknown}|null;
    if (!body || !body.state || typeof body.state !== 'object' || Array.isArray(body.state)) return json({error:'بيانات غير صالحة.'},400);
    const serialized = JSON.stringify(body.state);
    if (serialized.length > 1_000_000) return json({error:'حجم البيانات أكبر من المسموح.'},413);
    await env.DB.prepare(`INSERT INTO user_state (user_id,state_json,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json,updated_at=CURRENT_TIMESTAMP`).bind(user.id,serialized).run();
    return json({ok:true,savedAt:Date.now()});
  }
  return json({error:'Method not allowed'},405);
}
async function createSession(env: Env, userId: string, user: {id:string;email:string;displayName:string}) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = Date.now() + SESSION_DAYS * 86400000;
  await env.DB.prepare('INSERT INTO auth_sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),userId,await sha256(token),expiresAt).run();
  return json({user},200,{'set-cookie':cookie('hh_session',token,SESSION_DAYS*86400)});
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/state') {
      try { const response = await authRoute(request,env,url); if (response) return response; }
      catch (error) { console.error('Auth/state API error',error); return json({error:'حدث خطأ داخلي. حاول مرة أخرى.'},500); }
    }
    if (url.pathname === '/api/health') {
      let database = 'unavailable';
      try { await env.DB.prepare('SELECT 1').first(); database = 'connected'; } catch {}
      return json({ app: 'الحلم حقيقة', status: 'ok', database, authentication: 'enabled' });
    }
    if (url.pathname.startsWith('/api/rooms/')) {
      const roomId = url.pathname.split('/')[3];
      if (!roomId || !/^[a-zA-Z0-9_-]{8,80}$/.test(roomId)) return json({ error: 'Invalid room ID' }, 400);
      const id = env.STUDY_ROOMS.idFromName(roomId);
      return env.STUDY_ROOMS.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
