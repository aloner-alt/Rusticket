import { ROLE_REQUIREMENTS } from "../config/requirements";
import type { ApplicationRecord, DiscordEmbed, StaffApplicationRecord } from "../types";

export const CustomId = {
  Open: "application:open",
  Role: "application:role",
  FormPrefix: "application:form:",
  SteamStepPrefix: "application:steam-step:",
  SteamFormPrefix: "application:steam-form:",
  Accept: "application:accept",
  Reject: "application:reject",
  RejectModal: "application:reject-modal",
  Close: "application:close",
  CloseConfirm: "application:close-confirm",
  CloseCancel: "application:close-cancel"
  , InviteVoice: "application:invite-voice"
} as const;

export function recruitmentPanel(open = true, telegramBotUrl?: string): { embeds: DiscordEmbed[]; components: unknown[] } {
  const telegramUrl = telegramBotUrl && /^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}$/.test(telegramBotUrl) ? telegramBotUrl : undefined;
  return {
    embeds: [{
      title: open ? "🔥 Клан .int открывает набор" : "🔒 Набор в клан .int закрыт",
      description: open
        ? `Ищем активных игроков на долгую игру. Выберите **одно** направление и заполните анкету кнопкой ниже.\n\n${telegramUrl ? "📱 **Подать заявку также можно через Telegram** — используйте отдельную кнопку ниже.\n\n" : ""}**Для всех:** возраст 15+, онлайн от 6 часов в день (ориентир — 6–8), адекватность, дисциплина, выполнение коллов и игра на результат.`
        : "Сейчас заявки не принимаются. Ниже — требования на следующий набор.",
      color: open ? 0x2ecc71 : 0xe74c3c,
      fields: [
        { name: "🔫 Main / Combat — 3500+ ч.", value: "Хороший PvP: FC 40+ киллов **или** FFA 35+ киллов. Командная игра, коллы и быстрые решения." },
        { name: "⚙️ Industrial — 2000+ ч.", value: "Сортировки ресурсов, конвейеры, дроны, поезда, автоматизация, электричество и промышленность базы." },
        { name: "🛠️ Support Builder — 2000+ ч.", value: "Внешние ТК, фобы, рейд-базы, укрепления; быстрое строительство и ремонт основной базы." },
        { name: "🚁 Transport Pilot — 1500+ ч.", value: "Уверенное пилотирование коптера и Apache, перевозка команды и лута, воздушная поддержка." },
        { name: "🌿 Farmer — 2000+ ч.", value: "Выведение генов; электричество, вода, освещение и автоматизация фермы." },
        { name: "⚡ Electric — 2000+ ч.", value: "Электрика и техническая инфраструктура базы." },
        { name: "🎮 Пример ссылки на Steam-профиль", value: "https://steamcommunity.com/profiles/76561199403575804/\nУкажите **свой**, а не этот пример. PvP и профильные навыки оценивает рекрутёр." }
      ]
    }],
    components: [{ type: 1, components: [
      { type: 2, style: open ? 3 : 2, label: open ? "Подать заявку в Discord" : "Набор закрыт", emoji: { name: open ? "📝" : "🔒" }, custom_id: CustomId.Open, disabled: !open },
      ...(telegramUrl ? [{ type: 2, style: 5, label: "Подать через Telegram", emoji: { name: "📱" }, url: telegramUrl, disabled: !open }] : [])
    ] }]
  };
}

export function roleSelector(): unknown[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: CustomId.Role,
      placeholder: "Выберите направление",
      min_values: 1,
      max_values: 1,
      options: Object.entries(ROLE_REQUIREMENTS).map(([value, role]) => ({
        label: role.label,
        value,
        description: role.description,
        emoji: { name: role.emoji }
      }))
    }]
  }];
}

