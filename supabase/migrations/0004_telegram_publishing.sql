-- 0004_telegram_publishing.sql
-- Telegram Channel Management and Publishing system.
-- Safe to re-run: uses create-if-not-exists / add-column-if-not-exists throughout,
-- matching this repo's existing migration style.

create extension if not exists "pgcrypto";

do $$ begin
  create type telegram_bot_status_t as enum ('unverified', 'connected', 'invalid', 'disconnected');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type telegram_channel_type_t as enum ('channel', 'supergroup');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type telegram_channel_status_t as enum ('connected', 'disconnected', 'permission_issue');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type telegram_post_status_t as enum ('draft', 'scheduled', 'sending', 'sent', 'failed', 'canceled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type telegram_delivery_status_t as enum ('pending', 'queued', 'processing', 'sent', 'failed', 'retrying', 'deleted');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type telegram_media_type_t as enum ('photo', 'video', 'document');
exception when duplicate_object then null;
end $$;

-- What the worker should do next with a delivery row. `status` reflects the
-- outcome of the last attempt; `pending_operation` is the queued action.
do $$ begin
  create type telegram_delivery_operation_t as enum ('send', 'edit', 'delete');
exception when duplicate_object then null;
end $$;

-- One row per configured publishing bot. Token is stored encrypted
-- (see lib/telegram/crypto.ts) and is never returned to the frontend.
create table if not exists telegram_bots (
  id uuid primary key default gen_random_uuid(),
  telegram_bot_id text,
  username text,
  encrypted_token text not null,
  status telegram_bot_status_t not null default 'unverified',
  is_active boolean not null default true,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists channel_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  unique (name)
);

-- Telegram's numeric chat ID is the permanent identifier; usernames can change
-- and are stored only for display/search.
create table if not exists telegram_channels (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null,
  username text,
  title text not null default '',
  type telegram_channel_type_t not null default 'channel',
  photo_url text,
  member_count int,
  publishing_enabled boolean not null default true,
  status telegram_channel_status_t not null default 'connected',
  bot_is_admin boolean not null default false,
  bot_permissions jsonb not null default '{}',
  channel_group_id uuid references channel_groups(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_verified_at timestamptz,
  unique (telegram_chat_id)
);

create index if not exists idx_telegram_channels_group on telegram_channels (channel_group_id);

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  text text not null default '',
  parse_mode text not null default 'HTML',
  status telegram_post_status_t not null default 'draft',
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_posts_status_scheduled on posts (status, scheduled_at);
create index if not exists idx_posts_created_at on posts (created_at desc);

create table if not exists post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  media_type telegram_media_type_t not null,
  storage_key text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_post_media_post on post_media (post_id, position);

create table if not exists post_buttons (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  label text not null,
  url text not null,
  row_index int not null default 0,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_post_buttons_post on post_buttons (post_id, row_index, position);

create table if not exists post_destinations (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  channel_id uuid not null references telegram_channels(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, channel_id)
);

create index if not exists idx_post_destinations_post on post_destinations (post_id);

-- The delivery queue: one row per (post, channel). Status drives the worker.
create table if not exists post_deliveries (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  channel_id uuid not null references telegram_channels(id) on delete cascade,
  telegram_message_id bigint,
  status telegram_delivery_status_t not null default 'pending',
  pending_operation telegram_delivery_operation_t,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, channel_id)
);

create index if not exists idx_post_deliveries_post on post_deliveries (post_id);
create index if not exists idx_post_deliveries_worker
  on post_deliveries (next_attempt_at)
  where pending_operation is not null;

-- Public bucket so Telegram's Bot API can fetch media by URL directly
-- (uploads/deletes are done server-side with the service-role key, which
-- bypasses storage RLS; the "public" flag serves GETs without RLS checks).
insert into storage.buckets (id, name, public)
values ('telegram-media', 'telegram-media', true)
on conflict (id) do nothing;
