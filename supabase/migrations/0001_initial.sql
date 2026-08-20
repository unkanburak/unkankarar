create extension if not exists pgcrypto;

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null default 'UNKAN',
  created_at timestamptz not null default now()
);

create table if not exists members (
  id text primary key,
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  initials text not null,
  role text not null check (role in ('ADMIN', 'MEMBER')),
  invite_token_hash text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists member_sessions (
  id uuid primary key default gen_random_uuid(),
  member_id text not null references members(id) on delete cascade,
  session_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  prompt text not null,
  option_source text not null check (option_source in ('crowd', 'manual')),
  planning_mode text not null check (planning_mode in ('decision', 'schedule')),
  category text not null,
  state text not null default 'WAITING_FOR_8',
  options jsonb not null default '[]'::jsonb,
  winner_id text,
  organizer_id text references members(id),
  organizer_message text,
  round_ends_at timestamptz,
  vote_round integer not null default 1,
  created_by text not null references members(id),
  created_at timestamptz not null default now(),
  locked_at timestamptz
);

create table if not exists event_joins (
  event_id uuid not null references events(id) on delete cascade,
  member_id text not null references members(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (event_id, member_id)
);

create table if not exists event_members (
  event_id uuid not null references events(id) on delete cascade,
  member_id text not null references members(id) on delete cascade,
  snapshot_name text not null,
  primary key (event_id, member_id)
);

create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  author_id text not null references members(id),
  body text not null check (char_length(body) between 1 and 120),
  created_at timestamptz not null default now(),
  revealed_at timestamptz
);

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  round integer not null default 1,
  member_id text not null references members(id),
  option_id text not null,
  created_at timestamptz not null default now(),
  unique (event_id, round, member_id, option_id)
);

create table if not exists availability (
  event_id uuid not null references events(id) on delete cascade,
  member_id text not null references members(id),
  day text not null,
  created_at timestamptz not null default now(),
  primary key (event_id, member_id, day)
);

create table if not exists time_availability (
  event_id uuid not null references events(id) on delete cascade,
  member_id text not null references members(id),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  primary key (event_id, member_id),
  check (end_time > start_time)
);

create table if not exists organizer_history (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  member_id text not null references members(id),
  selected_at timestamptz not null default now()
);

create table if not exists event_tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  label text not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists decision_history (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  action text not null,
  actor_id text references members(id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists idea_pool (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  body text not null,
  author_id text not null references members(id),
  category text,
  times_nominated integer not null default 0,
  times_won integer not null default 0,
  times_realized integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists event_joins_event_idx on event_joins(event_id);
create index if not exists votes_event_round_idx on votes(event_id, round);
create index if not exists decision_history_event_idx on decision_history(event_id, created_at desc);

alter table groups enable row level security;
alter table members enable row level security;
alter table member_sessions enable row level security;
alter table events enable row level security;
alter table event_joins enable row level security;
alter table event_members enable row level security;
alter table ideas enable row level security;
alter table votes enable row level security;
alter table availability enable row level security;
alter table time_availability enable row level security;
alter table organizer_history enable row level security;
alter table event_tasks enable row level security;
alter table decision_history enable row level security;
alter table idea_pool enable row level security;

-- All writes are performed by server routes with the Supabase service role.
-- The service role bypasses RLS; no anonymous client policy is intentionally added.
