-- Full schema for Finance PWA + Telegram bot.
-- Run this whole file once in Supabase SQL Editor (safe to re-run, uses IF NOT EXISTS / CREATE OR REPLACE).

create table if not exists profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  base_currency text default 'USD',
  display_currency text default 'USD',
  theme text default 'dark',
  telegram_user_id bigint unique,
  created_at timestamptz default now()
);

create table if not exists sources(
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  category text default 'Другое',
  created_at timestamptz default now()
);

create table if not exists transactions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null check(type in ('income','expense')),
  amount numeric not null check(amount > 0),
  currency text not null,
  date date not null,
  source_id uuid references sources(id) on delete set null,
  category text not null,
  description text default '',
  status text,
  recurring boolean default false,
  rate_to_usd numeric not null,
  rate_to_base numeric not null,
  base_amount numeric not null,
  created_at timestamptz default now()
);

create table if not exists goals(
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  target numeric not null,
  currency text not null,
  progress numeric default 0,
  deadline date,
  created_at timestamptz default now()
);

-- One-time codes used to link a Telegram chat to a web account (see api/telegram.ts + Settings > Telegram).
create table if not exists telegram_link_codes(
  code text primary key,
  telegram_chat_id bigint not null,
  created_at timestamptz default now()
);

-- Draft transactions the bot is mid-way through collecting (e.g. waiting for "which source?").
-- Only ever touched by the server-side bot function using the service_role key.
create table if not exists bot_pending(
  telegram_user_id bigint primary key,
  draft jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table profiles enable row level security;
alter table sources enable row level security;
alter table transactions enable row level security;
alter table goals enable row level security;
alter table telegram_link_codes enable row level security;
alter table bot_pending enable row level security;

drop policy if exists "profiles own" on profiles;
create policy "profiles own" on profiles for all using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "sources own" on sources;
create policy "sources own" on sources for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "transactions own" on transactions;
create policy "transactions own" on transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "goals own" on goals;
create policy "goals own" on goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- telegram_link_codes and bot_pending intentionally get NO policies: the anon/authenticated
-- roles get zero access to them. Only the service_role key (used exclusively by api/telegram.ts,
-- never shipped to the browser) can read/write them, since service_role bypasses RLS.

-- Auto-create a profile row whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Lets a logged-in web user redeem a code the bot generated, linking their Telegram chat
-- to their account, without ever exposing telegram_link_codes to the client directly.
create or replace function link_telegram(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chat bigint;
begin
  select telegram_chat_id into v_chat
  from telegram_link_codes
  where code = p_code and created_at > now() - interval '10 minutes';

  if v_chat is null then
    return false;
  end if;

  update profiles set telegram_user_id = v_chat where id = auth.uid();
  delete from telegram_link_codes where code = p_code;
  return true;
end;
$$;
grant execute on function link_telegram(text) to authenticated;
