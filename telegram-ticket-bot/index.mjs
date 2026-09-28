const token = required("TELEGRAM_TICKET_BOT_TOKEN");
const apiToken = required("TELEGRAM_TICKET_API_TOKEN");
const apiUrl = process.env.RUSTICKET_INTERNAL_URL || "http://rusticket:3000";
const owners = ids("TELEGRAM_TICKET_OWNER_IDS");
const recruiters = ids("TELEGRAM_TICKET_RECRUITER_IDS");
if (!owners.size) throw new Error("TELEGRAM_TICKET_OWNER_IDS is empty");

const states = new Map();
let offset = 0;
const tg = (method, value = {}) => fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }).then(async response => {
  const result = await response.json(); if (!result.ok) throw new Error(`Telegram ${method}: ${result.description}`); return result.result;
});
const internal = (path, options = {}) => fetch(`${apiUrl}${path}`, { ...options, headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json", ...(options.headers || {}) } }).then(async response => {
  const result = await response.json(); if (!response.ok) throw new Error(result.error || `API ${response.status}`); return result;
});

function required(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function ids(name) { return new Set((process.env[name] || "").split(",").map(x => x.trim()).filter(x => /^\d+$/.test(x))); }
function role(id) { const value = String(id); return owners.has(value) ? "owner" : recruiters.has(value) ? "recruiter" : "user"; }
function keyboard(id) {
  const rows = [[{ text: "🎫 Подать тикет", callback_data: "new" }]];
  if (role(id) !== "user") rows.push([{ text: "📥 Открытые тикеты", callback_data: "list" }]);
  if (role(id) === "owner") rows.push([{ text: "⚠️ Выдать варн", callback_data: "warn" }]);
  return { inline_keyboard: rows };
}
function ticketButtons(ticket, id) {
  if (ticket.status !== "PENDING") return undefined;
  const buttons = [{ text: "✅ Принять", callback_data: `accept:${ticket.id}` }];
  if (role(id) === "owner") buttons.push({ text: "❌ Отклонить", callback_data: `reject:${ticket.id}` });
  return { inline_keyboard: [buttons] };
}
async function send(chatId, text, reply_markup) { return tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...(reply_markup ? { reply_markup } : {}) }); }
const esc = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
async function home(chatId, userId) { await send(chatId, `🛡 <b>Rusticket</b>\n\nВаша роль: <b>${role(userId) === "owner" ? "руководитель" : role(userId) === "recruiter" ? "рекрутёр" : "пользователь"}</b>`, keyboard(userId)); }

async function showTickets(chatId, userId) {
  if (role(userId) === "user") return home(chatId, userId);
  const { tickets } = await internal("/internal/telegram-tickets?status=PENDING", { headers: { "x-telegram-actor-id": String(userId) } });
  if (!tickets.length) return send(chatId, "Открытых тикетов сейчас нет.", keyboard(userId));
  for (const ticket of tickets.slice(0, 20)) {
    await send(chatId, `🎫 <b>Тикет из Telegram</b>\nПользователь: @${esc(ticket.telegramUsername)} (<code>${ticket.telegramUserId}</code>)\nDiscord: ${ticket.discordUserId ? `<code>${ticket.discordUserId}</code>` : "не указан"}\n\n${esc(ticket.description)}`, ticketButtons(ticket, userId));
  }
}

async function callback(query) {
  const id = String(query.from.id); const chatId = query.message?.chat.id; if (!chatId) return;
  await tg("answerCallbackQuery", { callback_query_id: query.id });
  if (query.data === "new") { states.set(id, { step: "ticket-discord" }); return send(chatId, "Укажите ваш Discord ID (17–20 цифр). Если Discord нет — отправьте <code>-</code>."); }
  if (query.data === "list") return showTickets(chatId, id);
  if (query.data === "warn" && role(id) === "owner") { states.set(id, { step: "warn-discord" }); return send(chatId, "Отправьте Discord ID участника, которому нужно выдать варн."); }
  const action = /^(accept|reject):([0-9a-f-]+)$/.exec(query.data || "");
  if (!action || role(id) === "user" || (action[1] === "reject" && role(id) !== "owner")) return;
  if (action[1] === "reject") { states.set(id, { step: "reject-reason", ticketId: action[2] }); return send(chatId, "Напишите причину отклонения."); }
  await internal(`/internal/telegram-tickets/${action[2]}/accept`, { method: "POST", body: JSON.stringify({ actorTelegramId: id }) });
  await send(chatId, "✅ Тикет принят.", keyboard(id));
}

