-- Mission platform: Supabase schema (Postgres + RLS + Storage)
-- Run in the Supabase SQL editor. Everything is content-driven: no phase/activity/step names are hardcoded.

create extension if not exists pgcrypto;

create type user_role as enum ('admin','member');
create type content_status as enum ('draft','published','archived');
create type completion_type as enum ('self','evidence','link','review');
create type progress_status as enum ('in_progress','submitted','needs_changes','completed');
create type review_status as enum ('submitted','approved','needs_changes');
create type probation_outcome as enum ('pending','accepted','extended','not_selected');

-- ---------- Profiles ----------
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  avatar_url text,
  github_url text,
  role user_role not null default 'member',
  last_active_at timestamptz default now(),
  created_at timestamptz default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Members may edit their profile but never their own role.
create or replace function protect_role() returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and not is_admin() then
    raise exception 'role can only be changed by an admin';
  end if;
  return new;
end $$;
create trigger profiles_protect_role before update on profiles
  for each row execute function protect_role();

-- ---------- Journey content ----------
create table phases (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  title text not null,
  description text,
  icon text,
  est_duration text,
  status content_status not null default 'draft',
  visible boolean not null default false,
  prerequisite_phase_id uuid references phases on delete set null,
  created_at timestamptz default now()
);

create table activities (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references phases on delete cascade,
  position int not null default 0,
  title text not null,
  summary text,
  objective text,
  deliverable text,
  est_duration text,
  kind text not null default 'build',          -- admin-defined (Build, Explore, Research, ...)
  instructions text,
  requires_submission boolean not null default false,
  is_team boolean not null default false,       -- reserved for team activities
  status content_status not null default 'draft',
  created_at timestamptz default now()
);

create table steps (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities on delete cascade,
  position int not null default 0,
  title text not null,
  explanation text,
  completion completion_type not null default 'self',
  requires_review boolean not null default false,
  resource_url text,
  archived boolean not null default false
);

create index on activities (phase_id, position);
create index on steps (activity_id, position);

-- A step is visible to members only if its whole chain is published.
create or replace function step_is_visible(p_step uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from steps s
    join activities a on a.id = s.activity_id and a.status = 'published'
    join phases p on p.id = a.phase_id and p.status = 'published' and p.visible
    where s.id = p_step and not s.archived);
$$;

-- ---------- Progress & evidence ----------
create table step_progress (
  user_id uuid not null references profiles on delete cascade,
  step_id uuid not null references steps on delete cascade,
  status progress_status not null default 'in_progress',
  completed_at timestamptz,
  updated_at timestamptz default now(),
  primary key (user_id, step_id)
);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  step_id uuid not null references steps on delete cascade,
  image_path text,                -- storage path in 'evidence' bucket
  link_url text,
  status review_status not null default 'submitted',
  feedback text,
  reviewed_by uuid references profiles,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);
create index on submissions (status, created_at);

-- Members cannot write progress directly; they call complete_step().
create or replace function complete_step(p_step uuid, p_link text default null, p_path text default null)
returns progress_status language plpgsql security definer set search_path = public as $$
declare s steps; result progress_status;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not step_is_visible(p_step) then raise exception 'step not available'; end if;
  select * into s from steps where id = p_step;

  if s.completion = 'link' and coalesce(p_link,'') !~ '^https?://' then raise exception 'a valid URL is required'; end if;
  if s.completion = 'evidence' and (p_path is null or p_path not like auth.uid()::text || '/%') then
    raise exception 'evidence image is required';
  end if;

  result := case
    when s.completion = 'self' then 'completed'
    when s.completion = 'review' or s.requires_review then 'submitted'
    else 'completed' end;

  if s.completion <> 'self' then
    insert into submissions (user_id, step_id, image_path, link_url, status)
    values (auth.uid(), p_step, p_path, p_link, case when result = 'completed' then 'approved' else 'submitted' end);
  end if;

  insert into step_progress (user_id, step_id, status, completed_at)
  values (auth.uid(), p_step, result, case when result = 'completed' then now() end)
  on conflict (user_id, step_id) do update
    set status = excluded.status, completed_at = excluded.completed_at, updated_at = now();

  update profiles set last_active_at = now() where id = auth.uid();
  return result;
end $$;