export function criteriaRoleSelector(action: "set" | "remove" = "set"): unknown[] {
  return [{ type: 1, components: [{
    type: 3,
    custom_id: `ticket:criteria-role:${action}`,
    placeholder: action === "set" ? "Для какой роли добавить критерий?" : "У какой роли убрать критерий?",
    min_values: 1,
    max_values: 1,
    options: Object.entries(ROLE_REQUIREMENTS).map(([value, role]) => ({
      label: role.label,
      value,
      description: `Дополнительный обязательный вопрос для ${role.label}`,
      emoji: { name: role.emoji }
    }))
  }] }];
}

export function applicationModal(role: string, additionalQuestion?: string): unknown {
  return {
    title: "Заявка в .int",
    custom_id: `${CustomId.FormPrefix}${role}`,
    components: [
      { type: 1, components: [{ type: 4, custom_id: "age", label: "Возраст", style: 1, placeholder: "Например: 18", required: true, min_length: 2, max_length: 2 }] },
      { type: 1, components: [{ type: 4, custom_id: "daily_online", label: "Средний онлайн в сутки", style: 1, placeholder: "Например: 6", required: true, max_length: 2 }] },
      { type: 1, components: [{ type: 4, custom_id: "real_name", label: "Ваше имя", style: 1, placeholder: "Например: Богдан", required: true, min_length: 2, max_length: 32 }] },
      { type: 1, components: [{ type: 4, custom_id: "comment", label: "Комментарий для рекрутёра", style: 2, placeholder: "Расскажите о себе или укажите важные детали", required: false, max_length: 1000 }] },
      ...(additionalQuestion ? [{ type: 1, components: [{ type: 4, custom_id: "additional_answer", label: additionalQuestion, style: 2, required: true, max_length: 500 }] }] : [])
    ]
  };
}

export function staffRecruitmentPanel(open: boolean): { embeds: DiscordEmbed[]; components: unknown[] } {
  return {
    embeds: [{
      title: open ? "🛡️ Набор в Discord Staff .int" : "🔒 Набор в Discord Staff закрыт",
      description: open
        ? "Ищем спокойных и ответственных людей для работы с участниками и тикетами. Анкета состоит из **3 коротких шагов**."
        : "Заявки в Discord Staff сейчас не принимаются.",
      color: open ? 0x5865f2 : 0xe74c3c,
      fields: [{
        name: "Критерии Staff",
        value: "• адекватность и грамотное общение\n• регулярная активность и участие в собраниях\n• знание правил Discord и клана\n• умение спокойно решать конфликты\n• честность, субординация и отсутствие поблажек друзьям"
      }]
    }],
    components: [{ type: 1, components: [{
      type: 2, style: open ? 1 : 2, label: open ? "Подать заявку на Staff" : "Набор Staff закрыт",
      emoji: { name: open ? "🛡️" : "🔒" }, custom_id: "staff-application:open", disabled: !open
    }] }]
  };
}

const staffFields: Array<{ id: keyof Omit<StaffApplicationRecord, "applicantId" | "applicantUsername" | "ticketChannelId" | "cardMessageId" | "status" | "createdAt" | "decidedAt" | "staffId" | "rejectionReason">; label: string; placeholder: string; style?: number }> = [
  { id: "realName", label: "1. Как тебя зовут?", placeholder: "Имя" },
  { id: "age", label: "2. Сколько тебе лет?", placeholder: "Возраст" },
  { id: "timezone", label: "3. Твой часовой пояс", placeholder: "Например: МСК (UTC+3)" },
  { id: "dailyAvailability", label: "4. Сколько часов в день уделишь?", placeholder: "Например: 4–6 часов" },
  { id: "contactHours", label: "5. Когда обычно находишься на связи?", placeholder: "Например: 17:00–01:00 МСК" },
  { id: "meetings", label: "6. Готов регулярно быть на собраниях?", placeholder: "Да/нет и возможные ограничения", style: 2 },
  { id: "adminExperience", label: "7. Опыт администрации", placeholder: "Где работал, должность, обязанности и почему ушёл", style: 2 },
  { id: "conflictAndRules", label: "8. Конфликты и знание правил", placeholder: "Как решаешь конфликты и насколько знаешь правила", style: 2 },
  { id: "situations", label: "9. Как поступишь при нарушении?", placeholder: "Участник оскорбляет; нарушил друг; Staff злоупотребляет", style: 2 },
  { id: "motivation", label: "10. Мотивация и польза для .int", placeholder: "Почему Staff, чем полезен, сильные стороны и субординация", style: 2 }
];

