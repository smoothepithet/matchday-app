-- Kids Football Team Stats — Database Schema
-- Designed for Supabase (Postgres), but plain Postgres works too.

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  squad_number int,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  opposition text not null,
  match_date date not null,
  venue text check (venue in ('home', 'away')) not null,
  competition text,                 -- e.g. "League", "Cup", "Friendly"
  our_score int not null default 0,
  their_score int not null default 0,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'completed')),
  created_at timestamptz not null default now()
);

-- One row per notable moment: goal, assist, save, and optionally
-- cards / substitutions later if you want to extend it.
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  player_id uuid references players(id) on delete set null,
  event_type text not null
    check (event_type in ('goal', 'assist', 'save', 'own_goal')),
  minute int,                       -- optional, nice for the report
  created_at timestamptz not null default now()
);

-- Handy view: season stats per player, computed on the fly
create or replace view player_season_stats as
select
  p.id as player_id,
  p.name,
  p.squad_number,
  count(*) filter (where e.event_type = 'goal')   as goals,
  count(*) filter (where e.event_type = 'assist') as assists,
  count(*) filter (where e.event_type = 'save')   as saves,
  count(distinct e.match_id)                      as appearances
from players p
left join events e on e.player_id = p.id
group by p.id, p.name
order by goals desc, assists desc;

-- Handy view: results log
create or replace view results_log as
select
  id,
  match_date,
  opposition,
  venue,
  competition,
  our_score,
  their_score,
  case
    when our_score > their_score then 'W'
    when our_score < their_score then 'L'
    else 'D'
  end as result
from matches
where status = 'completed'
order by match_date desc;

-- Row Level Security — single shared coach account, no per-row ownership
-- model, so policies just gate on being a signed-in (authenticated) session.
alter table players enable row level security;
alter table matches enable row level security;
alter table events  enable row level security;

drop policy if exists "allow all for now" on players;
drop policy if exists "allow all for now" on matches;
drop policy if exists "allow all for now" on events;
drop policy if exists "authenticated full access" on players;
drop policy if exists "authenticated full access" on matches;
drop policy if exists "authenticated full access" on events;

create policy "authenticated full access" on players
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on matches
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on events
  for all to authenticated using (true) with check (true);

-- Base table/view privileges — RLS only takes effect once a role has
-- some grant; conversely, revoking the grant blocks anon before RLS
-- policies are even consulted (defense in depth). The anon key stays
-- public in the client JS, but by itself it can no longer read or
-- write anything — only a real signed-in session (via Supabase Auth)
-- can, which is the actual security boundary.
revoke all on players, matches, events from anon;
revoke all on player_season_stats, results_log from anon;
revoke usage on schema public from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on players, matches, events to authenticated;
grant select on player_season_stats, results_log to authenticated;