async function message(message) {
  const id = String(message.from.id); const chatId = message.chat.id; const text = message.text?.trim(); if (!text) return;
  if (text === "/start" || text === "/menu" || text === "/cancel") { states.delete(id); return home(chatId, id); }
  const state = states.get(id); if (!state) return home(chatId, id);
  if (state.step === "ticket-discord") {
    if (text !== "-" && !/^\d{17,20}$/.test(text)) return send(chatId, "Некорректный Discord ID. Отправьте 17–20 цифр либо <code>-</code>.");
    states.set(id, { step: "ticket-description", discordUserId: text === "-" ? "" : text }); return send(chatId, "Опишите обращение одним сообщением (минимум 5 символов).");
  }
  if (state.step === "ticket-description") {
    if (text.length < 5 || text.length > 3000) return send(chatId, "Описание должно содержать от 5 до 3000 символов.");
    const result = await internal("/internal/telegram-tickets", { method: "POST", body: JSON.stringify({ telegramUserId: id, telegramUsername: message.from.username || message.from.first_name || "unknown", discordUserId: state.discordUserId, description: text }) });
    states.delete(id); return send(chatId, `✅ Тикет создан. Номер: <code>${result.ticket.id}</code>`, keyboard(id));
  }
  if (state.step === "warn-discord" && role(id) === "owner") {
    if (!/^\d{17,20}$/.test(text)) return send(chatId, "Некорректный Discord ID.");
    states.set(id, { step: "warn-reason", discordUserId: text }); return send(chatId, "Напишите причину варна.");
  }
  if (state.step === "warn-reason" && role(id) === "owner") {
    if (text.length < 2 || text.length > 1000) return send(chatId, "Причина должна содержать от 2 до 1000 символов.");
    const result = await internal("/internal/telegram-tickets/warn", { method: "POST", body: JSON.stringify({ actorTelegramId: id, discordUserId: state.discordUserId, reason: text }) });
    states.delete(id); return send(chatId, `✅ Выдан Warn ${result.warning.level}. Канал Discord: <code>${result.warning.channelId}</code>`, keyboard(id));
  }
  if (state.step === "reject-reason" && role(id) === "owner") {
    await internal(`/internal/telegram-tickets/${state.ticketId}/reject`, { method: "POST", body: JSON.stringify({ actorTelegramId: id, reason: text }) });
    states.delete(id); return send(chatId, "❌ Тикет отклонён.", keyboard(id));
  }
  states.delete(id); return home(chatId, id);
}

async function run() {
  await tg("deleteWebhook", { drop_pending_updates: false });
  console.log("Telegram ticket bot polling started");
  while (true) {
    try {
      const updates = await tg("getUpdates", { offset, timeout: 45, allowed_updates: ["message", "callback_query"] });
      for (const update of updates) {
        offset = update.update_id + 1;
        try { if (update.callback_query) await callback(update.callback_query); else if (update.message) await message(update.message); }
        catch (error) { console.error("Update failed:", error.message); const chatId = update.message?.chat.id || update.callback_query?.message?.chat.id; if (chatId) await send(chatId, "⚠️ Не удалось выполнить действие. Попробуйте ещё раз."); }
      }
    } catch (error) { console.error("Polling failed:", error.message); await new Promise(resolve => setTimeout(resolve, 3000)); }
  }
}
run().catch(error => { console.error(error); process.exit(1); });
