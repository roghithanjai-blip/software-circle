-- schema_terminal.sql  (run AFTER schema.sql)
-- Backend for the admin "terminal": one admin-only function applies a JSON command list atomically.

create table terminal_log (
  id bigint generated always as identity primary key,
  admin_id uuid references profiles on delete set null,
  script text, commands jsonb, result jsonb,
  ok boolean not null,
  created_at timestamptz default now()
);
alter table terminal_log enable row level security;
create policy tlog_admin on terminal_log for all using (is_admin()) with check (is_admin());

-- ---------- Resolvers: find by title (case-insensitive), fail loudly on missing/ambiguous ----------
create or replace function t_phase(p_title text) returns uuid language plpgsql stable as $$
declare ids uuid[];
begin
  select array_agg(id) into ids from phases where lower(title) = lower(p_title) and status <> 'archived';
  if ids is null then raise exception 'phase "%" not found', p_title; end if;
  if array_length(ids,1) > 1 then raise exception 'phase "%" is ambiguous', p_title; end if;
  return ids[1];
end $$;

create or replace function t_activity(p_title text, p_phase text default null) returns uuid language plpgsql stable as $$
declare ids uuid[];
begin
  select array_agg(a.id) into ids from activities a join phases p on p.id = a.phase_id
   where lower(a.title) = lower(p_title) and a.status <> 'archived'
     and (p_phase is null or lower(p.title) = lower(p_phase));
  if ids is null then raise exception 'activity "%" not found', p_title; end if;
  if array_length(ids,1) > 1 then raise exception 'activity "%" is ambiguous (add: in phase "...")', p_title; end if;
  return ids[1];
end $$;

create or replace function t_step(p_title text, p_activity text default null, p_phase text default null) returns uuid language plpgsql stable as $$
declare ids uuid[];
begin
  select array_agg(s.id) into ids from steps s
    join activities a on a.id = s.activity_id join phases p on p.id = a.phase_id
   where lower(s.title) = lower(p_title) and not s.archived
     and (p_activity is null or lower(a.title) = lower(p_activity))
     and (p_phase is null or lower(p.title) = lower(p_phase));
  if ids is null then raise exception 'step "%" not found', p_title; end if;
  if array_length(ids,1) > 1 then raise exception 'step "%" is ambiguous (add: in activity "...")', p_title; end if;
  return ids[1];
end $$;