create or replace function uncomplete_step(p_step uuid) returns void
language sql security definer set search_path = public as $$
  delete from step_progress where user_id = auth.uid() and step_id = p_step and status = 'completed'
    and exists (select 1 from steps where id = p_step and completion = 'self');
$$;

-- Admin review -> sync progress, notify.
create or replace function on_review() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and old.status = 'submitted' then
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
    update step_progress set
      status = case new.status when 'approved' then 'completed'::progress_status else 'needs_changes' end,
      completed_at = case new.status when 'approved' then now() end, updated_at = now()
    where user_id = new.user_id and step_id = new.step_id;
    insert into notifications (user_id, kind, body)
    values (new.user_id, case new.status when 'approved' then 'evidence_approved' else 'evidence_changes' end,
            coalesce(new.feedback, case new.status when 'approved' then 'Your submission was approved.' else 'Your submission needs changes.' end));
  end if;
  return new;
end $$;
create trigger submissions_review before update on submissions
  for each row execute function on_review();

-- ---------- Points & achievements ----------
create table point_rules (
  key text primary key,            -- step_complete | activity_complete | verified_evidence | helped_member | ...
  label text not null,
  points int not null default 0,
  enabled boolean not null default true
);
insert into point_rules (key,label,points) values
  ('step_complete','Complete a step',5),
  ('verified_evidence','Evidence approved',10),
  ('activity_complete','Complete an activity',25);

create table point_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  rule_key text not null references point_rules,
  ref_id uuid not null,                       -- step or activity id: one award per item
  points int not null,
  created_at timestamptz default now(),
  unique (user_id, rule_key, ref_id)          -- un-farmable
);

create or replace function award_points() returns trigger language plpgsql security definer set search_path = public as $$
declare act uuid; remaining int; r point_rules;
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    select * into r from point_rules where key = 'step_complete' and enabled;
    if found then insert into point_events (user_id, rule_key, ref_id, points) values (new.user_id, r.key, new.step_id, r.points) on conflict do nothing; end if;

    if exists (select 1 from submissions where user_id = new.user_id and step_id = new.step_id and status = 'approved' and image_path is not null) then
      select * into r from point_rules where key = 'verified_evidence' and enabled;
      if found then insert into point_events (user_id, rule_key, ref_id, points) values (new.user_id, r.key, new.step_id, r.points) on conflict do nothing; end if;
    end if;

    select activity_id into act from steps where id = new.step_id;
    select count(*) into remaining from steps s
      where s.activity_id = act and not s.archived
        and not exists (select 1 from step_progress p where p.step_id = s.id and p.user_id = new.user_id and p.status = 'completed');
    if remaining = 0 then
      select * into r from point_rules where key = 'activity_complete' and enabled;
      if found then insert into point_events (user_id, rule_key, ref_id, points) values (new.user_id, r.key, act, r.points) on conflict do nothing; end if;
      insert into notifications (user_id, kind, body) values (new.user_id, 'milestone', 'Mission complete.');
    end if;
  end if;
  return new;
end $$;
create trigger step_progress_points after insert or update on step_progress
  for each row execute function award_points();

create table achievements (
  key text primary key, title text not null, description text
);
create table member_achievements (
  user_id uuid references profiles on delete cascade,
  achievement_key text references achievements,
  earned_at timestamptz default now(),
  primary key (user_id, achievement_key)
);

-- ---------- Settings, notifications, feedback ----------
create table platform_settings (
  key text primary key, value jsonb not null
);
insert into platform_settings values
  ('leaderboard_enabled','true'),('weekly_leaderboard_enabled','true');

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  kind text not null, body text not null,
  read boolean not null default false,
  created_at timestamptz default now()
);

create table activity_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  activity_id uuid not null references activities on delete cascade,
  category text not null check (category in ('too_difficult','unclear','technical_issue','suggestion','general')),
  message text,
  created_at timestamptz default now()
);

-- ---------- Probation (humans decide; nothing is automatic) ----------
create table probations (
  user_id uuid primary key references profiles on delete cascade,
  start_date date, end_date date,
  outcome probation_outcome not null default 'pending',
  decision_note text,
  decided_by uuid references profiles, decided_at timestamptz
);
create table probation_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  author uuid references profiles,
  body text not null,
  created_at timestamptz default now()
);

-- ---------- Teams (foundation only) ----------
create table teams (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz default now());
create table team_members (team_id uuid references teams on delete cascade, user_id uuid references profiles on delete cascade, primary key (team_id, user_id));
alter table submissions add column team_id uuid references teams;

