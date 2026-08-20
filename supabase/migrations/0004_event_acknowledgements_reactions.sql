create table if not exists event_acknowledgements (
  event_id uuid not null references events(id) on delete cascade,
  member_id text not null references members(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (event_id, member_id)
);

create table if not exists event_reactions (
  event_id uuid not null references events(id) on delete cascade,
  member_id text not null references members(id) on delete cascade,
  reaction text not null check (reaction in ('HAHA', 'İYİ SEÇİM', 'GEÇMİŞ OLSUN', 'BEN VARIM')),
  updated_at timestamptz not null default now(),
  primary key (event_id, member_id)
);

create index if not exists event_ack_event_idx on event_acknowledgements(event_id);
create index if not exists event_reactions_event_idx on event_reactions(event_id);

alter table event_acknowledgements enable row level security;
alter table event_reactions enable row level security;

-- All writes and reads go through the authenticated server route.
