import { StudyRoom } from './study-room';

export { StudyRoom };

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  STUDY_ROOMS: DurableObjectNamespace<StudyRoom>;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      let database = 'unavailable';
      try { await env.DB.prepare('SELECT 1').first(); database = 'connected'; } catch {}
      return json({ app: 'Sara Essam', status: 'ok', database, realtime: 'ready' });
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
