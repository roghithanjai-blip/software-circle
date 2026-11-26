-- schema_v3.sql
-- Run AFTER schema_terminal_v2.sql. Fixes from the first code audit. Safe to re-run.

-- 1. Indexes for the queries the app actually runs
create index if not exists step_progress_step on step_progress (step_id);
create index if not exists step_progress_user_status on step_progress (user_id, status);
create index if not exists submissions_user on submissions (user_id);
create index if not exists point_events_user_time on point_events (user_id, created_at desc);
create index if not exists notifications_user on notifications (user_id, read, created_at desc);
create index if not exists steps_activity on steps (activity_id) where not archived;

-- 2. Phase prerequisites enforced in the database (not just shown as a lock)
create or replace function phase_unlocked(p_phase uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select not exists (
      select 1 from activities a join steps s on s.activity_id = a.id and not s.archived
      where a.phase_id = p.prerequisite_phase_id and a.status = 'published'
        and not exists (select 1 from step_progress sp where sp.step_id = s.id and sp.user_id = auth.uid() and sp.status = 'completed'))
    from phases p where p.id = p_phase), true); $$;

-- 3. complete_step: https-only links, safe evidence path, prerequisite check.
--    Also fixes a real bug: the submission status was an untyped text CASE, so every link / screenshot / review step failed with a type error.
create or replace function complete_step(p_step uuid, p_link text default null, p_path text default null)
returns progress_status language plpgsql security definer set search_path = public as $$
declare s steps; result progress_status; ph uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not step_is_visible(p_step) then raise exception 'step not available'; end if;
  select * into s from steps where id = p_step;
  select phase_id into ph from activities where id = s.activity_id;
  if not phase_unlocked(ph) then raise exception 'finish the previous phase first'; end if;

  -- member-submitted links must be https and carry no user:pass@ part; evidence paths must be <uid>/<one safe file name>
  if s.completion = 'link' and coalesce(p_link,'') = '' then raise exception 'a link is required'; end if;
  if coalesce(p_link,'') <> '' and p_link !~* '^https://[^/@[:space:]]+(/.*)?$' then raise exception 'enter a link starting with https://'; end if;
  if p_path is not null and (p_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$') or p_path like '%..%') then raise exception 'invalid evidence path'; end if;
  if s.completion = 'evidence' and p_path is null then raise exception 'evidence image is required'; end if;

  result := case
    when s.completion = 'self' then 'completed'
    when s.completion = 'review' or s.requires_review then 'submitted'
    else 'completed' end;

  if s.completion <> 'self' then
    insert into submissions (user_id, step_id, image_path, link_url, status)
    values (auth.uid(), p_step, p_path, p_link, case when result = 'completed' then 'approved'::review_status else 'submitted'::review_status end);
  end if;

  insert into step_progress (user_id, step_id, status, completed_at)
  values (auth.uid(), p_step, result, case when result = 'completed' then now() end)
  on conflict (user_id, step_id) do update
    set status = excluded.status, completed_at = excluded.completed_at, updated_at = now();

  update profiles set last_active_at = now() where id = auth.uid();
  return result;
end $$;

-- 4. Points: the verified bonus goes to human-reviewed work only. The review sync moves to an AFTER trigger so award_points
--    sees the committed review (before this, reviewed work never earned the bonus and unreviewed screenshots did).
create or replace function award_points() returns trigger language plpgsql security definer set search_path = public as $$
declare act uuid; remaining int; r point_rules;
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    select * into r from point_rules where key = 'step_complete' and enabled;
    if found then insert into point_events (user_id, rule_key, ref_id, points) values (new.user_id, r.key, new.step_id, r.points) on conflict do nothing; end if;

    if exists (select 1 from submissions where user_id = new.user_id and step_id = new.step_id and status = 'approved' and reviewed_by is not null) then
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

create or replace function on_review() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and old.status = 'submitted' then
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
  end if;
  return new;
end $$;
create or replace function on_review_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and old.status = 'submitted' then
    update step_progress set
      status = case new.status when 'approved' then 'completed'::progress_status else 'needs_changes' end,
      completed_at = case new.status when 'approved' then now() end, updated_at = now()
    where user_id = new.user_id and step_id = new.step_id;
    insert into notifications (user_id, kind, body)
    values (new.user_id, case new.status when 'approved' then 'evidence_approved' else 'evidence_changes' end,
            coalesce(new.feedback, case new.status when 'approved' then 'Your submission was approved.' else 'Your submission needs changes.' end));
  end if;
  return null;
end $$;
drop trigger if exists submissions_review_after on submissions;
create trigger submissions_review_after after update on submissions for each row execute function on_review_after();

-- 5. Profile and task links
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
  if p_avatar is not null and (p_avatar !~ ('^' || auth.uid()::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$') or p_avatar like '%..%') then raise exception 'Invalid photo'; end if;
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

create or replace function submit_task(p_task uuid, p_link text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if not task_visible(p_task) then raise exception 'task not available'; end if;
  if (select status from tasks where id = p_task) <> 'active' then raise exception 'this task is closed'; end if;
  if coalesce(trim(p_link), '') = '' and coalesce(trim(p_note), '') = '' then raise exception 'add a link or a note'; end if;
  if coalesce(trim(p_link), '') <> '' and trim(p_link) !~* '^https://[^/@[:space:]]+(/.*)?$' then raise exception 'the link must start with https://'; end if;
  select status into cur from task_progress where task_id = p_task and user_id = auth.uid();
  if cur = 'done' then raise exception 'this task is already approved'; end if;
  insert into task_progress (task_id, user_id, status, link_url, note, submitted_at, updated_at)
  values (p_task, auth.uid(), 'submitted', nullif(trim(p_link), ''), nullif(trim(p_note), ''), now(), now())
  on conflict (task_id, user_id) do update set status = 'submitted', link_url = excluded.link_url, note = excluded.note,
    submitted_at = now(), updated_at = now(), feedback = null;
end $$;

-- 6. Profiles are written only through save_profile() / admin_set_user(); members can no longer UPDATE the table directly.
revoke update on profiles from authenticated;
grant update (last_active_at) on profiles to authenticated;

-- 7. Server-side aggregation (replaces browser-side counting that silently truncated at 10,000 / 20,000 rows)
create or replace function activity_finishers() returns table (activity_id uuid, finishers int)
language sql stable security definer set search_path = public as $$
  with totals as (select s.activity_id, count(*) as n from steps s where not s.archived group by s.activity_id),
       done as (select s.activity_id, sp.user_id, count(*) as c from step_progress sp join steps s on s.id = sp.step_id
                where sp.status = 'completed' and not s.archived group by s.activity_id, sp.user_id)
  select t.activity_id, count(d.user_id)::int from totals t left join done d on d.activity_id = t.activity_id and d.c >= t.n
  where is_admin() group by t.activity_id; $$;

create or replace function probation_progress()
returns table (user_id uuid, activity_id uuid, activity_title text, ord bigint, done int, total int)
language sql stable security definer set search_path = public as $$
  with u as (select pr.user_id, p.role_key from probations pr join profiles p on p.id = pr.user_id),
  acts as (select a.id, a.title, r.audience, row_number() over (order by r.position, ph.position, a.position) as ord,
                  (select count(*) from steps s where s.activity_id = a.id and not s.archived) as total
           from activities a join phases ph on ph.id = a.phase_id and ph.status = 'published' and ph.visible
           join roadmaps r on r.id = ph.roadmap_id and r.deployed and not r.archived where a.status = 'published')
  select u.user_id, acts.id, acts.title, acts.ord,
         (select count(*) from step_progress sp join steps s on s.id = sp.step_id
          where sp.user_id = u.user_id and sp.status = 'completed' and s.activity_id = acts.id and not s.archived)::int, acts.total::int
  from u cross join acts
  where is_admin() and acts.total > 0 and (cardinality(acts.audience) = 0 or u.role_key = any (acts.audience))
  order by u.user_id, acts.ord; $$;

-- 8. Housekeeping: screenshots uploaded but never attached to a submission (older than a day)
create or replace function admin_orphan_evidence() returns table (name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.name, o.created_at from storage.objects o
  where is_admin() and o.bucket_id = 'evidence' and o.created_at < now() - interval '1 day'
    and not exists (select 1 from submissions s where s.image_path = o.name) order by o.created_at; $$;
