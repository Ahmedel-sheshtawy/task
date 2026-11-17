interface RoomState { roomId: string; startedAt: number | null; durationMinutes: number; phase: 'waiting'|'focus'|'break'|'finished'; participants: Map<WebSocket, { id: string; name: string; role: 'host'|'member'|'observer'; joinedAt: number }>; }

export class StudyRoom {
  private state: DurableObjectState;
  private room: RoomState;
  constructor(state: DurableObjectState) {
    this.state = state;
    this.room = { roomId: '', startedAt: null, durationMinutes: 25, phase: 'waiting', participants: new Map() };
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.room.roomId = url.pathname.split('/')[3] || this.room.roomId;
    if (request.headers.get('Upgrade') !== 'websocket') {
      if (request.method === 'GET' && url.pathname.endsWith('/status')) return Response.json(this.snapshot());
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const role = url.searchParams.get('role') === 'observer' ? 'observer' : 'member';
    const name = (url.searchParams.get('name') || 'طالب').slice(0, 40);
    const id = crypto.randomUUID();
    server.accept();
    this.room.participants.set(server, { id, name, role, joinedAt: Date.now() });
    server.addEventListener('message', event => this.onMessage(server, event.data));
    server.addEventListener('close', () => { this.room.participants.delete(server); this.broadcast({ type: 'presence', data: this.snapshot() }); });
    server.send(JSON.stringify({ type: 'welcome', participantId: id, data: this.snapshot() }));
    this.broadcast({ type: 'presence', data: this.snapshot() });
    return new Response(null, { status: 101, webSocket: client });
  }
  private onMessage(socket: WebSocket, raw: MessageEvent['data']) {
    try {
      const message = JSON.parse(String(raw));
      const participant = this.room.participants.get(socket);
      if (!participant) return;
      if (message.type === 'start' && participant.role !== 'observer') {
        this.room.startedAt = Date.now();
        this.room.durationMinutes = Math.max(1, Math.min(240, Number(message.durationMinutes) || 25));
        this.room.phase = 'focus';
      } else if (message.type === 'phase' && participant.role !== 'observer' && ['focus','break','finished','waiting'].includes(message.phase)) {
        this.room.phase = message.phase;
      } else if (message.type === 'chat') {
        const text = String(message.text || '').trim().slice(0, 500);
        if (text) this.broadcast({ type: 'chat', data: { name: participant.name, text, at: Date.now() } });
        return;
      }
      this.broadcast({ type: 'room', data: this.snapshot() });
    } catch { socket.send(JSON.stringify({ type: 'error', message: 'Invalid message' })); }
  }
  private snapshot() {
    return { roomId: this.room.roomId, startedAt: this.room.startedAt, durationMinutes: this.room.durationMinutes, phase: this.room.phase,
      participants: [...this.room.participants.values()].map(p => ({ id: p.id, name: p.name, role: p.role, joinedAt: p.joinedAt })) };
  }
  private broadcast(data: unknown) {
    const payload = JSON.stringify(data);
    for (const socket of this.room.participants.keys()) { try { socket.send(payload); } catch { this.room.participants.delete(socket); } }
  }
}
