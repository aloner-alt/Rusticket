const required = ["DISCORD_APPLICATION_ID", "DISCORD_GUILD_ID", "PRIVATE_GUILD_ID", "DISCORD_BOT_TOKEN"] as const;
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
}

function readEnvironment(name: typeof required[number]): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

const applicationId = readEnvironment("DISCORD_APPLICATION_ID");
const guildId = readEnvironment("DISCORD_GUILD_ID");
const privateGuildId = readEnvironment("PRIVATE_GUILD_ID");
const token = readEnvironment("DISCORD_BOT_TOKEN");

const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify([{
    name: "setup-recruitment",
    description: "Опубликовать панель подачи заявок .int",
    type: 1,
    dm_permission: false
  }])
});

if (!response.ok) {
  throw new Error(`Discord command registration failed with HTTP ${response.status}`);
}
console.log("Guild command /setup-recruitment registered successfully.");

const privateResponse = await fetch(`https://discord.com/api/v10/applications/${applicationId}/guilds/${privateGuildId}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify([{
    name: "claim",
    description: "Получить роли и ник после принятия заявки",
    type: 1,
    dm_permission: false
  }, {
    name: "setup-admin-panel",
    description: "Опубликовать приватную панель модерации",
    type: 1,
    default_member_permissions: "8",
    dm_permission: false
  }, {
    name: "warn-status",
    description: "Показать ваши активные варны и оставшееся время",
    type: 1,
    dm_permission: false
  }])
});
if (!privateResponse.ok) throw new Error(`Private guild command registration failed with HTTP ${privateResponse.status}`);
console.log("Private guild command /claim registered successfully.");

export {};