export function staffApplicationModal(step: 1 | 2 | 3, draftId = "new"): unknown {
  const fields = staffFields.slice((step - 1) * 4, step * 4);
  return {
    title: `Заявка на Staff — ${step}/3`,
    custom_id: `staff-application:form:${step}:${draftId}`,
    components: fields.map(field => ({ type: 1, components: [{
      type: 4, custom_id: field.id, label: field.label, style: field.style ?? 1,
      placeholder: field.placeholder, required: true, min_length: 1, max_length: field.style === 2 ? 1000 : 200
    }] }))
  };
}

export function staffApplicationNextButton(step: 2 | 3, draftId: string): unknown[] {
  return [{ type: 1, components: [{ type: 2, style: 1, label: `Продолжить — шаг ${step}/3`, custom_id: `staff-application:step:${step}:${draftId}` }] }];
}

export function staffApplicationButtons(disabled = false): unknown[] {
  return [{ type: 1, components: [
    { type: 2, style: 3, label: "Принять в Staff", custom_id: "staff-review:accept", disabled },
    { type: 2, style: 4, label: "Отклонить", custom_id: "staff-review:reject", disabled },
    { type: 2, style: 2, label: "Закрыть", custom_id: "staff-review:close" }
  ] }];
}

export function staffApplicationEmbed(app: StaffApplicationRecord): DiscordEmbed {
  const decision = app.status === "PENDING" ? "🟡 Ожидает решения"
    : app.status === "ACCEPTED" ? `✅ Принят · <@${app.staffId}>`
    : `❌ Отклонён · <@${app.staffId}>\nПричина: ${app.rejectionReason ?? "не указана"}`;
  return {
    title: "🛡️ Заявка на Discord Staff",
    color: app.status === "PENDING" ? 0x5865f2 : app.status === "ACCEPTED" ? 0x2ecc71 : 0xe74c3c,
    fields: [
      { name: "Кандидат", value: `<@${app.applicantId}> (\`${app.applicantId}\`)` },
      { name: "👤 Личная информация", value: `**Имя:** ${app.realName}\n**Возраст:** ${app.age}\n**Часовой пояс:** ${app.timezone}` },
      { name: "⏰ Активность", value: `**В день:** ${app.dailyAvailability}\n**На связи:** ${app.contactHours}\n**Собрания:** ${app.meetings}` },
      { name: "🛡️ Опыт и навыки", value: `**Опыт:** ${app.adminExperience}\n**Конфликты и правила:** ${app.conflictAndRules}`.slice(0, 1024) },
      { name: "💬 Ситуационные вопросы", value: app.situations.slice(0, 1024) },
      { name: "⭐ Мотивация", value: app.motivation.slice(0, 1024) },
      { name: "Критерии Discord Staff", value: "Адекватность · активность · знание правил · решение конфликтов · честность · субординация" },
      { name: "Статус", value: decision }
    ],
    timestamp: app.createdAt
  };
}

export function steamStepButton(draftId: string): unknown[] {
  return [{ type: 1, components: [{
    type: 2,
    style: 1,
    label: "Указать Steam-аккаунты",
    emoji: { name: "🎮" },
    custom_id: `${CustomId.SteamStepPrefix}${draftId}`
  }] }];
}

