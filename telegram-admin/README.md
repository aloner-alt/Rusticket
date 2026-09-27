# Rusticket Telegram Admin

Cloudflare Worker receives Telegram webhooks. The Debian agent connects outbound to the Worker, so the server does not need a public port.

Required Worker secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SERVER_AGENT_TOKEN`.
The only allowed Telegram account is configured by `TELEGRAM_ADMIN_ID`.

The Worker uses the existing Rusticket KV namespace with an isolated `tgadmin:` key prefix. Add secrets, deploy, and register `https://<worker>/telegram` as the Telegram webhook with the same webhook secret.
