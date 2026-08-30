# Panelist — SMM Order Automator

Paste a post link from X, Instagram, TikTok, or LinkedIn, pick a tier, and
it fires the right SocPanel orders automatically.

## Why every platform is manual paste, including X

X's Developer Agreement and Platform Manipulation policy prohibit using the
API to trigger inorganic engagement (bought views/likes/retweets/comments) —
even with a human clicking "submit" on each one. Declaring a different,
softer use case on the developer application doesn't avoid this: it's a
separate violation (misrepresentation), and enforcement is based on what the
token actually does, not what the form says. So this tool never touches the
X API — you paste the link yourself, same as the other three platforms, and
everything downstream (service lookup, quantities, comments, submission to
SocPanel) is automatic.

## What it does

- **Overview** — new-order form with a visual platform picker, live stat
  cards (total/submitted/pending/failed), and a running feed of every order
  with per-service success/error status.
- **Services** — pull your live service catalog from SocPanel, map each
  service type (views/likes/retweets/comments/shares) to a real SocPanel
  service ID, per platform and per tier (Priority / Regular), with editable
  quantities.
- **Comment Pools** — upload a CSV of comments per platform. Any order that
  includes a "comments" service pulls a fresh, never-reused comment from the
  pool you assign — and the platform is enforced, so an X pool can't
  accidentally get used on a LinkedIn order.
- **Settings** — SocPanel API key, stored server-side only. Sidebar shows
  your live SocPanel balance.
- **Telegram** — a separate publishing system for Telegram channels: connect
  a bot, manage channels/categories, compose one post (text, media, inline
  buttons), send it to any mix of channels or "All Channels", track
  per-channel delivery status, retry failures, schedule posts, and edit or
  delete a published post everywhere it went. See
  [`docs/telegram-publishing.md`](docs/telegram-publishing.md) for setup.

## SocPanel API note

This uses the standard SMM-panel API format (single endpoint, `key` +
`action` params) in `lib/socpanel.ts`. **Before going live, check your own
SocPanel account's API page** (Account → API in your dashboard) and confirm
the field names match — most panels agree on this format, but if yours
differs, only `lib/socpanel.ts` needs editing.

## Setup

### 1. Supabase

1. Create a new Supabase project.
2. For first-time setup, open the SQL editor and run `supabase/schema.sql`.
3. For upgrades, run files in `supabase/migrations/` in ascending order using this repo's own numbering (e.g. `0001_...sql`, `0002_...sql`).
4. Copy your Project URL and `service_role` key (Project Settings → API).

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`.

### 3. Run locally

```
npm install
npm run dev
```

Open http://localhost:3000, go to **Settings**, and paste in your SocPanel
API key (this lives in Supabase, not in `.env`).

### 4. Configure your tiers

Go to **Services**, click "Pull services from SocPanel", then for each
platform/tier, map each service type to the right SocPanel service ID and
set your quantities (e.g. X / Priority: Views 30000, Likes 25, Retweets 25,
Comments 20).

### 5. Upload comment pools (optional)

Go to **Comment Pools**, pick the platform, upload a CSV. One comment per
row (or first column if multi-column).

### 6. Deploy to Vercel

Push to GitHub, import in Vercel, add the two env vars. No cron jobs needed.

## Migrating from the earlier X-auto-polling version

If you ran an earlier version of `schema.sql` that included
`watched_x_accounts` or X-token columns, see the migration notes at the
bottom of `supabase/schema.sql`.

## Notes on your standing preferences

Follows your usual conventions: Next.js + Supabase + Vercel, `git add [file]`
over `git add .`, individual file edits over full ZIPs for small changes
going forward.


## Latest update: mass orders + multiple API providers

This build adds:

- Mass order submission from the Overview page. Paste one link per line or comma-separated links.
- One tracked order row per submitted link.
- Multiple SMM-panel API providers in Settings.
- Service mapping per provider, platform, tier, and service type.
- Searchable service catalog by service ID, name, type, category, rate, min, or max.
- Futuristic SMM-panel-style UI refresh.

### Required database update

Run the next file from `supabase/migrations/` in order (for this repo, start with `0001_provider_agnostic_slots.sql`).

### How to use

1. Go to Settings and add SocPanel or another SMM panel API provider.
2. Go to Services, choose the provider, click "Pull services", search the exact service ID or keyword, then map each tier.
3. Go to Mass Orders, paste several post links, pick platform and tier, then submit.

## Latest update: Telegram Channel Management and Publishing

This build adds a full Telegram publishing system under `/telegram`:

- Connect a Telegram bot, manage channels and channel categories.
- Compose a post (text, formatting, one image/video/file, inline URL
  buttons) and send it to any mix of channels, categories, or all channels.
- Background delivery queue with per-channel status, automatic retry with
  backoff, and Telegram flood-control handling.
- Scheduling, drafts, duplicate post, post history.
- Edit Everywhere / Delete Everywhere for already-published posts.

### Required database update

Run, in order: `supabase/migrations/0004_telegram_publishing.sql`, then
`supabase/migrations/0005_telegram_worker_cron.sql`.

### Required environment variables

`TELEGRAM_TOKEN_ENCRYPTION_KEY` and `TELEGRAM_WEBHOOK_SECRET` (see
`.env.example`).

### How to use

See [`docs/telegram-publishing.md`](docs/telegram-publishing.md) for the
full walkthrough (BotFather setup, adding the bot to a channel, webhook
config, running the worker locally, troubleshooting).

## Logo and favicon

The header logo loads from `public/logo.svg`. Replace that file with your own SVG using the same filename and the top bar will update automatically.

The browser icon loads from `public/favicon.svg`, and `app/icon.svg` is also included for Next.js app icon support. Replace both if you want the browser tab icon to match your brand.
