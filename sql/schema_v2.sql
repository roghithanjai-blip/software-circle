-- schema_v2.sql
-- Run ONCE after schema.sql, schema_terminal.sql and schema_teams.sql. Safe to re-run.
-- Adds: roadmaps with a deploy switch, editable roles, onboarding fields, login log, groups, tasks, circle directory, avatars.

-- =====================================================================
-- 1. Roles (labels). Permissions still come from profiles.role = 'admin'.
-- =====================================================================
create table if not exists roles (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label text not null,
  rank int not null default 50,              -- order in the Circle panel
  shows_in_circle boolean not null default true,
  is_system boolean not null default false
);
insert into roles (key, label, rank, is_system) values
  ('lead','Lead',1,true), ('manager','Manager',2,true), ('member','Member',3,true),
  ('probationer','Probationer',4,true), ('former_member','Former member',9,true)
on conflict (key) do nothing;

alter table profiles
  add column if not exists role_key text not null default 'member' references roles(key),
  add column if not exists active boolean not null default true,
  add column if not exists roll_no text,
  add column if not exists mobile text,
  add column if not exists college_email text,
  add column if not exists year_of_study int,
  add column if not exists linkedin_url text,
  add column if not exists onboarded_at timestamptz;
-- avatar_url holds the storage path (<user_id>/<file>) in the public 'avatars' bucket.

alter table profiles
  drop constraint if exists profiles_mobile_chk, drop constraint if exists profiles_year_chk,
  drop constraint if exists profiles_linkedin_chk, drop constraint if exists profiles_github_chk, drop constraint if exists profiles_cemail_chk;
alter table profiles
  add constraint profiles_mobile_chk check (mobile is null or mobile ~ '^[0-9]{10}$'),
  add constraint profiles_year_chk check (year_of_study is null or year_of_study between 1 and 6),
  add constraint profiles_linkedin_chk check (linkedin_url is null or linkedin_url ~* '^https?://'),
  add constraint profiles_github_chk check (github_url is null or github_url ~* '^https?://'),
  add constraint profiles_cemail_chk check (college_email is null or college_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Members may not change roles, access or the onboarding flag. save_profile() sets a transaction flag to pass this guard.
create or replace function protect_role() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not is_admin() and coalesce(current_setting('app.profile_rpc', true), '') <> '1' then
    if new.role is distinct from old.role or new.role_key is distinct from old.role_key
       or new.active is distinct from old.active or new.onboarded_at is distinct from old.onboarded_at then
      raise exception 'only an admin can change roles or access';
    end if;
  end if;
  if new.role_key = 'former_member' then new.active := false;
  elsif old.role_key = 'former_member' and new.role_key <> 'former_member' then new.active := true; end if;
  return new;
end $$;

update profiles set onboarded_at = now() where role = 'admin' and onboarded_at is null;   -- admins skip onboarding

-- =====================================================================
-- 2. Roadmaps (the "courses") above phases, with a deploy gate
-- =====================================================================
create table if not exists roadmaps (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  title text not null,
  summary text, icon text,
  curator_name text, curator_title text,
  curator_link text check (curator_link is null or curator_link ~* '^https?://'),
  est_duration text,
  audience text[] not null default '{}',     -- role keys; empty = everyone
  deployed boolean not null default false,
  deployed_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz default now()
);
create unique index if not exists roadmap_title_unique on roadmaps (lower(title)) where not archived;

alter table phases add column if not exists roadmap_id uuid references roadmaps on delete cascade;
create index if not exists phases_roadmap on phases (roadmap_id, position);

-- Existing phases become the "Probation" roadmap, deployed so nothing disappears for members.
insert into roadmaps (position, title, summary, curator_name, deployed, deployed_at)
select 1, 'Probation', 'Your first steps in the circle.', 'Circle admins', true, now()
where not exists (select 1 from roadmaps);
update phases set roadmap_id = (select id from roadmaps order by position, created_at limit 1) where roadmap_id is null;

-- Until every writer names a roadmap, new phases fall into the first one.
create or replace function phase_default_roadmap() returns trigger language plpgsql as $$
begin
  if new.roadmap_id is null then
    new.roadmap_id := (select id from roadmaps where not archived order by position, created_at limit 1);
  end if;
  return new;
end $$;
drop trigger if exists phases_default_roadmap on phases;
create trigger phases_default_roadmap before insert on phases for each row execute function phase_default_roadmap();

-- Content inside a roadmap goes live when the roadmap is deployed, so new items default to published.
alter table phases alter column status set default 'published', alter column visible set default true;
alter table activities alter column status set default 'published';

create or replace function my_role_key() returns text language sql stable security definer set search_path = public as $$
  select role_key from profiles where id = auth.uid(); $$;
create or replace function is_active_user() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active from profiles where id = auth.uid()), false); $$;

