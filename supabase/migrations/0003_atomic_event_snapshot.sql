-- Concurrent browsers can submit complete snapshots at the same time.
-- Lock the event row and merge member-owned collections inside PostgreSQL so
-- one participant cannot overwrite another participant's latest input.
create or replace function public.merge_event_snapshot(
  p_group_id uuid,
  p_client_key text,
  p_incoming jsonb,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  existing_state jsonb;
  merged jsonb;
begin
  select id, client_state
    into existing_id, existing_state
    from public.events
   where group_id = p_group_id
     and client_key = p_client_key
   for update;

  merged := coalesce(existing_state, '{}'::jsonb) || p_incoming;

  -- Arrays and per-member maps must be unioned, not replaced.
  merged := jsonb_set(
    merged,
    '{joined}',
    (
      select coalesce(jsonb_agg(to_jsonb(member_id) order by member_id), '[]'::jsonb)
        from (
          select distinct value as member_id
            from jsonb_array_elements_text(
              coalesce(existing_state -> 'joined', '[]'::jsonb)
              || coalesce(p_incoming -> 'joined', '[]'::jsonb)
            )
        ) members
    ),
    true
  );

  if existing_state ? 'ideas' or p_incoming ? 'ideas' then
    merged := jsonb_set(
      merged,
      '{ideas}',
      (
        select coalesce(jsonb_agg(idea order by idea ->> 'id'), '[]'::jsonb)
          from (
            select distinct on (idea ->> 'id') idea
              from jsonb_array_elements(
                coalesce(existing_state -> 'ideas', '[]'::jsonb)
                || coalesce(p_incoming -> 'ideas', '[]'::jsonb)
              ) idea
             where coalesce(idea ->> 'id', '') <> ''
             order by idea ->> 'id'
          ) ideas
      ),
      true
    );
  end if;

  if existing_state ? 'placeIdeas' or p_incoming ? 'placeIdeas' then
    merged := jsonb_set(
      merged,
      '{placeIdeas}',
      (
        select coalesce(jsonb_agg(idea order by idea ->> 'id'), '[]'::jsonb)
          from (
            select distinct on (idea ->> 'id') idea
              from jsonb_array_elements(
                coalesce(existing_state -> 'placeIdeas', '[]'::jsonb)
                || coalesce(p_incoming -> 'placeIdeas', '[]'::jsonb)
              ) idea
             where coalesce(idea ->> 'id', '') <> ''
             order by idea ->> 'id'
          ) ideas
      ),
      true
    );
  end if;

  if existing_state ? 'votes' or p_incoming ? 'votes' then
    merged := jsonb_set(merged, '{votes}', coalesce(existing_state -> 'votes', '{}'::jsonb) || coalesce(p_incoming -> 'votes', '{}'::jsonb), true);
  end if;
  if existing_state ? 'placeVotes' or p_incoming ? 'placeVotes' then
    merged := jsonb_set(merged, '{placeVotes}', coalesce(existing_state -> 'placeVotes', '{}'::jsonb) || coalesce(p_incoming -> 'placeVotes', '{}'::jsonb), true);
  end if;

  if existing_state ? 'schedule' or p_incoming ? 'schedule' then
    merged := jsonb_set(
      merged,
      '{schedule}',
      coalesce(existing_state -> 'schedule', '{}'::jsonb)
      || coalesce(p_incoming -> 'schedule', '{}'::jsonb),
      true
    );
    merged := jsonb_set(merged, '{schedule,availability}', coalesce(existing_state #> '{schedule,availability}', '{}'::jsonb) || coalesce(p_incoming #> '{schedule,availability}', '{}'::jsonb), true);
    merged := jsonb_set(merged, '{schedule,time}', coalesce(existing_state #> '{schedule,time}', '{}'::jsonb) || coalesce(p_incoming #> '{schedule,time}', '{}'::jsonb), true);
    merged := jsonb_set(merged, '{schedule,timeVotes}', coalesce(existing_state #> '{schedule,timeVotes}', '{}'::jsonb) || coalesce(p_incoming #> '{schedule,timeVotes}', '{}'::jsonb), true);
  end if;

  if existing_id is null then
    insert into public.events (
      group_id, prompt, option_source, planning_mode, category, state,
      options, winner_id, organizer_id, organizer_message, round_ends_at,
      vote_round, created_by, locked_at, client_key, client_state
    ) values (
      p_group_id,
      coalesce(merged ->> 'prompt', 'Bu gece ne yapıyoruz?'),
      coalesce(merged ->> 'optionSource', 'crowd'),
      coalesce(merged ->> 'planningMode', 'decision'),
      coalesce(merged ->> 'category', 'Özel'),
      coalesce(merged ->> 'phase', 'lobby'),
      coalesce(merged -> 'options', '[]'::jsonb),
      merged ->> 'winnerId',
      merged ->> 'organizerId',
      merged ->> 'organizerMessage',
      case when nullif(merged ->> 'roundEndsAt', '') is null then null else to_timestamp((merged ->> 'roundEndsAt')::numeric / 1000.0) end,
      coalesce((merged ->> 'voteRound')::integer, 1),
      p_actor_id,
      case when nullif(merged ->> 'lockedAt', '') is null then null else (merged ->> 'lockedAt')::timestamptz end,
      p_client_key,
      merged
    );
  else
    update public.events
       set prompt = coalesce(merged ->> 'prompt', prompt),
           option_source = coalesce(merged ->> 'optionSource', option_source),
           planning_mode = coalesce(merged ->> 'planningMode', planning_mode),
           category = coalesce(merged ->> 'category', category),
           state = coalesce(merged ->> 'phase', state),
           options = coalesce(merged -> 'options', options),
           winner_id = merged ->> 'winnerId',
           organizer_id = merged ->> 'organizerId',
           organizer_message = merged ->> 'organizerMessage',
           round_ends_at = case when nullif(merged ->> 'roundEndsAt', '') is null then null else to_timestamp((merged ->> 'roundEndsAt')::numeric / 1000.0) end,
           vote_round = coalesce((merged ->> 'voteRound')::integer, vote_round),
           locked_at = case when nullif(merged ->> 'lockedAt', '') is null then null else (merged ->> 'lockedAt')::timestamptz end,
           client_state = merged
     where id = existing_id;
  end if;

  return merged;
end;
$$;