-- ---------- The runner ----------
-- p_dry = true  -> performs everything, reports the log, then rolls back (preview).
-- p_dry = false -> commits if every command succeeds; otherwise nothing changes.
create or replace function apply_commands(p_cmds jsonb, p_script text default null, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c jsonb; s jsonb; op text; tgt text;
  lines text[] := '{}'; pid uuid; aid uuid; sid uuid; n int;
  was_published boolean; ok boolean := true; err text; res jsonb;
begin
  if not is_admin() then raise exception 'admin only'; end if;

  begin  -- inner block = savepoint; any error (or dry run) rolls it back
    for c in select * from jsonb_array_elements(p_cmds) loop
      op := c->>'op'; tgt := c->>'target'; s := coalesce(c->'set', '{}'::jsonb);

      if op = 'add_phase' then
        insert into phases (position, title, description, icon, est_duration)
        values ((select coalesce(max(position),0)+1 from phases), c->>'title', c->>'description', c->>'icon', c->>'est_duration');
        lines := lines || format('+ phase "%s"', c->>'title');

      elsif op = 'add_activity' then
        pid := t_phase(c->>'phase');
        insert into activities (phase_id, position, title, summary, objective, deliverable, est_duration, kind, instructions, requires_submission)
        values (pid, (select coalesce(max(position),0)+1 from activities where phase_id = pid),
                c->>'title', c->>'summary', c->>'objective', c->>'deliverable', c->>'est_duration',
                coalesce(c->>'kind','build'), c->>'instructions', coalesce((c->>'requires_submission')::boolean,false));
        lines := lines || format('+ activity "%s" in "%s"', c->>'title', c->>'phase');

      elsif op = 'add_step' then
        aid := t_activity(c->>'activity', c->>'phase');
        insert into steps (activity_id, position, title, explanation, completion, requires_review, resource_url)
        values (aid, (select coalesce(max(position),0)+1 from steps where activity_id = aid),
                c->>'title', c->>'explanation', coalesce(c->>'completion','self')::completion_type,
                coalesce((c->>'requires_review')::boolean,false), c->>'resource_url');
        lines := lines || format('+ step "%s" in "%s"', c->>'title', c->>'activity');

      elsif op = 'edit' then
        if tgt = 'phase' then
          pid := t_phase(c->>'match');
          update phases set title = coalesce(s->>'title', title), description = coalesce(s->>'description', description),
                 icon = coalesce(s->>'icon', icon), est_duration = coalesce(s->>'est_duration', est_duration) where id = pid;
        elsif tgt = 'activity' then
          aid := t_activity(c->>'match', c->>'phase');
          update activities set title = coalesce(s->>'title', title), summary = coalesce(s->>'summary', summary),
                 objective = coalesce(s->>'objective', objective), deliverable = coalesce(s->>'deliverable', deliverable),
                 est_duration = coalesce(s->>'est_duration', est_duration), kind = coalesce(s->>'kind', kind),
                 instructions = coalesce(s->>'instructions', instructions),
                 requires_submission = coalesce((s->>'requires_submission')::boolean, requires_submission) where id = aid;
        elsif tgt = 'step' then
          sid := t_step(c->>'match', c->>'activity', c->>'phase');
          update steps set title = coalesce(s->>'title', title), explanation = coalesce(s->>'explanation', explanation),
                 completion = coalesce((s->>'completion')::completion_type, completion),
                 requires_review = coalesce((s->>'requires_review')::boolean, requires_review),
                 resource_url = coalesce(s->>'resource_url', resource_url) where id = sid;
        else raise exception 'cannot edit "%"', tgt; end if;
        lines := lines || format('~ %s "%s" edited', tgt, c->>'match');

      elsif op = 'move' then
        if tgt = 'activity' then
          aid := t_activity(c->>'match', c->>'phase');
          pid := case when c->>'to_phase' is not null then t_phase(c->>'to_phase') else (select phase_id from activities where id = aid) end;
          n := coalesce((c->>'at')::int, (select coalesce(max(position),0)+1 from activities where phase_id = pid));
          update activities set position = position + 1 where phase_id = pid and position >= n and id <> aid;
          update activities set phase_id = pid, position = n where id = aid;
          with r as (select id, row_number() over (order by position, id) rn from activities where phase_id = pid)
            update activities a set position = r.rn from r where a.id = r.id;
        elsif tgt = 'step' then
          sid := t_step(c->>'match', c->>'activity', c->>'phase');
          aid := case when c->>'to_activity' is not null then t_activity(c->>'to_activity') else (select activity_id from steps where id = sid) end;
          n := coalesce((c->>'at')::int, (select coalesce(max(position),0)+1 from steps where activity_id = aid));
          update steps set position = position + 1 where activity_id = aid and position >= n and id <> sid;
          update steps set activity_id = aid, position = n where id = sid;
          with r as (select id, row_number() over (order by position, id) rn from steps where activity_id = aid)
            update steps x set position = r.rn from r where x.id = r.id;
        elsif tgt = 'phase' then
          pid := t_phase(c->>'match');
          n := coalesce((c->>'at')::int, (select coalesce(max(position),0)+1 from phases));
          update phases set position = position + 1 where position >= n and id <> pid;
          update phases set position = n where id = pid;
          with r as (select id, row_number() over (order by position, id) rn from phases)
            update phases p set position = r.rn from r where p.id = r.id;
        else raise exception 'cannot move "%"', tgt; end if;
        lines := lines || format('> moved %s "%s"', tgt, c->>'match');

      elsif op in ('publish','unpublish') then
        if tgt = 'phase' then
          pid := t_phase(c->>'match');
          select status = 'published' and visible into was_published from phases where id = pid;
          if op = 'publish' then
            update phases set status = 'published', visible = true where id = pid;
            if coalesce((c->>'cascade')::boolean,false) then
              update activities set status = 'published' where phase_id = pid and status <> 'archived';
            end if;
            if not was_published then
              insert into notifications (user_id, kind, body)
              select id, 'phase_published', format('New phase available: %s', c->>'match') from profiles where role = 'member';
            end if;
          else
            update phases set status = 'draft', visible = false where id = pid;
          end if;
        elsif tgt = 'activity' then
          aid := t_activity(c->>'match', c->>'phase');
          update activities set status = case when op = 'publish' then 'published' else 'draft' end::content_status where id = aid;
        else raise exception 'cannot % "%"', op, tgt; end if;
        lines := lines || format('%s %s "%s"', case when op = 'publish' then '↑ published' else '↓ unpublished' end, tgt, c->>'match');

      elsif op = 'archive' then
        if tgt = 'phase' then update phases set status = 'archived', visible = false where id = t_phase(c->>'match');
        elsif tgt = 'activity' then update activities set status = 'archived' where id = t_activity(c->>'match', c->>'phase');
        elsif tgt = 'step' then update steps set archived = true where id = t_step(c->>'match', c->>'activity', c->>'phase');
        else raise exception 'cannot archive "%"', tgt; end if;
        lines := lines || format('- archived %s "%s"', tgt, c->>'match');

      elsif op = 'delete' then  -- hard delete, only if nobody has progress on it
        if tgt = 'phase' then
          pid := t_phase(c->>'match');
          if exists (select 1 from step_progress sp join steps s on s.id = sp.step_id join activities a on a.id = s.activity_id where a.phase_id = pid)
            then raise exception 'phase "%" has member progress: archive it instead', c->>'match'; end if;
          delete from phases where id = pid;
        elsif tgt = 'activity' then
          aid := t_activity(c->>'match', c->>'phase');
          if exists (select 1 from step_progress sp join steps s on s.id = sp.step_id where s.activity_id = aid)
            then raise exception 'activity "%" has member progress: archive it instead', c->>'match'; end if;
          delete from activities where id = aid;
        elsif tgt = 'step' then
          sid := t_step(c->>'match', c->>'activity', c->>'phase');
          if exists (select 1 from step_progress where step_id = sid)
            then raise exception 'step "%" has member progress: archive it instead', c->>'match'; end if;
          delete from steps where id = sid;
        else raise exception 'cannot delete "%"', tgt; end if;
        lines := lines || format('x deleted %s "%s"', tgt, c->>'match');

      elsif op = 'dup_activity' then
        aid := t_activity(c->>'match', c->>'phase');
        insert into activities (phase_id, position, title, summary, objective, deliverable, est_duration, kind, instructions, requires_submission)
          select phase_id, position + 1, title || ' (copy)', summary, objective, deliverable, est_duration, kind, instructions, requires_submission
          from activities where id = aid returning id into sid;
        insert into steps (activity_id, position, title, explanation, completion, requires_review, resource_url)
          select sid, position, title, explanation, completion, requires_review, resource_url from steps where activity_id = aid and not archived;
        lines := lines || format('+ duplicated activity "%s" (as draft)', c->>'match');

      else
        lines := lines || team_op(c);   -- team ops live in schema_teams.sql; it raises on unknown ops
      end if;
    end loop;

    if p_dry then raise exception '__dry_run__'; end if;
  exception when others then
    if sqlerrm <> '__dry_run__' then ok := false; err := sqlerrm; end if;
  end;

  res := jsonb_build_object('ok', ok, 'dry', p_dry, 'log', to_jsonb(lines), 'error', err);
  if not p_dry then
    insert into terminal_log (admin_id, script, commands, result, ok) values (auth.uid(), p_script, p_cmds, res, ok);
  end if;
  return res;
end $$;

revoke all on function apply_commands(jsonb, text, boolean) from public, anon;
grant execute on function apply_commands(jsonb, text, boolean) to authenticated;

-- ---------- Export current journey as terminal script (paste it to Claude to continue from the real state) ----------
create or replace function export_script() returns text language plpgsql security definer set search_path = public as $$
declare out text := ''; p phases; a activities; s steps;
  q text;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  for p in select * from phases where status <> 'archived' order by position loop
    out := out || format('phase "%s"%s%s', replace(p.title,'"','\"'),
        coalesce(' icon=' || p.icon, ''), coalesce(' dur="' || p.est_duration || '"', '')) || E'\n';
    for a in select * from activities where phase_id = p.id and status <> 'archived' order by position loop
      out := out || format('  activity "%s" kind=%s%s%s', replace(a.title,'"','\"'), a.kind,
          coalesce(' dur="' || a.est_duration || '"', ''), coalesce(' out="' || replace(a.deliverable,'"','\"') || '"', '')) || E'\n';
      for s in select * from steps where activity_id = a.id and not archived order by position loop
        out := out || format('    step "%s" | %s | %s%s', replace(s.title,'"','\"'), coalesce(s.explanation,''), s.completion,
            case when s.requires_review and s.completion <> 'review' then ' review' else '' end) || E'\n';
      end loop;
      if a.status = 'published' then out := out || format('  publish activity "%s"', replace(a.title,'"','\"')) || E'\n'; end if;
    end loop;
    if p.status = 'published' and p.visible then out := out || format('publish phase "%s"', replace(p.title,'"','\"')) || E'\n'; end if;
  end loop;
  return out;
end $$;
grant execute on function export_script() to authenticated;