create or replace function roadmap_visible(p_roadmap uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from roadmaps r where r.id = p_roadmap and r.deployed and not r.archived and is_active_user()
                 and (cardinality(r.audience) = 0 or my_role_key() = any (r.audience))); $$;
create or replace function phase_visible(p_phase uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from phases p where p.id = p_phase and p.status = 'published' and p.visible
                 and p.roadmap_id is not null and roadmap_visible(p.roadmap_id)); $$;
create or replace function step_is_visible(p_step uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from steps s join activities a on a.id = s.activity_id and a.status = 'published'
                 where s.id = p_step and not s.archived and phase_visible(a.phase_id)); $$;

alter table roadmaps enable row level security;
drop policy if exists roadmaps_admin on roadmaps;  drop policy if exists roadmaps_member on roadmaps;
create policy roadmaps_admin on roadmaps for all using (is_admin()) with check (is_admin());
create policy roadmaps_member on roadmaps for select using (roadmap_visible(id));
drop policy if exists phases_member on phases;  drop policy if exists activities_member on activities;
create policy phases_member on phases for select using (phase_visible(id));
create policy activities_member on activities for select using (status = 'published' and phase_visible(phase_id));

create or replace function on_roadmap_deploy() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deployed and not old.deployed then
    new.deployed_at := now();
    insert into notifications (user_id, kind, body)
      select id, 'roadmap_deployed', format('New roadmap: %s', new.title) from profiles
      where role = 'member' and active and (cardinality(new.audience) = 0 or role_key = any (new.audience));
  elsif not new.deployed and old.deployed then
    new.deployed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists roadmaps_deploy on roadmaps;
create trigger roadmaps_deploy before update on roadmaps for each row execute function on_roadmap_deploy();

-- =====================================================================
-- 3. Roles policies, settings, login log
-- =====================================================================
alter table roles enable row level security;
drop policy if exists roles_read on roles; drop policy if exists roles_write on roles; drop policy if exists roles_delete on roles;
create policy roles_read on roles for select to authenticated using (true);
create policy roles_write on roles for all using (is_admin()) with check (is_admin());
create policy roles_delete on roles for delete using (is_admin() and not is_system);

insert into platform_settings (key, value) values ('college_email_domain', '""'), ('max_year', '4') on conflict (key) do nothing;

create table if not exists login_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles on delete cascade,
  at timestamptz not null default now(),
  user_agent text
);
create index if not exists login_log_at on login_log (at desc);
alter table login_log enable row level security;
drop policy if exists loginlog_admin on login_log;
create policy loginlog_admin on login_log for select using (is_admin());

