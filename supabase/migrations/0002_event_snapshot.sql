alter table events add column if not exists client_key text;
alter table events add column if not exists client_state jsonb;

create unique index if not exists events_client_key_idx on events(client_key) where client_key is not null;
create index if not exists events_group_created_idx on events(group_id, created_at desc);

-- The browser currently sends one complete event snapshot. Keeping that snapshot
-- here makes the first production deployment durable while the normalized tables
-- remain available for later reporting and history queries.
