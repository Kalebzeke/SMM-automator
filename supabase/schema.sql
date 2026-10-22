-- SMM Order Automator — Supabase schema
-- Run this in the Supabase SQL editor for your project.
-- This version supports mass orders and multiple SMM-panel API providers.

create extension if not exists "pgcrypto";

-- App-wide legacy settings. Kept for backwards compatibility with older installs.
create table if not exists app_settings (
  id int primary key default 1,
  api_key text,
  api_url text,
  constraint single_row check (id = 1)
);

-- Backfill generic columns for older installs that still use socpanel_* names.
alter table app_settings add column if not exists api_key text;
alter table app_settings add column if not exists api_url text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_settings'
      and column_name = 'socpanel_api_key'
  ) then
    execute 'update app_settings
             set api_key = coalesce(api_key, socpanel_api_key)
             where api_key is null and socpanel_api_key is not null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_settings'
      and column_name = 'socpanel_api_url'
  ) then
    execute 'update app_settings
             set api_url = coalesce(api_url, socpanel_api_url)
             where api_url is null and socpanel_api_url is not null';
  end if;
end
$$;

insert into app_settings (id) values (1) on conflict (id) do nothing;
alter table app_settings alter column api_url drop default;

-- Multiple SMM panel providers. Any provider that follows the common
-- action/services/add API pattern can be added here.
create table if not exists api_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  api_url text not null,
  api_key text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table api_providers alter column api_url drop default;

-- Optional migration helper: copy legacy single-provider settings into providers.
insert into api_providers (name, api_url, api_key, is_active)
select
  'Legacy provider',
  api_url,
  api_key,
  true
from app_settings
where id = 1
  and api_key is not null
  and api_url is not null
  and btrim(api_url) <> ''
  and not exists (
    select 1
    from api_providers
    where lower(name) = 'legacy provider'
      and api_url = app_settings.api_url
  );

-- Platforms this tool supports.
do $$ begin
  create type platform_t as enum ('x', 'instagram', 'tiktok', 'linkedin', 'youtube', 'kick', 'twitch');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type tier_t as enum ('priority', 'regular');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type order_status_t as enum ('pending', 'submitted', 'failed');
exception when duplicate_object then null;
end $$;

-- One row per (platform, service_type, slot_index). Each preset can point to a
-- different provider and service ID.
create table if not exists service_presets (
  id uuid primary key default gen_random_uuid(),
  platform platform_t not null,
  tier tier_t not null,
  service_type text not null,
  slot_index int not null default 1,
  api_provider_id uuid references api_providers(id) on delete set null,
  panel_service_id text,
  quantity int not null default 0,
  comment_categories text[] not null default '{}',
  keywords text[] not null default '{}',
  is_fallback boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, service_type, slot_index)
);

-- MIGRATION for older databases that already have service_presets.
alter table service_presets add column if not exists api_provider_id uuid references api_providers(id) on delete set null;
alter table service_presets add column if not exists panel_service_id text;
alter table service_presets add column if not exists comment_categories text[] not null default '{}';
alter table service_presets add column if not exists slot_index int not null default 1;
alter table service_presets add column if not exists keywords text[] not null default '{}';
alter table service_presets add column if not exists is_fallback boolean not null default false;

-- Drop conflicting legacy uniqueness before normalizing comments slot rows.
alter table service_presets drop constraint if exists service_presets_platform_tier_service_type_key;
alter table service_presets drop constraint if exists service_presets_platform_service_type_slot_index_key;

-- Convert legacy comments_slot_N rows into comments service with slot indexes.
update service_presets
set service_type = 'comments'
where service_type ~ '^comments_slot_[0-9]+$';

-- Re-rank slot indexes so old regular/priority rows become independent slots.
with ranked as (
  select
    id,
    row_number() over (
      partition by platform, service_type
      order by
        case when tier = 'priority' then 0 else 1 end,
        created_at,
        id
    ) as next_slot
  from service_presets
)
update service_presets s
set slot_index = ranked.next_slot
from ranked
where ranked.id = s.id;

update service_presets
set keywords = case
  when array_length(keywords, 1) is null
    then coalesce(comment_categories, '{}')
  else keywords
end;

alter table service_presets
  add constraint service_presets_platform_service_type_slot_index_key
  unique (platform, service_type, slot_index);

-- A pool of comments uploaded via CSV, shuffled and assigned one-per-link.
create table if not exists comment_pools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform platform_t not null,
  category text,
  created_at timestamptz not null default now()
);

alter table comment_pools add column if not exists category text;


create table if not exists comment_pool_items (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references comment_pools(id) on delete cascade,
  comment text not null,
  used boolean not null default false,
  used_in_order_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_comment_pool_items_unused
  on comment_pool_items (pool_id) where used = false;

-- Every link in a mass submit becomes its own tracked order row.
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  platform platform_t not null,
  tier tier_t not null,
  link text not null,
  source text not null default 'manual',
  status order_status_t not null default 'pending',
  comment_pool_id uuid references comment_pools(id),
  services_ordered jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_orders_created_at on orders (created_at desc);

-- Older install helper:
-- If comment_pools is missing platform, run:
--   alter table comment_pools add column if not exists platform platform_t;
--   update comment_pools set platform = 'x' where platform is null;
--   alter table comment_pools alter column platform set not null;

-- =============================================================
-- Telegram Channel Management and Publishing
-- Kept in sync with supabase/migrations/0004_telegram_publishing.sql
-- so a fresh install gets it in one pass.
-- =============================================================

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
