# Rusticket — .int Recruitment Bot

Discord-бот для автоматической проверки и обработки заявок на вступление в клан .int. Работает как Cloudflare Worker через Discord Interactions API; VPS и постоянно запущенный процесс не нужны.

## Возможности

- панель заявок `/setup-recruitment`;
- двухэтапная анкета: направление → возраст, Steam и суточный онлайн;
- безопасная проверка Steam Community URL и автоматическое получение часов Rust;
- отдельные пороги часов для Combat, Farm, Builder, Industrial, Electric и Pilot;
- приватные тикеты с точными Discord permissions;
- действия Staff: принять, отклонить с причиной, закрыть с подтверждением;
- запрет двух активных заявок и cooldown 30 секунд;
- блокировка повторной подачи на 24 часа после достоверного автоматического отказа;
- защита по Discord ID и SteamID64 от повторных заявок и смены роли;
- комментарии кандидата и рекрутёра;
- Staff-исключение, ручная блокировка и разблокировка из канала логов;
- журналирование решений и ошибок без секретов;
- проверка Ed25519-подписи каждого interaction;
- Cloudflare KV для минимального состояния.

## Требования

- Node.js 20 или новее;
- аккаунт Cloudflare;
- Discord Application и сервер Discord;
- Steam Web API key.

## 1. Создание Discord Application

