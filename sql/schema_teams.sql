-- schema_teams.sql  (run AFTER schema.sql and schema_terminal.sql)
-- Admin opens a "round" (size + deadline + optional checkpoint). Members create teams, request to join, or invite.
-- One active team per member (DB-enforced). Admin can dissolve everything and open a new round; history is kept.

create table team_rounds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team_size int not null check (team_size between 2 and 10),
  closes_at timestamptz,                                   -- null = open until admin closes it
  status text not null default 'open' check (status in ('open','closed','dissolved')),
  checkpoint_activity_id uuid references activities on delete set null,  -- UI prompts "form a team" at this activity
  created_at timestamptz default now()
);
create unique index only_one_open_round on team_rounds (status) where status = 'open';

alter table teams
  add column round_id uuid references team_rounds on delete cascade,
  add column leader_id uuid references profiles on delete set null,
  add column repo_url text,
  add column status text not null default 'active' check (status in ('active','dissolved'));
create unique index team_name_per_round on teams (round_id, lower(name)) where status = 'active';

alter table team_members add column active boolean not null default true, add column joined_at timestamptz default now();
create unique index one_active_team_per_member on team_members (user_id) where active;   -- the one-team rule

create table team_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  direction text not null check (direction in ('request','invite')),   -- request: member asks team / invite: team asks member
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz default now()
);
create unique index one_pending_request on team_requests (team_id, user_id) where status = 'pending';

create table team_tasks (                                   -- an activity assigned to every team in a round
  round_id uuid references team_rounds on delete cascade,
  activity_id uuid references activities on delete cascade,
  due_at timestamptz,
  primary key (round_id, activity_id)
);
create table team_links (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  user_id uuid references profiles on delete set null,
  label text, url text not null check (url ~ '^https?://'),
  created_at timestamptz default now()
);

-- ---------- helpers ----------
create or replace function is_team_member(p_team uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid() and active); $$;
create or replace function is_team_leader(p_team uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where id = p_team and leader_id = auth.uid()); $$;
create or replace function round_is_open(p_round uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_rounds where id = p_round and status = 'open' and (closes_at is null or now() < closes_at)); $$;
create or replace function team_count(p_team uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from team_members where team_id = p_team and active; $$;
create or replace function user_has_team(p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where user_id = p_user and active); $$;
create or replace function notify(p_user uuid, p_kind text, p_body text) returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, body) values (p_user, p_kind, p_body); $$;

-- ---------- member actions (all rules enforced here, not in the UI) ----------
create or replace function create_team(p_name text) returns uuid language plpgsql security definer set search_path = public as $$
declare r team_rounds; tid uuid;
begin
  select * into r from team_rounds where status = 'open' and (closes_at is null or now() < closes_at);
  if not found then raise exception 'team formation is not open'; end if;
  if not exists (select 1 from profiles where id = auth.uid() and role = 'member') then raise exception 'members only'; end if;
  if user_has_team(auth.uid()) then raise exception 'you are already in a team'; end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'give your team a name'; end if;
  insert into teams (name, round_id, leader_id) values (trim(p_name), r.id, auth.uid()) returning id into tid;
  insert into team_members (team_id, user_id) values (tid, auth.uid());
  return tid;
end $$;

create or replace function request_join(p_team uuid) returns void language plpgsql security definer set search_path = public as $$
declare t teams;
begin
  select * into t from teams where id = p_team and status = 'active';
  if not found or not round_is_open(t.round_id) then raise exception 'team formation is not open'; end if;
  if user_has_team(auth.uid()) then raise exception 'you are already in a team'; end if;
  if team_count(p_team) >= (select team_size from team_rounds where id = t.round_id) then raise exception 'that team is full'; end if;
  insert into team_requests (team_id, user_id, direction) values (p_team, auth.uid(), 'request');
  perform notify(t.leader_id, 'team_request', 'Someone asked to join ' || t.name);
end $$;

