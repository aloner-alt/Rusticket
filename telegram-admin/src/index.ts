import { AdminStore } from './store';
interface Env {
  ADMIN_DB: D1Database;
  APPLICATIONS: AdminStore;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ADMIN_ID: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  SERVER_AGENT_TOKEN: string;
}

type Button = { text: string; callback_data: string };
type TelegramUpdate = {
  message?: { chat: { id: number }; from?: { id: number }; text?: string };
  callback_query?: { id: string; from: { id: number }; message?: { chat: { id: number }; message_id: number }; data?: string };
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const keyboard = (...rows: Button[][]) => ({ inline_keyboard: rows });
const mainMenu = keyboard(
  [{ text: "📊 Статус сервера", callback_data: "server:status" }, { text: "📈 Загрузка", callback_data: "server:load" }],
  [{ text: "🐳 Контейнеры", callback_data: "containers:menu" }]
);
const containersMenu = keyboard(
  [{ text: "🎫 Rusticket", callback_data: "service:rusticket" }],
  [{ text: "🎮 Rust+", callback_data: "service:rustplus" }],
  [{ text: "⬅️ Назад", callback_data: "menu:main" }]
);
const homeText = "🛡 <b>Управление сервером Aloner</b>\n\nВыберите раздел:";
const serviceMenu = (service: string) => keyboard(
  [{ text: "📊 Статус", callback_data: `action:status:${service}` }, { text: "📜 Логи", callback_data: `action:logs:${service}` }],
  [{ text: "🔄 Перезапустить", callback_data: `action:restart:${service}` }],
  [{ text: "⬅️ Контейнеры", callback_data: "containers:menu" }]
);

async function telegram(env: Env, method: string, body: unknown): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Telegram API ${method}: ${response.status}`);
}

async function show(env: Env, chatId: number, text: string, replyMarkup = mainMenu, messageId?: number): Promise<void> {
  const body = { chat_id: chatId, text, parse_mode: "HTML", reply_markup: replyMarkup, disable_web_page_preview: true, ...(messageId ? { message_id: messageId } : {}) };
  await telegram(env, messageId ? "editMessageText" : "sendMessage", body);
}

function authorized(id: number | undefined, env: Env): boolean { return String(id ?? "") === env.TELEGRAM_ADMIN_ID; }
function agentAuthorized(request: Request, env: Env): boolean { return request.headers.get("authorization") === `Bearer ${env.SERVER_AGENT_TOKEN}`; }
function safeService(value: string): "rusticket" | "rustplus" | null { return value === "rusticket" || value === "rustplus" ? value : null; }

async function statusPayload(env: Env): Promise<Record<string, any> | null> {
  return env.APPLICATIONS.get<Record<string, any>>("tgadmin:server-status", "json");
}

const pct = (value: unknown) => `${Number(value ?? 0).toFixed(1)}%`;
function statusText(data: Record<string, any> | null, loadOnly = false): string {
  if (!data) return "⚠️ Агент сервера ещё не подключался.";
  const age = Math.floor((Date.now() - Number(data.updatedAt)) / 1000);
  const freshness = age > 360 ? `⚠️ Данные устарели: ${age} сек.` : `🟢 Агент на связи · ${age} сек. назад`;
  const load = `CPU: <b>${pct(data.cpu)}</b>\nRAM: <b>${pct(data.memory?.percent)}</b> (${data.memory?.used ?? "?"} / ${data.memory?.total ?? "?"})\nДиск: <b>${pct(data.disk?.percent)}</b> (${data.disk?.used ?? "?"} / ${data.disk?.total ?? "?"})\nUptime: <b>${data.uptime ?? "?"}</b>`;
  if (loadOnly) return `📈 <b>Загрузка сервера</b>\n\n${load}\n\n${freshness}`;
  const services = Object.entries(data.services ?? {}).map(([name, item]: [string, any]) => `${item.running ? "🟢" : "🔴"} ${name}: <b>${item.status ?? "unknown"}</b>`).join("\n") || "Контейнеры не найдены";
  return `📊 <b>Статус сервера</b>\n\n${load}\n\n${services}\n\n${freshness}`;
}

async function enqueue(env: Env, chatId: number, service: string, action: string): Promise<void> {
  const id = crypto.randomUUID(); const now = Date.now();
  await env.APPLICATIONS.put(`tgadmin:pending:${String(now).padStart(13, "0")}:${id}`, JSON.stringify({ id, service, action, chatId: String(chatId), createdAt: now }), { expirationTtl: 3600 });
}

async function handleTelegram(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401 });
  const update = await request.json<TelegramUpdate>();
  const ownerId = update.callback_query?.from.id ?? update.message?.from?.id;
  if (!authorized(ownerId, env)) return json({ ok: true });
  if (update.message) {
    await show(env, update.message.chat.id, homeText);
    return json({ ok: true });
  }
  const query = update.callback_query; const message = query?.message; const data = query?.data ?? "";
  if (!query || !message) return json({ ok: true });
  await telegram(env, "answerCallbackQuery", { callback_query_id: query.id });
  if (data === "menu:main") await show(env, message.chat.id, homeText, mainMenu, message.message_id);
  else if (data === "server:status") await show(env, message.chat.id, statusText(await statusPayload(env)), mainMenu, message.message_id);
  else if (data === "server:load") await show(env, message.chat.id, statusText(await statusPayload(env), true), mainMenu, message.message_id);
  else if (data === "containers:menu") await show(env, message.chat.id, "🐳 <b>Контейнеры</b>\n\nВыберите сервис:", containersMenu, message.message_id);
  else if (data.startsWith("service:")) {
    const service = safeService(data.slice(8));
    if (service) await show(env, message.chat.id, `${service === "rusticket" ? "🎫 Rusticket" : "🎮 Rust+"}\n\nВыберите действие:`, serviceMenu(service), message.message_id);
  } else if (data.startsWith("action:restart:")) {
    const service = safeService(data.split(":")[2] ?? "");
    if (service) await show(env, message.chat.id, `⚠️ Перезапустить <b>${service}</b>?`, keyboard([{ text: "✅ Подтвердить", callback_data: `confirm:restart:${service}` }, { text: "❌ Отмена", callback_data: `service:${service}` }]), message.message_id);
  } else if (data.startsWith("confirm:restart:") || data.startsWith("action:logs:") || data.startsWith("action:status:")) {
    const [kind, action, rawService] = data.split(":"); const service = safeService(rawService ?? "");
    if (service) {
      const command = kind === "confirm" ? "restart" : action;
      await enqueue(env, message.chat.id, service, command);
      await show(env, message.chat.id, `⏳ Команда <b>${command}</b> для <b>${service}</b> отправлена серверу. Результат придёт отдельным сообщением.`, serviceMenu(service), message.message_id);
    }
  }
  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    env = { ...env, APPLICATIONS: new AdminStore(env.ADMIN_DB) };
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/telegram") return handleTelegram(request, env);
    if (url.pathname === "/agent/heartbeat" && request.method === "POST") {
      if (!agentAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      const payload = await request.json<Record<string, unknown>>();
      await env.APPLICATIONS.put("tgadmin:server-status", JSON.stringify({ ...payload, updatedAt: Date.now() }));
      return json({ ok: true });
    }
    if (url.pathname === "/agent/poll" && request.method === "GET") {
      if (!agentAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      const page = await env.APPLICATIONS.list({ prefix: "tgadmin:pending:", limit: 1 });
      const key = page.keys[0]?.name;
      if (!key) return json({ command: null });
      const command = await env.APPLICATIONS.get<Record<string, string>>(key, "json");
      if (!command) return json({ command: null });
      await env.APPLICATIONS.put(`tgadmin:running:${command.id}`, JSON.stringify(command), { expirationTtl: 3600 });
      await env.APPLICATIONS.delete(key);
      return json({ command });
    }
    if (url.pathname === "/agent/result" && request.method === "POST") {
      if (!agentAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
      const result = await request.json<{ id: string; ok: boolean; output: string }>();
      const row = await env.APPLICATIONS.get<Record<string, string>>(`tgadmin:running:${result.id}`, "json");
      if (row) {
        const output = result.output.slice(0, 3500).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] ?? c));
        await env.APPLICATIONS.delete(`tgadmin:running:${result.id}`);
        await show(env, Number(row.chatId), `${result.ok ? "✅" : "❌"} <b>${row.service}: ${row.action}</b>\n\n<pre>${output || "Готово"}</pre>`, mainMenu);
      }
      return json({ ok: true });
    }
    return new Response("Rusticket Telegram Admin is running");
  }
} satisfies ExportedHandler<Env>;

