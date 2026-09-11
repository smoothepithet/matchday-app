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

-- Weekly/monthly award records. Not tied to a specific match - the two
-- "Player of the Match" awards are actually decided weekly on the
-- strength of both weekend matches combined, same cadence as the
-- training award, so period_date is just "which week/month this
-- represents" rather than a match reference.
create table if not exists awards (
  id uuid primary key default gen_random_uuid(),
  award_type text not null
    check (award_type in ('training_potw', 'managers_potw', 'parents_potw', 'player_of_month')),
  player_id uuid not null references players(id) on delete cascade,
  period_date date not null,        -- week-ending date for the three weekly
                                     -- awards; first of the month for player_of_month
  notes text,
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

-- Handy view: award history with player names, for the dashboard
create or replace view season_awards as
select
  a.id,
  a.award_type,
  a.period_date,
  a.notes,
  p.name as player_name,
  p.squad_number,
  a.created_at
from awards a
join players p on p.id = a.player_id
order by a.period_date desc, a.created_at desc;

-- Row Level Security — single shared coach account, no per-row ownership
-- model, so policies just gate on being a signed-in (authenticated) session.
alter table players enable row level security;
alter table matches enable row level security;
alter table events  enable row level security;
alter table awards  enable row level security;

drop policy if exists "allow all for now" on players;
drop policy if exists "allow all for now" on matches;
drop policy if exists "allow all for now" on events;
drop policy if exists "authenticated full access" on players;
drop policy if exists "authenticated full access" on matches;
drop policy if exists "authenticated full access" on events;
drop policy if exists "authenticated full access" on awards;

create policy "authenticated full access" on players
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on matches
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on events
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on awards
  for all to authenticated using (true) with check (true);

-- Base table/view privileges — RLS only takes effect once a role has
-- some grant; conversely, revoking the grant blocks anon before RLS
-- policies are even consulted (defense in depth). The anon key stays
-- public in the client JS, but by itself it can no longer read or
-- write anything — only a real signed-in session (via Supabase Auth)
-- can, which is the actual security boundary.
revoke all on players, matches, events, awards from anon;
revoke all on player_season_stats, results_log, season_awards from anon;
revoke usage on schema public from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on players, matches, events, awards to authenticated;
grant select on player_season_stats, results_log, season_awards to authenticated;
