import type { DiscordInteraction, Env } from '../src/types';
import { handleInteraction } from '../src/index';
import { messages } from '../src/config/messages';

type Packet = { op: number; t?: string | null; s?: number | null; d: unknown };
type Socket = WebSocket;
const api = 'https://discord.com/api/v10';
const fatalCodes = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

export async function deliverInteraction(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContext,
  route: typeof handleInteraction = handleInteraction,
  send: typeof fetch = fetch
): Promise<void> {
  let response: Response;
  try {
    response = await route(interaction, env, ctx);
    if (!response.ok) throw new Error(`Interaction handler returned HTTP ${response.status}`);
  } catch {
    console.error('Interaction handler failed');
    response = Response.json({ type: 4, data: { content: messages.genericError, flags: 64 } });
  }
  const payload = await response.text();
  const callback = await send(`${api}/interactions/${encodeURIComponent(interaction.id)}/${encodeURIComponent(interaction.token)}/callback`, {
    method: 'POST',
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
    body: payload,
    signal: AbortSignal.timeout(8_000)
  });
  if (!callback.ok) throw new Error(`Discord callback returned HTTP ${callback.status}`);
}

export class DiscordGateway {
  private socket?: Socket;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private firstHeartbeat: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private sequence: number | null = null;
  private sessionId: string | undefined;
  private resumeUrl: string | undefined;
  private gatewayUrl?: string;
  private awaitingAck = false;
  private stopped = false;
  private attempt = 0;
  private ready = false;

  constructor(
    private readonly token: string,
    private readonly onInteraction: (interaction: DiscordInteraction) => Promise<void>,
    private readonly send: typeof fetch = fetch,
    private readonly makeSocket: (url: string) => Socket = url => new WebSocket(url)
  ) {}

  isReady(): boolean { return this.ready; }

  async start(): Promise<void> {
    if (!this.token) throw new Error('DISCORD_BOT_TOKEN is missing');
    const response = await this.send(`${api}/gateway/bot`, {
      headers: { authorization: `Bot ${this.token}` },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) throw new Error(`Discord gateway discovery returned HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('url' in data) || typeof data.url !== 'string' || !data.url.startsWith('wss://')) throw new Error('Discord gateway URL is invalid');
    this.gatewayUrl = data.url;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ready = false;
    this.clearTimers();
    this.socket?.close(1000, 'shutdown');
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.firstHeartbeat) clearTimeout(this.firstHeartbeat);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeat = undefined;
    this.firstHeartbeat = undefined;
    this.reconnectTimer = undefined;
  }

  private connect(): void {
    if (this.stopped) return;
    const base = this.sessionId && this.resumeUrl ? this.resumeUrl : this.gatewayUrl;
    if (!base) return;
    const url = new URL(base);
    url.searchParams.set('v', '10');
    url.searchParams.set('encoding', 'json');
    const socket = this.makeSocket(url.toString());
    this.socket = socket;
    socket.addEventListener('message', event => {
      try { this.onPacket(JSON.parse(String(event.data)) as Packet, socket); }
      catch { console.error('Discord gateway packet could not be processed'); }
    });
    socket.addEventListener('close', event => {
      if (this.socket !== socket) return;
      this.ready = false;
      this.clearTimers();
      if (fatalCodes.has(event.code)) {
        console.error(`Discord gateway fatal close code ${event.code}`);
        process.exit(1);
        this.stopped = true;
        return;
      }
      if (event.code === 4007 || event.code === 4009) this.clearSession();
      this.reconnect();
    });
    socket.addEventListener('error', () => { socket.close(); });
  }

  private clearSession(): void {
    this.sessionId = undefined;
    this.resumeUrl = undefined;
    this.sequence = null;
  }

  private reconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.attempt++, 5)) + Math.floor(Math.random() * 500);
    this.reconnectTimer = setTimeout(() => { this.connect(); }, delay);
  }

  private sendPacket(socket: Socket, op: number, d: unknown): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op, d }));
  }

  private beat(socket: Socket): void {
    if (this.awaitingAck) { socket.close(4000, 'heartbeat timeout'); return; }
    this.awaitingAck = true;
    this.sendPacket(socket, 1, this.sequence);
  }

  private onPacket(packet: Packet, socket: Socket): void {
    if (this.socket !== socket || this.stopped) return;
    if (typeof packet.s === 'number') this.sequence = packet.s;
    switch (packet.op) {
      case 10: {
        const hello = packet.d as { heartbeat_interval: number };
        const interval = hello.heartbeat_interval;
        if (!Number.isFinite(interval) || interval <= 0) { socket.close(); return; }
        this.awaitingAck = false;
        this.firstHeartbeat = setTimeout(() => {
          this.beat(socket);
          this.heartbeat = setInterval(() => { this.beat(socket); }, interval);
        }, Math.floor(Math.random() * interval));
        if (this.sessionId && this.sequence !== null) {
          this.sendPacket(socket, 6, { token: this.token, session_id: this.sessionId, seq: this.sequence });
        } else {
          this.sendPacket(socket, 2, {
            token: this.token, intents: 0,
            properties: { os: 'linux', browser: 'rusticket', device: 'rusticket' }
          });
        }
        break;
      }
      case 11: this.awaitingAck = false; break;
      case 1: this.awaitingAck = false; this.beat(socket); break;
      case 7: socket.close(4000, 'reconnect requested'); break;
      case 9:
        if (packet.d !== true) this.clearSession();
        socket.close(4000, 'invalid session');
        break;
      case 0:
        if (packet.t === 'READY') {
          const data = packet.d as { session_id: string; resume_gateway_url: string };
          this.sessionId = data.session_id;
          this.resumeUrl = data.resume_gateway_url;
          this.ready = true;
          this.attempt = 0;
          console.log('Discord gateway ready');
        } else if (packet.t === 'RESUMED') {
          this.ready = true;
          this.attempt = 0;
          console.log('Discord gateway resumed');
        } else if (packet.t === 'INTERACTION_CREATE') {
          void this.onInteraction(packet.d as DiscordInteraction).catch((error: unknown) => {
            console.error('Interaction delivery failed:', error instanceof Error ? error.message.replace(/\/interactions\/[^/]+\/[^/]+/g, '/interactions/[redacted]') : 'unknown');
          });
        }
        break;
    }
  }
}
