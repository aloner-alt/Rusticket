/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unused-vars */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordGateway, deliverInteraction } from '../server/gateway';
import type { DiscordInteraction, Env } from '../src/types';
import type { handleInteraction } from '../src/index';

class FakeSocket extends EventTarget {
  readyState: number = WebSocket.OPEN;
  sent: Array<{ op: number; d: unknown }> = [];
  send(value: string): void { this.sent.push(JSON.parse(value) as { op: number; d: unknown }); }
  close(code = 1000): void {
    this.readyState = WebSocket.CLOSED;
    const event = new Event('close') as CloseEvent;
    Object.defineProperty(event, 'code', { value: code });
    this.dispatchEvent(event);
  }
  packet(value: unknown): void {
    const event = new Event('message') as MessageEvent;
    Object.defineProperty(event, 'data', { value: JSON.stringify(value) });
    this.dispatchEvent(event);
  }
}

afterEach(() => { vi.useRealTimers(); });

describe('Discord Gateway transport', () => {
  it('uses zero intents and resumes after reconnect', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const send = vi.fn(async () => Response.json({ url: 'wss://gateway.discord.test' }));
    const gateway = new DiscordGateway('test-token', async () => undefined, send as typeof fetch, () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
    await gateway.start();
    const first = sockets[0];
    expect(first).toBeDefined();
    first!.packet({ op: 10, d: { heartbeat_interval: 10000 } });
    expect(first!.sent[0]).toMatchObject({ op: 2, d: { intents: 0 } });
    first!.packet({ op: 0, t: 'READY', s: 42, d: { session_id: 'session', resume_gateway_url: 'wss://resume.discord.test' } });
    expect(gateway.isReady()).toBe(true);
    first!.close(4000);
    await vi.advanceTimersByTimeAsync(2000);
    const second = sockets[1];
    expect(second).toBeDefined();
    second!.packet({ op: 10, d: { heartbeat_interval: 10000 } });
    expect(second!.sent[0]).toMatchObject({ op: 6, d: { session_id: 'session', seq: 42 } });
    second!.packet({ op: 0, t: 'RESUMED', s: 43, d: {} });
    expect(gateway.isReady()).toBe(true);
    gateway.stop();
  });

  it('sends an ephemeral error callback when business logic throws', async () => {
    const interaction = { id: '123', token: 'test-token', type: 3 } as DiscordInteraction;
    const route = vi.fn(() => Promise.reject(new Error('private detail')));
    const send = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(null, { status: 204 })));
    await deliverInteraction(interaction, {} as Env, {} as ExecutionContext, route, send as typeof fetch);
    const init = send.mock.calls[0]?.[1] as RequestInit;
    expect(typeof init.body === 'string' ? JSON.parse(init.body) : null).toMatchObject({ type: 4, data: { flags: 64 } });
  });

  it.each([2, 3, 5])('forwards interaction type %i callback unchanged', async type => {
    const interaction = { id: '123', token: 'test-token', type } as DiscordInteraction;
    const payload = JSON.stringify({ type: type === 5 ? 9 : 5, data: { flags: 64 } });
    const route = vi.fn(async () => new Response(payload, { headers: { 'content-type': 'application/json' } }));
    const send = vi.fn(async () => new Response(null, { status: 204 }));
    const env = {} as Env;
    const ctx = {} as ExecutionContext;
    await deliverInteraction(interaction, env, ctx, route as typeof handleInteraction, send as typeof fetch);
    expect(route).toHaveBeenCalledWith(interaction, env, ctx);
    expect(send).toHaveBeenCalledWith('https://discord.com/api/v10/interactions/123/test-token/callback', expect.objectContaining({ method: 'POST', body: payload }));
  });
});