create or replace function invite_member(p_team uuid, p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare t teams;
begin
  select * into t from teams where id = p_team and status = 'active';
  if not found or not is_team_leader(p_team) then raise exception 'only the team leader can invite'; end if;
  if not round_is_open(t.round_id) then raise exception 'team formation is not open'; end if;
  if user_has_team(p_user) then raise exception 'that member already has a team'; end if;
  if not exists (select 1 from profiles where id = p_user and role = 'member') then raise exception 'unknown member'; end if;
  if team_count(p_team) >= (select team_size from team_rounds where id = t.round_id) then raise exception 'your team is full'; end if;
  insert into team_requests (team_id, user_id, direction) values (p_team, p_user, 'invite');
  perform notify(p_user, 'team_invite', 'You were invited to join ' || t.name);
end $$;

-- request: the team leader decides. invite: the invited member decides.
create or replace function respond_request(p_id uuid, p_accept boolean) returns void language plpgsql security definer set search_path = public as $$
declare q team_requests; t teams; other uuid;
begin
  select * into q from team_requests where id = p_id and status = 'pending' for update;
  if not found then raise exception 'request is no longer pending'; end if;
  select * into t from teams where id = q.team_id;
  if q.direction = 'request' then
    if not is_team_leader(t.id) then raise exception 'only the team leader can respond'; end if;
    other := q.user_id;
  else
    if q.user_id <> auth.uid() then raise exception 'this invitation is not yours'; end if;
    other := t.leader_id;
  end if;
  if not p_accept then
    update team_requests set status = 'declined' where id = p_id;
    perform notify(other, 'team_declined', 'A team request for ' || t.name || ' was declined.');
    return;
  end if;
  if not round_is_open(t.round_id) then raise exception 'team formation is closed'; end if;
  if team_count(t.id) >= (select team_size from team_rounds where id = t.round_id) then raise exception 'team is full'; end if;
  if user_has_team(q.user_id) then raise exception 'that member already joined a team'; end if;
  insert into team_members (team_id, user_id) values (t.id, q.user_id);
  update team_requests set status = 'accepted' where id = p_id;
  update team_requests set status = 'cancelled' where user_id = q.user_id and status = 'pending' and id <> p_id;
  perform notify(other, 'team_joined', 'Welcome to ' || t.name || '.');
end $$;

create or replace function leave_team() returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; t teams;
begin
  select team_id into tid from team_members where user_id = auth.uid() and active;
  if tid is null then raise exception 'you are not in a team'; end if;
  select * into t from teams where id = tid;
  if not round_is_open(t.round_id) then raise exception 'teams are locked; ask an admin'; end if;
  delete from team_members where team_id = tid and user_id = auth.uid();
  if team_count(tid) = 0 then update teams set status = 'dissolved' where id = tid;
  elsif t.leader_id = auth.uid() then
    update teams set leader_id = (select user_id from team_members where team_id = tid and active order by joined_at limit 1) where id = tid;
  end if;
end $$;

create or replace function set_team_repo(p_team uuid, p_url text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_team_member(p_team) then raise exception 'not your team'; end if;
  if p_url !~ '^https?://' then raise exception 'a valid URL is required'; end if;
  update teams set repo_url = p_url where id = p_team;
end $$;

create or replace function add_team_link(p_team uuid, p_url text, p_label text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_team_member(p_team) then raise exception 'not your team'; end if;
  insert into team_links (team_id, user_id, label, url) values (p_team, auth.uid(), p_label, p_url);
end $$;

-- Browse teams while a round is open (names and counts only).
create or replace function team_directory() returns table (team_id uuid, name text, leader_name text, members int, size int, open_spots int)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, p.full_name, team_count(t.id), r.team_size, r.team_size - team_count(t.id)
  from teams t join team_rounds r on r.id = t.round_id left join profiles p on p.id = t.leader_id
  where r.status = 'open' and t.status = 'active' and auth.uid() is not null;
$$;
create or replace function free_members() returns table (id uuid, full_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.avatar_url from profiles p
  where p.role = 'member' and not user_has_team(p.id) and auth.uid() is not null
    and exists (select 1 from team_rounds where status = 'open');
$$;

-- Team stats page data: progress on assigned tasks, members, links. Teammates and admins only.
create or replace function team_stats(p_team uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not (is_admin() or is_team_member(p_team)) then raise exception 'not your team'; end if;
  select jsonb_build_object(
    'team', jsonb_build_object('id', t.id, 'name', t.name, 'repo_url', t.repo_url, 'status', t.status),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'avatar', p.avatar_url, 'github', p.github_url, 'leader', p.id = t.leader_id,
        'points', (select coalesce(sum(e.points),0) from point_events e where e.user_id = p.id),
        'steps_done', (select count(*) from step_progress sp join steps s on s.id = sp.step_id
                       join team_tasks tt on tt.activity_id = s.activity_id and tt.round_id = t.round_id
                       where sp.user_id = p.id and sp.status = 'completed' and not s.archived)))
      from team_members m join profiles p on p.id = m.user_id where m.team_id = t.id and m.active), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
        'activity', a.title, 'due', tt.due_at,
        'steps_total', (select count(*) from steps s where s.activity_id = a.id and not s.archived),
        'steps_done_by_team', (select count(*) from step_progress sp join steps s on s.id = sp.step_id
                               where s.activity_id = a.id and not s.archived and sp.status = 'completed'
                                 and sp.user_id in (select user_id from team_members where team_id = t.id and active))))
      from team_tasks tt join activities a on a.id = tt.activity_id where tt.round_id = t.round_id), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_build_object('label', l.label, 'url', l.url, 'by', pr.full_name) order by l.created_at desc)
      from team_links l left join profiles pr on pr.id = l.user_id where l.team_id = t.id), '[]'::jsonb)
  ) into out from teams t where t.id = p_team;
  return out;