export function steamAccountsModal(draftId: string): unknown {
  const field = (number: number, required: boolean) => ({
    type: 1,
    components: [{
      type: 4,
      custom_id: `steam_${number}`,
      label: number === 1 ? "Основной Steam-аккаунт" : `Дополнительный Steam-аккаунт ${number}`,
      style: 1,
      placeholder: number === 1 ? "Пример: https://steamcommunity.com/profiles/76561199403575804/" : "SteamID64 или ссылка на профиль",
      required,
      max_length: 200
    }]
  });
  return {
    title: "Steam-аккаунты",
    custom_id: `${CustomId.SteamFormPrefix}${draftId}`,
    components: [field(1, true), field(2, false), field(3, false), field(4, false), field(5, false)]
  };
}

export function staffButtons(disabled = false): unknown[] {
  return [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "Принять", emoji: { name: "✅" }, custom_id: CustomId.Accept, disabled },
      { type: 2, style: 4, label: "Отклонить", emoji: { name: "❌" }, custom_id: CustomId.Reject, disabled },
      { type: 2, style: 1, label: "Позвать в войс", emoji: { name: "🔊" }, custom_id: CustomId.InviteVoice, disabled },
      { type: 2, style: 2, label: "Закрыть", emoji: { name: "🔒" }, custom_id: CustomId.Close }
    ]
  }];
}

export function rejectionModal(): unknown {
  return {
    title: "Отклонение заявки",
    custom_id: CustomId.RejectModal,
    components: [{ type: 1, components: [{ type: 4, custom_id: "reason", label: "Причина", style: 2, placeholder: "Укажите причину отказа", required: true, min_length: 2, max_length: 1000 }] }]
  };
}

export function reviewActions(reviewId: string): unknown[] {
  return [{ type: 1, components: [
    { type: 2, style: 3, label: "Создать тикет-исключение", emoji: { name: "✅" }, custom_id: `review:exception:${reviewId}` },
    { type: 2, style: 4, label: "Бан 24 часа", emoji: { name: "⛔" }, custom_id: `review:ban:${reviewId}` },
    { type: 2, style: 2, label: "Разбанить", emoji: { name: "🔓" }, custom_id: `review:unban:${reviewId}` }
  ] }];
}

export function ageRejectionActions(reviewId: string): unknown[] {
  return [{ type: 1, components: [
    { type: 2, style: 3, label: "Принять как исключение", emoji: { name: "✅" }, custom_id: `review:age-accept:${reviewId}` }
  ] }];
}

export function exceptionModal(reviewId: string): unknown {
  return {
    title: "Исключение для кандидата",
    custom_id: `review:exception-modal:${reviewId}`,
    components: [{ type: 1, components: [{
      type: 4,
      custom_id: "recruiter_comment",
      label: "Комментарий рекрутёра",
      style: 2,
      placeholder: "Почему кандидату разрешено исключение?",
      required: true,
      min_length: 2,
      max_length: 1000
    }] }]
  };
}

