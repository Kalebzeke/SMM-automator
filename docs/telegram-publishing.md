# Telegram Channel Management and Publishing

Publish one post to any number of Telegram channels — text, media, and
inline buttons — with per-channel delivery tracking, retries, scheduling,
and edit/delete-everywhere. Lives under `/telegram` in the dashboard.

## 1. Create the publishing bot (BotFather)

1. In Telegram, open a chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts to name it.
3. BotFather replies with a token like `123456789:AA...` — copy it.
4. In the dashboard, go to **Telegram → Settings** and paste it in.
   "Test Connection" confirms the token is valid; it's encrypted and stored
   in `telegram_bots.encrypted_token`, and the full token is never sent back
   to the browser afterward (only the last 4 characters, for recognition).

## 2. Add the bot to a channel

1. Open your channel or supergroup → **Administrators** → **Add Admin**.
2. Search for your bot's `@username` and add it.
3. Grant at least **Post Messages**. Also grant **Edit Messages** and
   **Delete Messages** so Edit Everywhere / Delete Everywhere work.
4. In **Telegram → Channels → Connect Channel**, paste the channel's numeric
   chat ID (e.g. `-1001234567890`). Get it by forwarding any message from
   the channel to [@userinfobot](https://t.me/userinfobot), or from
   `getUpdates`/any Telegram channel-ID tool.

Usernames can change; the numeric `telegram_chat_id` is what's stored and
never changes, so it's always the source of truth.

## 3. Required environment variables

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Already required by the rest of the app. |
| `ADMIN_PANEL_PASSWORD` | Already required — gates the `/telegram` pages and Telegram dashboard APIs. The webhook uses `TELEGRAM_WEBHOOK_SECRET` instead so Telegram can call it. |
| `CRON_SECRET` | Already required — also authorizes `/api/cron/telegram-worker`. |
| `TELEGRAM_TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64-encoded. Generate with `openssl rand -base64 32`. Encrypts bot tokens at rest (AES-256-GCM). Losing/rotating this key invalidates every stored bot token — you'd need to reconnect the bot. |
| `TELEGRAM_WEBHOOK_SECRET` | Any random string. Telegram echoes it back in the `X-Telegram-Bot-Api-Secret-Token` header on every webhook call; requests without a match are rejected. |

See `.env.example` for the full list, including the Phase 2 (MTProto)
placeholders that aren't required yet.

## 4. Database migration

Run, in order, against your Supabase project's SQL editor (or however you
apply this repo's migrations):

```
supabase/migrations/0004_telegram_publishing.sql
supabase/migrations/0005_telegram_worker_cron.sql
```

`0004` creates the Telegram tables and a public `telegram-media` storage
bucket. `0005` schedules the delivery worker via `pg_cron` + `pg_net`,
exactly like the existing `0003_supabase_sync_cron.sql` does for order
syncing — it needs the same `app_url` and `cron_secret` Vault secrets.

## 5. Configuring the webhook (channel status tracking)

The webhook keeps a channel's connection status in sync automatically when
the bot is added, promoted, removed, or demoted, or when posting permission
is revoked — via Telegram's `my_chat_member` updates. It does **not**
register new channels (that's still the explicit "Connect Channel" action).

Once a bot is connected, call `setWebhook` once:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-app>.vercel.app/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET value>",
    "allowed_updates": ["my_chat_member", "message"]
  }'
```

Without a webhook configured, everything else still works — channel status
just won't auto-update when something changes in Telegram; use each
channel's **Test** button to re-check manually.

## 6. Running the worker locally

Publishing uses a database-backed queue, not Redis/BullMQ (this repo has
neither): `post_deliveries` rows carry a `pending_operation`
(`send`/`edit`/`delete`) and `next_attempt_at`. Two things drain that queue:

- **Immediate dispatch** — after you click Publish/Retry/Edit Everywhere/
  Delete Everywhere, the API route uses Next's `after()` to run one worker
  pass right after responding (same pattern the existing order-submission
  code uses).
- **The cron sweep** — `GET/POST /api/cron/telegram-worker` (secured by
  `CRON_SECRET`, same as `/api/cron/sync-orders`) dispatches any due
  scheduled posts and drains pending/retrying/queued deliveries. In
  production this runs every minute via the `0005` migration's `pg_cron`
  job.

To run it locally without waiting on Supabase's cron:

```bash
curl "http://localhost:3000/api/cron/telegram-worker?secret=$CRON_SECRET"
```

Run that on a loop (or just after publishing a test post) while developing.

## 7. Testing publishing without spamming a real channel

1. Create a private Telegram channel just for testing, add your bot as
   admin there, and connect it in the dashboard.
2. Use **New Post**, select only that test channel, and publish.
3. Check **Telegram → Posts → History** (or the post detail page) for
   per-channel delivery status; failures show Telegram's exact error text.

Automated tests (`npm test`, via `vitest`) mock the Telegram Bot API and the
database — they never send a real Telegram message. They cover: delivery
dedup (`createDeliveriesForPost` never double-queues the same post+channel),
retry only touching failed deliveries, Edit/Delete Everywhere only touching
delivered messages, `my_chat_member` → channel status mapping, HTML
sanitization/escaping, token encryption, backoff timing, and the admin auth
guard.

## 8. How scheduled jobs work

- **Send Now**: deliveries are created with `status='pending'`,
  `pending_operation='send'`, `next_attempt_at=now()` and dispatched
  immediately (see above).
- **Schedule**: the post is stored with `status='scheduled'` and
  `scheduled_at`; no deliveries exist yet. Each cron tick calls
  `dispatchDuePosts()`, which finds due scheduled posts and creates their
  deliveries — from that point it's identical to Send Now. A scheduled post
  can be edited, canceled, or published immediately before it's due.
- **Retry**: only deliveries with `status='failed'` are reset to
  `pending`/`send`; anything already `sent` is left untouched, so a retry
  can never double-post to a channel.
- **Rate limiting / backoff**: the worker processes due deliveries with a
  small delay between Telegram calls, honors `retry_after` on HTTP 429s
  exactly, and otherwise backs off exponentially (5s, 10s, 20s, ... capped
  at 5 minutes, up to 6 attempts) before giving up. A 400/403 with no
  `retry_after` (bad chat, bot not admin, etc.) is treated as permanent and
  not retried.

## 9. Troubleshooting common Telegram errors

| Error | Meaning | Fix |
|---|---|---|
| `Forbidden: bot was kicked from the channel chat` | Bot removed from the channel. | Re-add it as admin, then hit **Test** on the channel. |
| `Bad Request: not enough rights to send text messages` | Bot is admin but lacks "Post Messages". | Grant the permission in Telegram's admin settings. |
| `Bad Request: chat not found` | Wrong `telegram_chat_id`, or the bot was never added to that chat. | Double-check the numeric ID; it must start with `-100` for channels/supergroups. |
| `Too Many Requests: retry after N` | Telegram flood control. | Handled automatically — the delivery retries after Telegram's requested wait. |
| `Bad Request: message to delete not found` | Message was already deleted (manually or previously). | Delete Everywhere treats this as success and marks the delivery `deleted`. |
| `Bad Request: message is not modified` | Edit Everywhere sent with identical text/buttons. | Not an error to worry about — nothing to update. |

## Reserved for Phase 2 (not implemented)

`TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_SESSION_ENCRYPTION_KEY`
are reserved for an optional future MTProto integration (creating channels
directly from the dashboard via a real Telegram user account, since bots
can't create channels). Nothing in this repo currently uses them.
Everything above — channels, categories, posts, deliveries — is modeled
independently of how a channel's bot got added, so MTProto could be layered
on later without touching the publishing path.