-- ---------- Leaderboard: exposes only name, avatar, points ----------
create or replace function leaderboard(p_weekly boolean default false)
returns table (user_id uuid, full_name text, avatar_url text, points bigint, rank bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.avatar_url, coalesce(sum(e.points),0)::bigint as pts,
         rank() over (order by coalesce(sum(e.points),0) desc)
  from profiles p
  left join point_events e on e.user_id = p.id and (not p_weekly or e.created_at > now() - interval '7 days')
  where p.role = 'member'
    and coalesce((select (value)::text::boolean from platform_settings where key = 'leaderboard_enabled'), true)
  group by p.id
  order by pts desc
  limit 100;
$$;

-- ---------- Row Level Security ----------
alter table profiles enable row level security;
alter table phases enable row level security;
alter table activities enable row level security;
alter table steps enable row level security;
alter table step_progress enable row level security;
alter table submissions enable row level security;
alter table point_rules enable row level security;
alter table point_events enable row level security;
alter table achievements enable row level security;
alter table member_achievements enable row level security;
alter table platform_settings enable row level security;
alter table notifications enable row level security;
alter table activity_feedback enable row level security;
alter table probations enable row level security;
alter table probation_notes enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;

-- profiles: own row + admins; other members' public info comes via leaderboard()/views, not raw rows
create policy profiles_read on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_update_own on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin on profiles for all using (is_admin()) with check (is_admin());

-- content: admins everything; members only published + visible chain
create policy phases_admin on phases for all using (is_admin()) with check (is_admin());
create policy phases_member on phases for select using (status = 'published' and visible);
create policy activities_admin on activities for all using (is_admin()) with check (is_admin());
create policy activities_member on activities for select using (
  status = 'published' and exists (select 1 from phases p where p.id = phase_id and p.status = 'published' and p.visible));
create policy steps_admin on steps for all using (is_admin()) with check (is_admin());
create policy steps_member on steps for select using (step_is_visible(id));

-- progress: read own; writes only via complete_step()
create policy progress_read on step_progress for select using (user_id = auth.uid() or is_admin());
create policy progress_admin on step_progress for all using (is_admin()) with check (is_admin());

-- submissions: read own; admins review; inserts only via RPC
create policy sub_read on submissions for select using (user_id = auth.uid() or is_admin());
create policy sub_admin on submissions for update using (is_admin()) with check (is_admin());

create policy rules_read on point_rules for select using (true);
create policy rules_admin on point_rules for all using (is_admin()) with check (is_admin());
create policy events_read on point_events for select using (user_id = auth.uid() or is_admin());
create policy ach_read on achievements for select using (true);
create policy ach_admin on achievements for all using (is_admin()) with check (is_admin());
create policy mach_read on member_achievements for select using (user_id = auth.uid() or is_admin());
create policy settings_read on platform_settings for select using (true);
create policy settings_admin on platform_settings for all using (is_admin()) with check (is_admin());

create policy notif_own on notifications for select using (user_id = auth.uid());
create policy notif_mark on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_admin on notifications for all using (is_admin()) with check (is_admin());

create policy fb_insert on activity_feedback for insert with check (user_id = auth.uid());
create policy fb_read on activity_feedback for select using (user_id = auth.uid() or is_admin());
create policy fb_admin on activity_feedback for delete using (is_admin());

create policy prob_read on probations for select using (user_id = auth.uid() or is_admin());
create policy prob_admin on probations for all using (is_admin()) with check (is_admin());
create policy pnotes_admin on probation_notes for all using (is_admin()) with check (is_admin());

create policy teams_admin on teams for all using (is_admin()) with check (is_admin());
create policy teams_read on teams for select using (exists (select 1 from team_members m where m.team_id = id and m.user_id = auth.uid()));
create policy tm_admin on team_members for all using (is_admin()) with check (is_admin());
create policy tm_read on team_members for select using (user_id = auth.uid());

-- ---------- Storage: private evidence bucket, files live under <user_id>/ ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence','evidence', false, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text);
create policy evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));
create policy evidence_delete on storage.objects for delete to authenticated
  using (bucket_id = 'evidence' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));

-- First admin: after signing up, run:
--   update profiles set role = 'admin' where id = '<your-auth-user-uuid>';