export function adminPanel(): { embeds: DiscordEmbed[]; components: unknown[] } {
  return {
    embeds: [{ title: "🛡️ .int Private — Admin Panel", description: "Управление предупреждениями, постоянным ЧС, Steam-привязками и уведомлениями о вайпе.", color: 0x5865f2 }],
    components: [{ type: 1, components: [
      { type: 2, style: 4, label: "Выдать варн", custom_id: "admin:warn", emoji: { name: "⚠️" } },
      { type: 2, style: 1, label: "Steam-привязка", custom_id: "admin:member-info", emoji: { name: "🔗" } },
      { type: 2, style: 3, label: "Предупреждение о вайпе", custom_id: "admin:wipe", emoji: { name: "📢" } },
      { type: 2, style: 2, label: "Явка на вайп", custom_id: "admin:wipe-attendance", emoji: { name: "✅" } }
      , { type: 2, style: 1, label: "Заявки", custom_id: "admin:recruitment-toggle", emoji: { name: "📋" } }
    ] }, { type: 1, components: [
      { type: 2, style: 4, label: "Добавить в ЧС навсегда", custom_id: "admin:blacklist", emoji: { name: "⛔" } },
      { type: 2, style: 1, label: "Привязать Rust-сервер", custom_id: "admin:server-bind", emoji: { name: "🎮" } },
      { type: 2, style: 2, label: "Статистика игрока клана", custom_id: "admin:clan-stats", emoji: { name: "📊" } },
      { type: 2, style: 3, label: "Обновить Vipe Info", custom_id: "admin:server-publish", emoji: { name: "🔄" } },
      { type: 2, style: 5, label: "Стата .int на Mirage", url: "https://miragerust.gg/clan/190", emoji: { name: "📈" } }
    ] }, { type: 1, components: [
      { type: 2, style: 1, label: "Rust+ онлайн и статистика", custom_id: "admin:rustplus-stats", emoji: { name: "🟢" } }
    ] }]
  };
}

export function serverBindingModal(defaultConnect: string, defaultId: string): unknown {
  return { title: "Привязать Rust-сервер", custom_id: "admin:server-bind-modal", components: [
    { type: 1, components: [{ type: 4, custom_id: "label", label: "Название в Discord", style: 1, required: true, value: "Blood Rust — Black", max_length: 100 }] },
    { type: 1, components: [{ type: 4, custom_id: "connect", label: "Connect IP:PORT", style: 1, required: true, value: defaultConnect, max_length: 200 }] },
    { type: 1, components: [{ type: 4, custom_id: "monitoring_id", label: "ID GAMEMONITORING", style: 1, required: true, value: defaultId, max_length: 20 }] }
  ] };
}

export function userSelector(action: "warn" | "member-info" | "blacklist" | "clan-stats"): unknown[] {
  return [{ type: 1, components: [{ type: 5, custom_id: `admin:${action}-user`, placeholder: "Выберите участника", min_values: 1, max_values: 1 }] }];
}

export function blacklistModal(userId: string): unknown {
  return { title: "Постоянный ЧС", custom_id: `admin:blacklist-modal:${userId}`, components: [
    { type: 1, components: [{ type: 4, custom_id: "reason", label: "Причина постоянного бана", style: 2, required: true, min_length: 2, max_length: 1000 }] }
  ] };
}

export function warnModal(userId: string): unknown {
  return { title: "Выдать предупреждение", custom_id: `admin:warn-modal:${userId}`, components: [
    { type: 1, components: [{ type: 4, custom_id: "level", label: "Уровень варна (1 или 2)", style: 1, required: true, min_length: 1, max_length: 1 }] },
    { type: 1, components: [{ type: 4, custom_id: "reason", label: "Причина", style: 2, required: true, min_length: 2, max_length: 1000 }] }
  ] };
}

export function wipeModal(): unknown {
  return { title: "Предупреждение о вайпе", custom_id: "admin:wipe-modal", components: [
    { type: 1, components: [{ type: 4, custom_id: "project", label: "Название проекта", style: 1, required: true, max_length: 100 }] },
    { type: 1, components: [{ type: 4, custom_id: "wipe_time", label: "Вайп (ГГГГ-ММ-ДД ЧЧ:ММ МСК)", style: 1, required: true, placeholder: "2026-09-15 18:00" }] },
    { type: 1, components: [{ type: 4, custom_id: "gather_before", label: "Сбор за сколько часов (1 или 2)", style: 1, required: true, placeholder: "1", min_length: 1, max_length: 1 }] },
    { type: 1, components: [{ type: 4, custom_id: "connect", label: "Connect к серверу", style: 1, required: true, max_length: 300 }] },
    { type: 1, components: [{ type: 4, custom_id: "map_url", label: "Ссылка на карту или скриншот", style: 1, required: false, placeholder: "https://...", max_length: 500 }] }
  ] };
}

