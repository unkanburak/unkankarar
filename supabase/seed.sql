insert into groups (slug, name)
values ('unkan', 'UNKAN')
on conflict (slug) do update set name = excluded.name;

with group_row as (select id from groups where slug = 'unkan')
insert into members (id, group_id, name, initials, role, invite_token_hash)
select * from (values
  ('member_burak', (select id from group_row), 'Burak', 'BU', 'ADMIN', encode(digest('a8Fc29Lp', 'sha256'), 'hex')),
  ('member_emin', (select id from group_row), 'Emin', 'EM', 'MEMBER', encode(digest('e7Km41Qx', 'sha256'), 'hex')),
  ('member_furkan', (select id from group_row), 'Furkan', 'FU', 'MEMBER', encode(digest('f3Tn82Vz', 'sha256'), 'hex')),
  ('member_erkut', (select id from group_row), 'Erkut', 'ER', 'MEMBER', encode(digest('r6Hy19Md', 'sha256'), 'hex')),
  ('member_kubra', (select id from group_row), 'Kübra', 'KÜ', 'MEMBER', encode(digest('k9Pb53Ls', 'sha256'), 'hex')),
  ('member_buse', (select id from group_row), 'Buse', 'BU', 'MEMBER', encode(digest('b2Nx74Rw', 'sha256'), 'hex')),
  ('member_beyza', (select id from group_row), 'Beyza', 'BE', 'MEMBER', encode(digest('z5Qc68Va', 'sha256'), 'hex')),
  ('member_kerim', (select id from group_row), 'Kerim', 'KE', 'MEMBER', encode(digest('c4Jm27Tk', 'sha256'), 'hex'))
) as seed(id, group_id, name, initials, role, invite_token_hash)
on conflict (id) do update set
  name = excluded.name,
  initials = excluded.initials,
  role = excluded.role,
  invite_token_hash = excluded.invite_token_hash;

insert into events (id, group_id, prompt, option_source, planning_mode, category, state, options, client_key, client_state, created_by)
select '11111111-1111-1111-1111-111111111111', id, 'The Thing mi oyun mu?', 'manual', 'decision', 'Oyun', 'WAITING_FOR_8', '["The Thing", "Among Us", "Goose Goose Duck", "Discord muhabbet"]'::jsonb, '11111111-1111-1111-1111-111111111111', jsonb_build_object(
  'id', '11111111-1111-1111-1111-111111111111',
  'prompt', 'The Thing mi oyun mu?',
  'optionSource', 'manual',
  'planningMode', 'decision',
  'category', 'Oyun',
  'options', jsonb_build_array('The Thing', 'Among Us', 'Goose Goose Duck', 'Discord muhabbet'),
  'phase', 'lobby',
  'joined', jsonb_build_array(),
  'ideas', jsonb_build_array(),
  'ideasRevealed', false,
  'votes', jsonb_build_object(),
  'voteRound', 1,
  'createdAt', now()
), 'member_burak'
from groups where slug = 'unkan'
on conflict (id) do update set client_key = excluded.client_key, client_state = excluded.client_state;