1. Откройте [Discord Developer Portal](https://discord.com/developers/applications).
2. Нажмите **New Application**, задайте имя, например `Rusticket`.
3. На странице **General Information** скопируйте **Application ID** и **Public Key**.
4. Откройте **Bot**, нажмите **Reset Token** и сохраните Bot Token. Никому его не отправляйте.
5. Privileged Gateway Intents этому боту не нужны.

## 2. Приглашение бота

В разделе **OAuth2 → URL Generator** выберите scopes:

- `bot`;
- `applications.commands`.

Bot permissions:

- View Channels;
- Send Messages;
- Embed Links;
- Attach Files;
- Read Message History;
- Manage Channels;
- Manage Messages.

Не выдавайте боту Administrator. Откройте созданную ссылку и добавьте бота на сервер.

## 3. Получение Discord ID

В Discord включите **Настройки пользователя → Расширенные → Режим разработчика**. Через контекстное меню **Копировать ID** получите:

- ID сервера → `DISCORD_GUILD_ID`;
- ID канала, где должна находиться панель → `TICKETS_CHANNEL_ID`;
- ID категории приватных тикетов → `TICKETS_CATEGORY_ID`;
- ID канала аудита → `LOG_CHANNEL_ID`.

Staff Role по умолчанию: `1477246087436963931`. При необходимости его можно переопределить переменной `STAFF_ROLE_ID`, не меняя TypeScript.

## 4. Steam API Key

1. Войдите в Steam.
2. Откройте [Steam Web API Key](https://steamcommunity.com/dev/apikey).
3. Укажите домен вашего Worker либо осмысленное имя проекта.
4. Сохраните ключ как `STEAM_API_KEY`. Не добавляйте его в Git.

## 5. Установка

```bash
git clone YOUR_PRIVATE_REPOSITORY_URL
cd Rusticket
npm install
```

Либо, если проект уже находится на компьютере:

```bash
cd Rusticket
npm install
```

Wrangler уже находится в devDependencies, глобальная установка не обязательна. При желании:

```bash
npm install --global wrangler
```

Вход в Cloudflare:

```bash
npx wrangler login
```

## 6. Создание KV

```bash
npx wrangler kv namespace create APPLICATIONS
npx wrangler kv namespace create APPLICATIONS --preview
```

Скопируйте полученные `id` в `wrangler.toml` вместо:

```toml
id = "REPLACE_WITH_PRODUCTION_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_PREVIEW_KV_NAMESPACE_ID"
```

## 7. Настройка переменных и секретов

Секреты добавляются интерактивно — команда попросит вставить значение:

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put STEAM_API_KEY
```

Остальные значения также можно хранить как secrets, чтобы не редактировать исходный код:

```bash
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_GUILD_ID
npx wrangler secret put TICKETS_CHANNEL_ID
npx wrangler secret put TICKETS_CATEGORY_ID
npx wrangler secret put LOG_CHANNEL_ID
```

Если Staff Role отличается от значения по умолчанию:

```bash
npx wrangler secret put STAFF_ROLE_ID
```

Для локальной разработки скопируйте `.env.example` в `.dev.vars` и заполните значения. Файл `.dev.vars` исключён из Git.

## 8. Проверки и деплой

```bash
npm run typecheck
npm run lint
npm test
npm run deploy
```

Wrangler напечатает URL вида:

```text
https://rusticket.YOUR_SUBDOMAIN.workers.dev
```

## 9. Discord Interactions Endpoint

1. Вернитесь в Discord Developer Portal.
2. Откройте приложение → **General Information**.
3. Вставьте URL Worker в **Interactions Endpoint URL**.
4. Сохраните. Discord отправит подписанный PING; Worker ответит PONG.

## 10. Регистрация slash-команды

Скрипту регистрации нужны три временные переменные процесса. В PowerShell:

```powershell
$env:DISCORD_APPLICATION_ID="ВАШ_APPLICATION_ID"
$env:DISCORD_GUILD_ID="ВАШ_GUILD_ID"
$env:DISCORD_BOT_TOKEN="ВАШ_BOT_TOKEN"
npm run commands:register
Remove-Item Env:DISCORD_BOT_TOKEN
```

Команда регистрируется на одном сервере и обычно появляется быстро.

## 11. Первый запуск

1. Проверьте, что роль Staff находится ниже роли бота в иерархии сервера.
2. Проверьте права бота на категорию тикетов и канал логов.
3. Выполните `/setup-recruitment` от Administrator либо Staff.
4. Убедитесь, что панель появилась в заданном канале.
5. Подайте тестовую заявку с публичным Steam-профилем и открытым списком игр.
6. Проверьте приватность тикета, кнопки Staff и сообщения в канале логов.
7. После отказа по часам проверьте Staff-кнопки исключения, блокировки и разблокировки в логе.
8. Проверьте, что повторная подача с тем же Discord ID или SteamID64 блокируется.

## Локальная разработка

```bash
npm run dev
```

Для проверки Discord endpoint локальному Worker нужен публичный HTTPS-туннель. Для первой установки проще сначала выполнить deploy и использовать `workers.dev` URL.

## Переменные окружения

| Переменная | Назначение | Обязательная |
|---|---|---|
| `DISCORD_APPLICATION_ID` | Application ID и ID пользователя бота | Да |
| `DISCORD_PUBLIC_KEY` | Проверка подписи interactions | Да |
| `DISCORD_BOT_TOKEN` | Discord REST API | Да |
| `DISCORD_GUILD_ID` | Разрешённый сервер | Да |
| `STEAM_API_KEY` | Steam Web API | Да |
| `TICKETS_CHANNEL_ID` | Канал панели | Да |
| `TICKETS_CATEGORY_ID` | Категория тикетов | Да |
| `LOG_CHANNEL_ID` | Канал аудита | Да |
| `STAFF_ROLE_ID` | Staff Role | Нет; есть значение по умолчанию |

## Безопасность

- Worker отклоняет запросы без валидной Discord Ed25519-подписи с HTTP 401.
- Steam URL допускает только HTTPS и точные hostnames `steamcommunity.com`/`www.steamcommunity.com`.
- Токены и API-ключи не выводятся в Discord и не должны попадать в Git.
- Не помещайте реальные секреты в `.env.example`, `wrangler.toml`, README или исходный код.
- Если токен случайно опубликован, немедленно перевыпустите его в соответствующем сервисе.

## Команды

```bash
npm run dev
npm run deploy
npm run commands:register
npm run typecheck
npm run lint
npm test
```