export function wipeAnnouncementButtons(wipeId: string): unknown[] {
  return [{ type: 1, components: [
    { type: 2, style: 3, label: "Буду", custom_id: `wipe:rsvp:yes:${wipeId}`, emoji: { name: "✅" } },
    { type: 2, style: 1, label: "Опоздаю", custom_id: `wipe:rsvp:late:${wipeId}`, emoji: { name: "🕒" } },
    { type: 2, style: 4, label: "Не смогу", custom_id: `wipe:rsvp:no:${wipeId}`, emoji: { name: "❌" } },
    { type: 2, style: 2, label: "Указать спот", custom_id: `wipe:square:${wipeId}`, emoji: { name: "🏗️" } }
  ] }];
}

export function wipeSquareModal(wipeId: string): unknown {
  return { title: "Спот для строительства", custom_id: `wipe:square-modal:${wipeId}`, components: [
    { type: 1, components: [{ type: 4, custom_id: "square", label: "Квадрат спота", style: 1, required: true, placeholder: "Например: B6", min_length: 2, max_length: 10 }] }
  ] };
}

export function wipeAbsenceModal(wipeId: string): unknown {
  return { title: "Не смогу прийти на вайп", custom_id: `wipe:rsvp-no-modal:${wipeId}`, components: [
    { type: 1, components: [{ type: 4, custom_id: "reason", label: "Причина отсутствия", style: 2, required: true, placeholder: "Кратко укажите причину", min_length: 3, max_length: 500 }] }
  ] };
}

export function wipeAttendanceUserSelector(wipeId: string): unknown[] {
  return [
    { type: 1, components: [{ type: 5, custom_id: `wipe:attendance-batch:${wipeId}`, placeholder: "Выберите всех, кто зашёл (до 25)", min_values: 1, max_values: 25 }] },
    { type: 1, components: [{ type: 2, style: 3, label: "Все зашли", custom_id: `wipe:attendance-all:${wipeId}`, emoji: { name: "✅" } }] }
  ];
}

export function wipeAttendanceConfirmButtons(wipeId: string): unknown[] {
  return [{ type: 1, components: [
    { type: 2, style: 4, label: "Подтвердить и выдать варны", custom_id: `wipe:attendance-confirm:${wipeId}` },
    { type: 2, style: 2, label: "Отмена", custom_id: `wipe:attendance-cancel:${wipeId}` }
  ] }];
}

export function wipeAttendanceDecisionButtons(wipeId: string, userId: string): unknown[] {
  return [{ type: 1, components: [
    { type: 2, style: 3, label: "Зашёл", custom_id: `wipe:present:${wipeId}:${userId}`, emoji: { name: "✅" } },
    { type: 2, style: 4, label: "Не зашёл — выдать варн", custom_id: `wipe:absent:${wipeId}:${userId}`, emoji: { name: "⚠️" } }
  ] }];
}

export function warningChannelButtons(userId: string, level: 1 | 2): unknown[] {
  return [{ type: 1, components: [
    { type: 2, style: 3, label: `Снять Warn ${level}`, custom_id: `warning:remove:${userId}:${level}`, emoji: { name: "✅" } },
    ...(level === 2 ? [{ type: 2, style: 4, label: "Кикнуть из привата", custom_id: `warning:kick:${userId}` }] : [])
  ] }];
}

