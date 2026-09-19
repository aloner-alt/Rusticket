import { ROLE_REQUIREMENTS } from "../config/requirements";
import type { ApplicationRecord, DiscordEmbed } from "../types";

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

export function recruitmentPanel(): { embeds: DiscordEmbed[]; components: unknown[] } {
  return {
    embeds: [{
      title: "🛡️ Заявка в клан .int",
      description: "Хотите вступить в **.int**?\n\nНажмите кнопку ниже и заполните анкету. Перед созданием тикета бот автоматически проверит основные требования к кандидату.",
      color: 0x2ecc71
    }],
    components: [{ type: 1, components: [{ type: 2, style: 3, label: "Подать заявку", emoji: { name: "📝" }, custom_id: CustomId.Open }] }]
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

export function applicationModal(role: string): unknown {
  return {
    title: "Заявка в .int",
    custom_id: `${CustomId.FormPrefix}${role}`,
    components: [
      { type: 1, components: [{ type: 4, custom_id: "age", label: "Возраст", style: 1, placeholder: "Например: 18", required: true, min_length: 2, max_length: 2 }] },
      { type: 1, components: [{ type: 4, custom_id: "daily_online", label: "Средний онлайн в сутки", style: 1, placeholder: "Например: 6", required: true, max_length: 2 }] },
      { type: 1, components: [{ type: 4, custom_id: "real_name", label: "Ваше имя", style: 1, placeholder: "Например: Богдан", required: true, min_length: 2, max_length: 32 }] },
      { type: 1, components: [{ type: 4, custom_id: "comment", label: "Комментарий для рекрутёра", style: 2, placeholder: "Расскажите о себе или укажите важные детали", required: false, max_length: 1000 }] }
    ]
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
      placeholder: "SteamID64 или ссылка на профиль",
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

export function ageRejectionActions(userId: string): unknown[] {
  return [{ type: 1, components: [
    { type: 2, style: 2, label: "Разбанить подачу", emoji: { name: "🔓" }, custom_id: `review:user-unban:${userId}` }
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
      { type: 2, style: 3, label: "Предупреждение о вайпе", custom_id: "admin:wipe", emoji: { name: "📢" } }
    ] }, { type: 1, components: [
      { type: 2, style: 4, label: "Добавить в ЧС навсегда", custom_id: "admin:blacklist", emoji: { name: "⛔" } },
      { type: 2, style: 1, label: "Привязать Rust-сервер", custom_id: "admin:server-bind", emoji: { name: "🎮" } },
      { type: 2, style: 2, label: "Статистика игрока клана", custom_id: "admin:clan-stats", emoji: { name: "📊" } },
      { type: 2, style: 3, label: "Обновить Vipe Info", custom_id: "admin:server-publish", emoji: { name: "🔄" } },
      { type: 2, style: 5, label: "Стата .int на Mirage", url: "https://miragerust.gg/clan/190", emoji: { name: "📈" } }
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
    { type: 1, components: [{ type: 4, custom_id: "comment", label: "Дополнительная информация", style: 2, required: false, max_length: 500 }] }
  ] };
}

export function warningChannelButtons(userId: string, level: 1 | 2): unknown[] {
  return [{ type: 1, components: [{ type: 2, style: 3, label: `Снять Warn ${level}`, custom_id: `warning:remove:${userId}:${level}`, emoji: { name: "✅" } }] }];
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