create or replace function log_login(p_agent text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if exists (select 1 from login_log where user_id = auth.uid() and at > now() - interval '1 minute') then return; end if;
  insert into login_log (user_id, user_agent) values (auth.uid(), left(p_agent, 200));
  update profiles set last_active_at = now() where id = auth.uid();
end $$;

-- =====================================================================
-- 4. Onboarding and profile (all validation lives here)
-- =====================================================================
create or replace function save_profile(p_full_name text, p_roll_no text, p_mobile text, p_college_email text, p_year int,
                                        p_avatar text, p_linkedin text, p_github text)
returns void language plpgsql security definer set search_path = public as $$
declare dom text; maxy int; m text; cur_avatar text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select avatar_url into cur_avatar from profiles where id = auth.uid();
  m := regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g');
  if length(m) = 12 and m like '91%' then m := substring(m from 3); end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Enter your full name'; end if;
  if length(trim(coalesce(p_roll_no, ''))) < 2 then raise exception 'Enter your college roll number'; end if;
  if m !~ '^[0-9]{10}$' then raise exception 'Enter a 10-digit mobile number'; end if;
  if coalesce(p_college_email, '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid college email'; end if;
  select coalesce(value #>> '{}', '') into dom from platform_settings where key = 'college_email_domain';
  if coalesce(dom, '') <> '' and lower(p_college_email) not like ('%@' || lower(dom)) then raise exception 'Use your college email (@%)', dom; end if;
  select coalesce((value #>> '{}')::int, 4) into maxy from platform_settings where key = 'max_year';
  if p_year is null or p_year < 1 or p_year > coalesce(maxy, 4) then raise exception 'Choose your year of study'; end if;
  if p_avatar is not null and p_avatar not like (auth.uid()::text || '/%') then raise exception 'Invalid photo'; end if;
  if cur_avatar is null and p_avatar is null then raise exception 'Add a profile photo'; end if;
  if coalesce(p_linkedin, '') <> '' and p_linkedin !~* '^https?://([a-z0-9-]+\.)*linkedin\.com/' then raise exception 'LinkedIn link must be a linkedin.com address'; end if;
  if coalesce(p_github, '') <> '' and p_github !~* '^https?://([a-z0-9-]+\.)*github\.com/' then raise exception 'GitHub link must be a github.com address'; end if;
  perform set_config('app.profile_rpc', '1', true);
  update profiles set full_name = trim(p_full_name), roll_no = trim(p_roll_no), mobile = m,
    college_email = lower(trim(p_college_email)), year_of_study = p_year, avatar_url = coalesce(p_avatar, avatar_url),
    linkedin_url = nullif(trim(p_linkedin), ''), github_url = nullif(trim(p_github), ''),
    onboarded_at = coalesce(onboarded_at, now())
  where id = auth.uid();
end $$;
-- Note: members can still update their own row directly (RLS allows it); formats are guarded by the CHECK constraints above.
-- The member app will switch to save_profile(), after which direct updates can be revoked.

-- Circle: safe fields only. Mobile, roll number and email never leave this function.
create or replace function circle_directory()
returns table (user_id uuid, full_name text, avatar_path text, role_key text, role_label text, role_rank int, year_of_study int, github_url text, linkedin_url text, active boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.avatar_url, p.role_key, r.label, r.rank, p.year_of_study, p.github_url, p.linkedin_url, p.active
  from profiles p join roles r on r.key = p.role_key
  where r.shows_in_circle and p.onboarded_at is not null and (is_active_user() or is_admin())
  order by r.rank, p.full_name; $$;

-- =====================================================================
-- 5. Admin user management
-- =====================================================================
create or replace function admin_users()
returns table (id uuid, email text, full_name text, admin_flag boolean, role_key text, active boolean, onboarded_at timestamptz,
               last_active_at timestamptz, last_login_at timestamptz, roll_no text, mobile text, college_email text,
               year_of_study int, linkedin_url text, github_url text, avatar_path text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.role = 'admin', p.role_key, p.active, p.onboarded_at, p.last_active_at,
           (select max(l.at) from login_log l where l.user_id = p.id), p.roll_no, p.mobile, p.college_email,
           p.year_of_study, p.linkedin_url, p.github_url, p.avatar_url, p.created_at
    from profiles p join auth.users u on u.id = p.id order by p.full_name;
end $$;

create or replace function admin_set_user(p_user uuid, p_role_key text, p_admin boolean, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if p_user = auth.uid() and not p_admin then raise exception 'You cannot remove your own admin access'; end if;
  perform set_config('app.profile_rpc', '1', true);
  update profiles set role_key = p_role_key, role = case when p_admin then 'admin'::user_role else 'member'::user_role end, active = p_active
  where id = p_user;
  if not found then raise exception 'user not found'; end if;
end $$;

create or replace function admin_login_log(p_limit int default 200)
returns table (at timestamptz, user_id uuid, full_name text, email text, user_agent text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  return query select l.at, l.user_id, p.full_name, u.email::text, l.user_agent
    from login_log l join profiles p on p.id = l.user_id join auth.users u on u.id = l.user_id order by l.at desc limit greatest(p_limit, 1);
end $$;

-- =====================================================================
-- 6. Groups (admin-formed, any number, a person can be in several)
-- =====================================================================
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null, description text,
  archived boolean not null default false,
  created_by uuid references profiles on delete set null,
  created_at timestamptz default now()
);
create unique index if not exists groups_name_unique on groups (lower(name)) where not archived;
create table if not exists group_members (
  group_id uuid references groups on delete cascade,
  user_id uuid references profiles on delete cascade,
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);
create or replace function is_group_member(p_group uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = p_group and user_id = auth.uid()); $$;
alter table groups enable row level security;  alter table group_members enable row level security;
drop policy if exists groups_admin on groups; drop policy if exists groups_read on groups;
drop policy if exists gm_admin2 on group_members; drop policy if exists gm_read2 on group_members;
create policy groups_admin on groups for all using (is_admin()) with check (is_admin());
create policy groups_read on groups for select using (is_group_member(id));
create policy gm_admin2 on group_members for all using (is_admin()) with check (is_admin());
create policy gm_read2 on group_members for select using (is_group_member(group_id));

-- =====================================================================
-- 7. Tasks (assigned to people or groups)
-- =====================================================================
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null, description text,
  kind text not null default 'individual' check (kind in ('individual','team')),
  deadline timestamptz,
  activity_id uuid references activities on delete set null,
  open_to_all boolean not null default false,
  status text not null default 'active' check (status in ('draft','active','closed')),
  created_by uuid references profiles on delete set null,
  created_at timestamptz default now()
);
create table if not exists task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  user_id uuid references profiles on delete cascade,
  group_id uuid references groups on delete cascade,
  created_at timestamptz default now(),
  check ((user_id is null) <> (group_id is null))
);
create unique index if not exists task_assign_user on task_assignments (task_id, user_id) where user_id is not null;
create unique index if not exists task_assign_group on task_assignments (task_id, group_id) where group_id is not null;
create table if not exists task_progress (
  task_id uuid references tasks on delete cascade,
  user_id uuid references profiles on delete cascade,
  status text not null default 'todo' check (status in ('todo','submitted','needs_changes','done')),
  link_url text, note text, feedback text,
  submitted_at timestamptz, reviewed_at timestamptz, updated_at timestamptz default now(),
  primary key (task_id, user_id)
);

create or replace function task_visible(p_task uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tasks t where t.id = p_task and t.status <> 'draft' and is_active_user()
    and (t.open_to_all or exists (select 1 from task_assignments a where a.task_id = t.id
         and (a.user_id = auth.uid() or a.group_id in (select group_id from group_members where user_id = auth.uid()))))); $$;

alter table tasks enable row level security; alter table task_assignments enable row level security; alter table task_progress enable row level security;
drop policy if exists tasks_admin on tasks; drop policy if exists tasks_member on tasks;
drop policy if exists ta_admin on task_assignments; drop policy if exists tp_admin on task_progress; drop policy if exists tp_own on task_progress;
create policy tasks_admin on tasks for all using (is_admin()) with check (is_admin());
create policy tasks_member on tasks for select using (task_visible(id));
create policy ta_admin on task_assignments for all using (is_admin()) with check (is_admin());
create policy tp_admin on task_progress for all using (is_admin()) with check (is_admin());
create policy tp_own on task_progress for select using (user_id = auth.uid());

create or replace function my_tasks()
returns table (id uuid, title text, description text, kind text, deadline timestamptz, task_status text, open_to_all boolean,
               activity_id uuid, my_status text, my_link text, my_note text, my_feedback text, group_names text[])
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.description, t.kind, t.deadline, t.status, t.open_to_all, t.activity_id,
         coalesce(tp.status, 'todo'), tp.link_url, tp.note, tp.feedback,
         coalesce((select array_agg(distinct g.name) from task_assignments a join groups g on g.id = a.group_id
                   join group_members gm on gm.group_id = g.id and gm.user_id = auth.uid() where a.task_id = t.id), '{}')
  from tasks t left join task_progress tp on tp.task_id = t.id and tp.user_id = auth.uid()
  where task_visible(t.id)
  order by (coalesce(tp.status, 'todo') = 'done'), t.deadline nulls last, t.created_at; $$;

create or replace function task_people(p_task uuid)
returns table (group_name text, user_id uuid, full_name text, avatar_path text)
language sql stable security definer set search_path = public as $$
  select g.name, p.id, p.full_name, p.avatar_url
  from task_assignments a join groups g on g.id = a.group_id join group_members gm on gm.group_id = g.id join profiles p on p.id = gm.user_id
  where a.task_id = p_task and (is_admin() or exists (select 1 from group_members me where me.group_id = g.id and me.user_id = auth.uid()))
  order by g.name, p.full_name; $$;

create or replace function submit_task(p_task uuid, p_link text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if not task_visible(p_task) then raise exception 'task not available'; end if;
  if (select status from tasks where id = p_task) <> 'active' then raise exception 'this task is closed'; end if;
  if coalesce(trim(p_link), '') = '' and coalesce(trim(p_note), '') = '' then raise exception 'add a link or a note'; end if;
  if coalesce(trim(p_link), '') <> '' and p_link !~* '^https?://' then raise exception 'the link must start with http:// or https://'; end if;
  select status into cur from task_progress where task_id = p_task and user_id = auth.uid();
  if cur = 'done' then raise exception 'this task is already approved'; end if;
  insert into task_progress (task_id, user_id, status, link_url, note, submitted_at, updated_at)
  values (p_task, auth.uid(), 'submitted', nullif(trim(p_link), ''), nullif(trim(p_note), ''), now(), now())
  on conflict (task_id, user_id) do update set status = 'submitted', link_url = excluded.link_url, note = excluded.note,
    submitted_at = now(), updated_at = now(), feedback = null;
end $$;

create or replace function on_task_review() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('done','needs_changes') then
    new.reviewed_at := now();
    insert into notifications (user_id, kind, body) values (new.user_id,
      case new.status when 'done' then 'task_approved' else 'task_changes' end,
      coalesce(new.feedback, case new.status when 'done' then 'Your task was approved.' else 'A task needs changes.' end));
  end if;
  return new;
end $$;
drop trigger if exists task_progress_review on task_progress;
create trigger task_progress_review before update on task_progress for each row execute function on_task_review();

-- Admin: assign a task to people and/or groups, and notify them (only when the task is active).
create or replace function assign_task(p_task uuid, p_users uuid[] default '{}', p_groups uuid[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  insert into task_assignments (task_id, user_id) select p_task, u from unnest(coalesce(p_users, '{}'::uuid[])) u on conflict do nothing;
  insert into task_assignments (task_id, group_id) select p_task, g from unnest(coalesce(p_groups, '{}'::uuid[])) g on conflict do nothing;
  insert into notifications (user_id, kind, body)
    select distinct s.uid, 'task_assigned', format('New task: %s', t.title)
    from (select unnest(coalesce(p_users, '{}'::uuid[])) as uid
          union select gm.user_id from group_members gm where gm.group_id = any (coalesce(p_groups, '{}'::uuid[]))) s,
         tasks t where t.id = p_task and t.status = 'active';
end $$;

-- =====================================================================
-- 8. Profile photos: public bucket, each person writes only to their own folder
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
drop policy if exists avatars_insert on storage.objects; drop policy if exists avatars_update on storage.objects; drop policy if exists avatars_delete on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