export function applicationEmbed(app: ApplicationRecord): DiscordEmbed {
  const role = ROLE_REQUIREMENTS[app.role];
  const steamAccounts = app.steamAccounts ?? [];
  const staff = app.staffId ? `<@${app.staffId}>` : "Неизвестен";
  let status = "🟡 Ожидает рассмотрения Staff";
  if (app.status === "ACCEPTED") status = `✅ **ЗАЯВКА ПРИНЯТА**\n\n**Решение принял:** ${staff}`;
  if (app.status === "REJECTED") status = `❌ **ЗАЯВКА ОТКЛОНЕНА**\n\n**Решение принял:** ${staff}\n\n**Причина:** ${app.rejectionReason ?? "Не указана"}`;

  return {
    title: "📋 Заявка в .int",
    color: app.status === "PENDING" ? 0xf1c40f : app.status === "ACCEPTED" ? 0x2ecc71 : 0xe74c3c,
    fields: [
      { name: "Кандидат", value: `<@${app.applicantId}>`, inline: true },
      { name: "Discord ID", value: `\`${app.applicantId}\``, inline: true },
      ...(app.realName ? [{ name: "Имя", value: app.realName, inline: true }] : []),
      ...(app.steamName ? [{ name: "Steam-ник", value: app.steamName, inline: true }] : []),
      { name: "Возраст", value: String(app.age), inline: true },
      { name: "Направление", value: `${role.emoji} ${role.label}`, inline: true },
      { name: "Steam", value: `[Открыть профиль](${app.steamUrl})`, inline: true },
      { name: "SteamID64", value: `\`${app.steamId64}\``, inline: true },
      ...(steamAccounts.length > 1 ? [{
        name: "Все Steam-аккаунты",
        value: steamAccounts.map((account, index) => `${index + 1}. [${account.steamName ?? account.steamId64}](${account.steamUrl}) — \`${account.steamId64}\`${account.dataHidden ? " — часы скрыты" : account.rustHours !== undefined ? ` — ${account.rustHours.toLocaleString("ru-RU")} ч.` : ""}`).join("\n").slice(0, 1024)
      }] : []),
      { name: "Часы Rust", value: app.steamDataHidden ? "🔒 Скрыты — ручная проверка" : `**${app.rustHours.toLocaleString("ru-RU")} ч.**`, inline: true },
      { name: "Минимум направления", value: `${app.requiredHours.toLocaleString("ru-RU")} ч.`, inline: true },
      { name: "Инвентарь Rust", value: app.inventoryStatus === "OK"
        ? `≈ **${(app.inventoryValueRub ?? 0).toLocaleString("ru-RU")} ₽**\n${app.inventoryItemCount ?? 0} предметов; оценено ${app.inventoryPricedUnique ?? 0}/${app.inventoryTotalUnique ?? 0} типов${app.inventoryLimited ? " (частичная оценка)" : ""}`
        : app.inventoryStatus === "PRIVATE" ? "🔒 Инвентарь скрыт" : "⚠️ Стоимость временно недоступна" },
      { name: "Средний онлайн", value: `${app.dailyOnline} ч./сутки`, inline: true },
      ...(app.applicantComment ? [{ name: "Комментарий кандидата", value: app.applicantComment }] : []),
      ...(app.additionalQuestion && app.additionalAnswer ? [{ name: app.additionalQuestion, value: app.additionalAnswer }] : []),
      ...(app.manualException ? [{ name: "Ручное исключение", value: `✅ Разрешил: <@${app.exceptionStaffId}>\n**Комментарий рекрутёра:** ${app.recruiterComment}` }] : []),
      { name: "Автоматическая проверка", value: app.steamDataHidden
        ? "✅ Возраст соответствует требованиям\n✅ Онлайн соответствует требованиям\n⚠️ Список игр и часы Steam скрыты — решение принимает Staff вручную"
        : app.manualException
        ? "✅ Возраст соответствует требованиям\n✅ Онлайн соответствует требованиям\n✅ Steam-профиль проверен\n✅ Rust обнаружен\n⚠️ Требование по часам разрешено как исключение"
        : "✅ Возраст соответствует требованиям\n✅ Онлайн соответствует требованиям\n✅ Steam-профиль проверен\n✅ Rust обнаружен\n✅ Количество часов соответствует роли" },
      { name: "Статус", value: status }
    ],
    timestamp: app.createdAt
  };
}