end $$;

-- ---------- admin console ops (called by apply_commands for any op it does not own) ----------
create or replace function t_member(p_ref text) returns uuid language plpgsql stable security definer set search_path = public as $$
declare ids uuid[];
begin
  select array_agg(p.id) into ids from profiles p join auth.users u on u.id = p.id
   where lower(p.full_name) = lower(p_ref) or lower(u.email) = lower(p_ref);
  if ids is null then raise exception 'member "%" not found', p_ref; end if;
  if array_length(ids,1) > 1 then raise exception 'member "%" is ambiguous: use their email', p_ref; end if;
  return ids[1];
end $$;
create or replace function t_team(p_name text) returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  select id into tid from teams where lower(name) = lower(p_name) and status = 'active';
  if tid is null then raise exception 'team "%" not found', p_name; end if;
  return tid;
end $$;
create or replace function t_round() returns team_rounds language plpgsql stable security definer set search_path = public as $$
declare r team_rounds;
begin
  select * into r from team_rounds where status in ('open','closed') order by created_at desc limit 1;
  if not found then raise exception 'no active team round: run teams open first'; end if;
  return r;
end $$;

create or replace function team_op(c jsonb) returns text language plpgsql security definer set search_path = public as $$
declare op text := c->>'op'; r team_rounds; tid uuid; uid uuid; m record; n int := 0; sz int;
begin
  if not is_admin() then raise exception 'admin only'; end if;

  if op = 'teams_open' then
    if exists (select 1 from team_rounds where status = 'open') then raise exception 'a round is already open: run "teams close" first'; end if;
    -- deadline = end of the given day, India time. Change the zone here if your circle is elsewhere.
    insert into team_rounds (name, team_size, closes_at, checkpoint_activity_id)
    values (coalesce(c->>'name','Team round'), coalesce((c->>'size')::int, 3),
            case when c->>'until' is not null then (((c->>'until')::date + 1)::timestamp at time zone 'Asia/Kolkata') end,
            case when c->>'checkpoint' is not null then t_activity(c->>'checkpoint') end);
    insert into notifications (user_id, kind, body)
      select id, 'teams_open', format('Team formation is open: teams of %s.', coalesce(c->>'size','3')) from profiles where role = 'member';
    return format('+ team round "%s" opened', coalesce(c->>'name','Team round'));

  elsif op = 'teams_close' then
    update team_rounds set status = 'closed' where status = 'open';
    update team_requests set status = 'cancelled' where status = 'pending';
    return '- team formation closed (teams stay)';

  elsif op = 'teams_dissolve' then
    update teams set status = 'dissolved' where status = 'active';
    update team_members set active = false where active;
    update team_requests set status = 'cancelled' where status = 'pending';
    update team_rounds set status = 'dissolved' where status <> 'dissolved';
    return 'x all teams dissolved (history kept)';

  elsif op = 'team_create' then
    r := t_round();
    insert into teams (name, round_id) values (c->>'team', r.id);
    return format('+ team "%s"', c->>'team');

  elsif op = 'team_assign' then
    uid := t_member(c->>'member'); tid := t_team(c->>'team');
    if user_has_team(uid) then raise exception '"%" is already in a team', c->>'member'; end if;
    insert into team_members (team_id, user_id) values (tid, uid);
    update teams set leader_id = coalesce(leader_id, uid) where id = tid;
    return format('+ "%s" -> "%s"', c->>'member', c->>'team');

  elsif op = 'team_remove' then
    uid := t_member(c->>'member');
    select team_id into tid from team_members where user_id = uid and active;
    if tid is null then raise exception '"%" has no team', c->>'member'; end if;
    delete from team_members where user_id = uid and team_id = tid;
    update teams set leader_id = (select user_id from team_members where team_id = tid and active order by joined_at limit 1)
      where id = tid and leader_id = uid;
    if team_count(tid) = 0 then update teams set status = 'dissolved' where id = tid; end if;
    return format('- removed "%s" from their team', c->>'member');

  elsif op = 'teams_autoform' then   -- places everyone still without a team, fullest-open-team first, new teams as needed
    r := t_round(); sz := r.team_size;
    for m in select id from profiles where role = 'member' and not user_has_team(id) order by random() loop
      select t.id into tid from teams t where t.round_id = r.id and t.status = 'active' and team_count(t.id) < sz
        order by team_count(t.id) desc limit 1;
      if tid is null then
        insert into teams (name, round_id, leader_id)
          values (format('Team %s', (select count(*) + 1 from teams where round_id = r.id)), r.id, m.id) returning id into tid;
      end if;
      insert into team_members (team_id, user_id) values (tid, m.id);
      update teams set leader_id = coalesce(leader_id, m.id) where id = tid;
      n := n + 1;
    end loop;
    return format('+ auto-placed %s member(s)', n);

  elsif op = 'task_assign' then
    r := t_round();
    insert into team_tasks (round_id, activity_id, due_at)
    values (r.id, t_activity(c->>'match'), case when c->>'due' is not null then (((c->>'due')::date + 1)::timestamp at time zone 'Asia/Kolkata') end)
    on conflict (round_id, activity_id) do update set due_at = excluded.due_at;
    return format('+ team task "%s"', c->>'match');

  else
    raise exception 'unknown command "%"', op;
  end if;
end $$;

-- ---------- RLS ----------
drop policy if exists teams_read on teams;
drop policy if exists tm_read on team_members;
alter table team_rounds enable row level security;
alter table team_requests enable row level security;
alter table team_tasks enable row level security;
alter table team_links enable row level security;

create policy rounds_read on team_rounds for select to authenticated using (true);
create policy rounds_admin on team_rounds for all using (is_admin()) with check (is_admin());
create policy teams_read on teams for select to authenticated using (status = 'active' or is_admin() or is_team_member(id));
create policy tm_read on team_members for select using (is_team_member(team_id) or user_id = auth.uid() or is_admin());
create policy req_read on team_requests for select using (user_id = auth.uid() or is_team_leader(team_id) or is_admin());
create policy req_admin on team_requests for all using (is_admin()) with check (is_admin());
create policy tasks_read on team_tasks for select to authenticated using (true);
create policy tasks_admin on team_tasks for all using (is_admin()) with check (is_admin());
create policy links_read on team_links for select using (is_team_member(team_id) or is_admin());
create policy links_admin on team_links for all using (is_admin()) with check (is_admin());
-- No member INSERT/UPDATE policies on any team table: every member write goes through the functions above.
