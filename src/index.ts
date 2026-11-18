import { StudyRoom } from './study-room';
export { StudyRoom };

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  STUDY_ROOMS: DurableObjectNamespace<StudyRoom>;
}

const SESSION_COOKIE = '__Host-hh_session';
const SESSION_DAYS = 30;
// Cloudflare Workers WebCrypto يرفض PBKDF2 بأكتر من 100,000 iteration
const PBKDF2_ITERATIONS = 100_000;
const MAX_STATE_BYTES = 256 * 1024;

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
}
function b64url(bytes: Uint8Array): string {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromB64url(value: string): Uint8Array {
  const s = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function sha256(value: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
async function passwordHashParts(password: string, salt?: Uint8Array): Promise<{ hash: string; salt: string }> {
  const actualSalt = salt || crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: actualSalt, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return { hash: b64url(new Uint8Array(bits)), salt: b64url(actualSalt) };
}
async function verifyPassword(password: string, stored: string, salt?: string | null): Promise<boolean> {
  try {
    // New format: separate salt + hash, matching the working education platform.
    if (salt) {
      const actual = await passwordHashParts(password, fromB64url(salt));
      const a = fromB64url(actual.hash), b = fromB64url(stored);
      if (a.length !== b.length) return false;
      let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
      return diff === 0;
    }
    // Backward compatibility for accounts created by the previous version.
    const [kind, rounds, saltText, expected] = stored.split('$');
    if (kind !== 'pbkdf2' || !saltText || !expected) return false;
    const actual = await passwordHashWithRounds(password, fromB64url(saltText), Number(rounds));
    const a = fromB64url(actual), b = fromB64url(expected);
    if (a.length !== b.length) return false;
    let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch { return false; }
}
async function passwordHashWithRounds(password: string, salt: Uint8Array, rounds: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: Math.min(PBKDF2_ITERATIONS, rounds || PBKDF2_ITERATIONS) }, key, 256);
  return b64url(new Uint8Array(bits));
}
function cookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return null;
}
function setSessionCookie(token: string, maxAge: number) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function clearSessionCookie() { return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
function originAllowed(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // Non-browser clients may omit Origin; browser writes are checked.
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
class BadRequest extends Error {}
async function bodyJson(request: Request): Promise<any> {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_STATE_BYTES + 4096) throw new BadRequest('حجم البيانات أكبر من المسموح');
  try { return await request.json(); } catch { throw new BadRequest('صيغة الطلب غير صحيحة'); }
}
async function currentUser(request: Request, env: Env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || token.length > 200) return null;
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`SELECT u.id, u.email, u.display_name AS displayName, s.id AS sessionId
    FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`).bind(tokenHash, now).first<any>();
  if (!row) return null;
  await env.DB.prepare('UPDATE auth_sessions SET expires_at=? WHERE id=?')
    .bind(now + SESSION_DAYS * 86400, row.sessionId).run();
  delete row.sessionId;
  return row;
}
async function createSession(userId: string, env: Env): Promise<string> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  await env.DB.prepare('INSERT INTO auth_sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)')
    .bind(crypto.randomUUID(), userId, await sha256(token), expires).run();
  return token;
}
async function handleAuth(request: Request, env: Env, path: string): Promise<Response> {
  if (path === '/api/auth/register' && request.method === 'POST') {
    const data = await bodyJson(request);
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');
    const displayName = String(data.displayName || '').trim().slice(0, 80);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return json({ error: 'أدخلي بريدًا إلكترونيًا صحيحًا' }, 400);
    if (password.length < 8 || password.length > 128)
      return json({ error: 'كلمة المرور يجب أن تكون من 8 إلى 128 حرفًا' }, 400);
    if (displayName.length < 2)
      return json({ error: 'اكتبي اسمًا من حرفين على الأقل' }, 400);

    const id = crypto.randomUUID();
    const credentials = await passwordHashParts(password);
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await sha256(token);
    const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;

    try {
      // D1 batch is transactional: account, initial state and session are created together.
      await env.DB.batch([
        env.DB.prepare('INSERT INTO users (id,email,display_name,password_hash,password_salt) VALUES (?,?,?,?,?)')
          .bind(id, email, displayName, credentials.hash, credentials.salt),
        env.DB.prepare("INSERT INTO user_state (user_id,state_json) VALUES (?, '{}')").bind(id),
        env.DB.prepare('INSERT INTO auth_sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)')
          .bind(crypto.randomUUID(), id, tokenHash, expires)
      ]);
    } catch (e: any) {
      const message = String(e?.message || '').toLowerCase();
      if (message.includes('unique'))
        return json({ error: 'هذا البريد مسجل بالفعل، سجّلي الدخول' }, 409);
      console.error('Registration transaction failed:', e);
      return json({ error: 'تعذر إنشاء الحساب حاليًا. تحققي من إعداد قاعدة البيانات ثم حاولي مرة أخرى.' }, 500);
    }

    return json(
      { user: { id, email, displayName } },
      201,
      { 'set-cookie': setSessionCookie(token, SESSION_DAYS * 86400) }
    );
  }

  if (path === '/api/auth/login' && request.method === 'POST') {
    const data = await bodyJson(request);
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');
    if (!email || !password) return json({ error: 'أدخلي البريد الإلكتروني وكلمة المرور' }, 400);

    const user = await env.DB.prepare(
      'SELECT id,email,display_name AS displayName,password_hash,password_salt FROM users WHERE lower(email)=? LIMIT 1'
    ).bind(email).first<any>();

    if (!user || !(await verifyPassword(password, user.password_hash, user.password_salt)))
      return json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' }, 401);

    // Upgrade old-format hashes after a successful login without changing the user's password.
    if (!user.password_salt) {
      const upgraded = await passwordHashParts(password);
      await env.DB.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?')
        .bind(upgraded.hash, upgraded.salt, user.id).run();
    }

    const token = await createSession(user.id, env);
    return json(
      { user: { id: user.id, email: user.email, displayName: user.displayName } },
      200,
      { 'set-cookie': setSessionCookie(token, SESSION_DAYS * 86400) }
    );
  }
  if (path === '/api/auth/me' && request.method === 'GET') {
    const user = await currentUser(request, env);
    return user ? json({ user }) : json({ error: 'غير مسجل الدخول' }, 401);
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !originAllowed(request))
        return json({ error: 'مصدر الطلب غير صالح' }, 403);
      if (url.pathname === '/api/health') {
        let database = 'unavailable';
        let schema = 'unknown';
        try {
          await env.DB.prepare('SELECT 1').first();
          database = 'connected';
          const [users, sessions, state] = await Promise.all([
            env.DB.prepare('PRAGMA table_info(users)').all<any>(),
            env.DB.prepare('PRAGMA table_info(auth_sessions)').all<any>(),
            env.DB.prepare('PRAGMA table_info(user_state)').all<any>()
          ]);
          const has = (result: any, name: string) => (result.results || []).some((column: any) => column.name === name);
          schema = has(users, 'password_salt') && has(sessions, 'token_hash') && has(state, 'state_json')
            ? 'ready' : 'migration_required';
        } catch (error) {
          console.error('Health check failed:', error);
        }
        return json({ app: 'الحلم حقيقة', status: 'ok', database, schema, authentication: 'enabled', realtime: 'ready' });
      }
      if (url.pathname.startsWith('/api/auth/')) return await handleAuth(request, env, url.pathname);
      if (url.pathname === '/api/state' && (request.method === 'GET' || request.method === 'PUT')) {
        const user = await currentUser(request, env);
        if (!user) return json({ error: 'سجّلي الدخول أولًا' }, 401);
        if (request.method === 'GET') {
          const row = await env.DB.prepare('SELECT state_json FROM user_state WHERE user_id=?').bind(user.id).first<any>();
          let state = {};
          try { state = row?.state_json ? JSON.parse(row.state_json) : {}; } catch { state = {}; }
          return json({ state });
        }
        if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json'))
          return json({ error: 'يجب إرسال البيانات بصيغة JSON' }, 415);
        const data = await bodyJson(request);
        if (!data || typeof data.state !== 'object' || Array.isArray(data.state)) return json({ error: 'صيغة البيانات غير صحيحة' }, 400);
        const serialized = JSON.stringify(data.state);
        if (new TextEncoder().encode(serialized).length > MAX_STATE_BYTES) return json({ error: 'حجم البيانات أكبر من 256KB' }, 413);
        await env.DB.prepare(`INSERT INTO user_state (user_id,state_json,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json, updated_at=CURRENT_TIMESTAMP`)
          .bind(user.id, serialized).run();
        return json({ ok: true, updatedAt: new Date().toISOString() });
      }
      if (url.pathname.startsWith('/api/rooms/')) {
        const user = await currentUser(request, env);
        if (!user) return json({ error: 'سجّلي الدخول أولًا' }, 401);
        const roomId = url.pathname.split('/')[3];
        if (!roomId || !/^[a-zA-Z0-9_-]{8,80}$/.test(roomId)) return json({ error: 'Invalid room ID' }, 400);
        const id = env.STUDY_ROOMS.idFromName(roomId);
        return env.STUDY_ROOMS.get(id).fetch(request);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof BadRequest) return json({ error: error.message }, 400);
      console.error('Worker request failed:', error);
      return json({ error: 'حدث خطأ داخلي. حاولي مرة أخرى.' }, 500);
    }
  }
};
