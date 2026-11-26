-- schema_terminal_v2.sql
-- Run AFTER schema_v2.sql. Replaces the terminal functions so commands understand roadmaps. Safe to re-run.

drop function if exists t_phase(text);
drop function if exists t_activity(text, text);
drop function if exists t_step(text, text, text);

-- ---------- resolvers: find by title (case-insensitive), fail loudly on missing or ambiguous ----------
create or replace function t_roadmap(p_title text) returns uuid language plpgsql stable as $$
declare ids uuid[];
begin
  select array_agg(id) into ids from roadmaps where lower(title) = lower(p_title) and not archived;
  if ids is null then raise exception 'roadmap "%" not found', p_title; end if;
  if array_length(ids, 1) > 1 then raise exception 'roadmap "%" is ambiguous', p_title; end if;
  return ids[1];
end $$;

create or replace function t_phase(p_title text, p_roadmap text default null) returns uuid language plpgsql stable as $$
declare ids uuid[];
begin
  select array_agg(p.id) into ids from phases p join roadmaps r on r.id = p.roadmap_id
   where lower(p.title) = lower(p_title) and p.status <> 'archived' and not r.archived
     and (p_roadmap is null or lower(r.title) = lower(p_roadmap));
  if ids is null then raise exception 'phase "%" not found', p_title; end if;
  if array_length(ids, 1) > 1 then raise exception 'phase "%" is ambiguous (add: in roadmap "...")', p_title; end if;
  return ids[1];
end $$;

create or replace function t_activity(p_title text, p_phase text default null, p_roadmap text default null) returns uuid language plpgsql stable as $$
declare ids uuid[];
begin
  select array_agg(a.id) into ids from activities a join phases p on p.id = a.phase_id join roadmaps r on r.id = p.roadmap_id
   where lower(a.title) = lower(p_title) and a.status <> 'archived' and not r.archived
     and (p_phase is null or lower(p.title) = lower(p_phase)) and (p_roadmap is null or lower(r.title) = lower(p_roadmap));
  if ids is null then raise exception 'activity "%" not found', p_title; end if;
  if array_length(ids, 1) > 1 then raise exception 'activity "%" is ambiguous (add: in phase "..." or in roadmap "...")', p_title; end if;
  return ids[1];
end $$;

create or replace function t_step(p_title text, p_activity text default null, p_phase text default null, p_roadmap text default null) returns uuid language plpgsql stable as $$
declare ids uuid[];
begin
  select array_agg(s.id) into ids from steps s join activities a on a.id = s.activity_id join phases p on p.id = a.phase_id join roadmaps r on r.id = p.roadmap_id
   where lower(s.title) = lower(p_title) and not s.archived and not r.archived
     and (p_activity is null or lower(a.title) = lower(p_activity)) and (p_phase is null or lower(p.title) = lower(p_phase))
     and (p_roadmap is null or lower(r.title) = lower(p_roadmap));
  if ids is null then raise exception 'step "%" not found', p_title; end if;
  if array_length(ids, 1) > 1 then raise exception 'step "%" is ambiguous (add: in activity "...")', p_title; end if;
  return ids[1];
end $$;

create or replace function t_audience(j jsonb) returns text[] language plpgsql stable as $$
declare arr text[]; bad text;
begin
  if j is null or jsonb_typeof(j) <> 'array' then return '{}'; end if;
  select coalesce(array_agg(lower(k)), '{}') into arr from jsonb_array_elements_text(j) k;
  select string_agg(x, ', ') into bad from unnest(arr) x where x not in (select key from roles);
  if bad is not null then raise exception 'unknown role in audience: %', bad; end if;
  return arr;
end $$;

-- ---------- the runner ----------
-- p_dry = true  -> performs everything, reports the log, then rolls back (preview).
-- p_dry = false -> commits only if every command succeeds; otherwise nothing changes.
create or replace function apply_commands(p_cmds jsonb, p_script text default null, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c jsonb; s jsonb; op text; tgt text;
  lines text[] := '{}'; rid uuid; pid uuid; aid uuid; sid uuid; n int;
  was_live boolean; ok boolean := true; err text; res jsonb;
begin
  if not is_admin() then raise exception 'admin only'; end if;

  begin  -- inner block = savepoint; any error (or the dry run) rolls it back
    for c in select * from jsonb_array_elements(p_cmds) loop
      op := c->>'op'; tgt := c->>'target'; s := coalesce(c->'set', '{}'::jsonb);

      if op = 'add_roadmap' then
        if exists (select 1 from roadmaps where lower(title) = lower(c->>'title') and not archived) then
          raise exception 'roadmap "%" already exists: use edit roadmap', c->>'title'; end if;
        insert into roadmaps (position, title, summary, icon, curator_name, curator_title, curator_link, est_duration, audience)
        values ((select coalesce(max(position), 0) + 1 from roadmaps), c->>'title', c->>'summary', c->>'icon', c->>'curator_name',
                c->>'curator_title', c->>'curator_link', c->>'est_duration', t_audience(c->'audience'));
        lines := lines || format('+ roadmap "%s" (hidden until deployed)', c->>'title');

      elsif op = 'add_phase' then
        rid := t_roadmap(c->>'roadmap');
        insert into phases (roadmap_id, position, title, description, icon, est_duration)
        values (rid, (select coalesce(max(position), 0) + 1 from phases where roadmap_id = rid), c->>'title', c->>'description', c->>'icon', c->>'est_duration');
        lines := lines || format('+ phase "%s" in "%s"', c->>'title', c->>'roadmap');

      elsif op = 'add_activity' then
        pid := t_phase(c->>'phase', c->>'roadmap');
        insert into activities (phase_id, position, title, summary, objective, deliverable, est_duration, kind, instructions, requires_submission)
        values (pid, (select coalesce(max(position), 0) + 1 from activities where phase_id = pid), c->>'title', c->>'summary', c->>'objective',
                c->>'deliverable', c->>'est_duration', coalesce(c->>'kind', 'build'), c->>'instructions', coalesce((c->>'requires_submission')::boolean, false));
        lines := lines || format('+ activity "%s" in "%s"', c->>'title', c->>'phase');

      elsif op = 'add_step' then
        aid := t_activity(c->>'activity', c->>'phase', c->>'roadmap');
        insert into steps (activity_id, position, title, explanation, completion, requires_review, resource_url)
        values (aid, (select coalesce(max(position), 0) + 1 from steps where activity_id = aid), c->>'title', c->>'explanation',
                coalesce(c->>'completion', 'self')::completion_type, coalesce((c->>'requires_review')::boolean, false), c->>'resource_url');
        lines := lines || format('+ step "%s" in "%s"', c->>'title', c->>'activity');

      elsif op = 'edit' then
        if tgt = 'roadmap' then
          rid := t_roadmap(c->>'match');
          update roadmaps set title = coalesce(s->>'title', title), summary = coalesce(s->>'summary', summary), icon = coalesce(s->>'icon', icon),
                 curator_name = coalesce(s->>'curator_name', curator_name), curator_title = coalesce(s->>'curator_title', curator_title),
                 curator_link = coalesce(s->>'curator_link', curator_link), est_duration = coalesce(s->>'est_duration', est_duration),
                 audience = case when s->'audience' is not null then t_audience(s->'audience') else audience end where id = rid;
        elsif tgt = 'phase' then
          pid := t_phase(c->>'match', c->>'roadmap');
          update phases set title = coalesce(s->>'title', title), description = coalesce(s->>'description', description),
                 icon = coalesce(s->>'icon', icon), est_duration = coalesce(s->>'est_duration', est_duration) where id = pid;
        elsif tgt = 'activity' then
          aid := t_activity(c->>'match', c->>'phase', c->>'roadmap');
          update activities set title = coalesce(s->>'title', title), summary = coalesce(s->>'summary', summary),
                 objective = coalesce(s->>'objective', objective), deliverable = coalesce(s->>'deliverable', deliverable),
                 est_duration = coalesce(s->>'est_duration', est_duration), kind = coalesce(s->>'kind', kind),
                 instructions = coalesce(s->>'instructions', instructions),
                 requires_submission = coalesce((s->>'requires_submission')::boolean, requires_submission) where id = aid;
        elsif tgt = 'step' then
          sid := t_step(c->>'match', c->>'activity', c->>'phase', c->>'roadmap');
          update steps set title = coalesce(s->>'title', title), explanation = coalesce(s->>'explanation', explanation),
                 completion = coalesce((s->>'completion')::completion_type, completion),
                 requires_review = coalesce((s->>'requires_review')::boolean, requires_review),
                 resource_url = coalesce(s->>'resource_url', resource_url) where id = sid;
        else raise exception 'cannot edit "%"', tgt; end if;
        lines := lines || format('~ %s "%s" edited', tgt, c->>'match');

      elsif op = 'move' then
        if tgt = 'roadmap' then
          rid := t_roadmap(c->>'match');
          n := coalesce((c->>'at')::int, (select coalesce(max(position), 0) + 1 from roadmaps));
          update roadmaps set position = position + 1 where position >= n and id <> rid and not archived;
          update roadmaps set position = n where id = rid;
          with r as (select id, row_number() over (order by position, created_at) rn from roadmaps where not archived)
            update roadmaps x set position = r.rn from r where x.id = r.id;
        elsif tgt = 'phase' then
          pid := t_phase(c->>'match', c->>'roadmap');
          rid := case when c->>'to_roadmap' is not null then t_roadmap(c->>'to_roadmap') else (select roadmap_id from phases where id = pid) end;
          n := coalesce((c->>'at')::int, (select coalesce(max(position), 0) + 1 from phases where roadmap_id = rid));
          update phases set position = position + 1 where roadmap_id = rid and position >= n and id <> pid;
          update phases set roadmap_id = rid, position = n where id = pid;
          with r as (select id, row_number() over (order by position, created_at) rn from phases where roadmap_id = rid)
            update phases p set position = r.rn from r where p.id = r.id;
        elsif tgt = 'activity' then
          aid := t_activity(c->>'match', c->>'phase', c->>'roadmap');
          pid := case when c->>'to_phase' is not null then t_phase(c->>'to_phase', coalesce(c->>'to_roadmap', c->>'roadmap'))
                      else (select phase_id from activities where id = aid) end;
          n := coalesce((c->>'at')::int, (select coalesce(max(position), 0) + 1 from activities where phase_id = pid));
          update activities set position = position + 1 where phase_id = pid and position >= n and id <> aid;
          update activities set phase_id = pid, position = n where id = aid;
          with r as (select id, row_number() over (order by position, id) rn from activities where phase_id = pid)
            update activities a set position = r.rn from r where a.id = r.id;
        elsif tgt = 'step' then
          sid := t_step(c->>'match', c->>'activity', c->>'phase', c->>'roadmap');
          aid := case when c->>'to_activity' is not null then t_activity(c->>'to_activity', c->>'phase', c->>'roadmap')
                      else (select activity_id from steps where id = sid) end;
          n := coalesce((c->>'at')::int, (select coalesce(max(position), 0) + 1 from steps where activity_id = aid));
          update steps set position = position + 1 where activity_id = aid and position >= n and id <> sid;
          update steps set activity_id = aid, position = n where id = sid;
          with r as (select id, row_number() over (order by position, id) rn from steps where activity_id = aid)
            update steps x set position = r.rn from r where x.id = r.id;
        else raise exception 'cannot move "%"', tgt; end if;
        lines := lines || format('> moved %s "%s"', tgt, c->>'match');

      elsif op in ('deploy', 'undeploy') then
        rid := t_roadmap(c->>'match');
        if op = 'deploy' and not exists (select 1 from phases where roadmap_id = rid and status <> 'archived') then
          raise exception 'roadmap "%" has no phases yet', c->>'match'; end if;
        update roadmaps set deployed = (op = 'deploy') where id = rid;
        lines := lines || format('%s roadmap "%s"', case when op = 'deploy' then '↑ deployed' else '↓ undeployed' end, c->>'match');

      elsif op in ('publish', 'unpublish') then   -- optional hold-back inside a roadmap; the roadmap deploy switch is the real gate
        if tgt = 'phase' then
          pid := t_phase(c->>'match', c->>'roadmap');
          select status = 'published' and visible into was_live from phases where id = pid;
          if op = 'publish' then
            update phases set status = 'published', visible = true where id = pid;
            if coalesce((c->>'cascade')::boolean, false) then
              update activities set status = 'published' where phase_id = pid and status <> 'archived';
            end if;
            if not was_live then
              insert into notifications (user_id, kind, body)
                select pr.id, 'phase_published', format('New phase available: %s', c->>'match')
                from profiles pr, roadmaps r where r.id = (select roadmap_id from phases where id = pid) and r.deployed
                  and pr.role = 'member' and pr.active and (cardinality(r.audience) = 0 or pr.role_key = any (r.audience));
            end if;
          else
            update phases set status = 'draft', visible = false where id = pid;
          end if;
        elsif tgt = 'activity' then
          aid := t_activity(c->>'match', c->>'phase', c->>'roadmap');
          update activities set status = case when op = 'publish' then 'published' else 'draft' end::content_status where id = aid;
        else raise exception 'cannot % "%"', op, tgt; end if;
        lines := lines || format('%s %s "%s"', case when op = 'publish' then '↑ published' else '↓ unpublished' end, tgt, c->>'match');

      elsif op = 'archive' then
        if tgt = 'roadmap' then update roadmaps set archived = true, deployed = false where id = t_roadmap(c->>'match');
        elsif tgt = 'phase' then update phases set status = 'archived', visible = false where id = t_phase(c->>'match', c->>'roadmap');
        elsif tgt = 'activity' then update activities set status = 'archived' where id = t_activity(c->>'match', c->>'phase', c->>'roadmap');
        elsif tgt = 'step' then update steps set archived = true where id = t_step(c->>'match', c->>'activity', c->>'phase', c->>'roadmap');
        else raise exception 'cannot archive "%"', tgt; end if;
        lines := lines || format('- archived %s "%s"', tgt, c->>'match');

      elsif op = 'delete' then  -- hard delete, only if nobody has progress on it
        if tgt = 'roadmap' then
          rid := t_roadmap(c->>'match');
          if exists (select 1 from step_progress sp join steps s on s.id = sp.step_id join activities a on a.id = s.activity_id
                     join phases p on p.id = a.phase_id where p.roadmap_id = rid)
            then raise exception 'roadmap "%" has member progress: archive it instead', c->>'match'; end if;
          delete from roadmaps where id = rid;
        elsif tgt = 'phase' then
          pid := t_phase(c->>'match', c->>'roadmap');
          if exists (select 1 from step_progress sp join steps s on s.id = sp.step_id join activities a on a.id = s.activity_id where a.phase_id = pid)
            then raise exception 'phase "%" has member progress: archive it instead', c->>'match'; end if;
          delete from phases where id = pid;
        elsif tgt = 'activity' then
          aid := t_activity(c->>'match', c->>'phase', c->>'roadmap');
          if exists (select 1 from step_progress sp join steps s on s.id = sp.step_id where s.activity_id = aid)
            then raise exception 'activity "%" has member progress: archive it instead', c->>'match'; end if;
          delete from activities where id = aid;
        elsif tgt = 'step' then
          sid := t_step(c->>'match', c->>'activity', c->>'phase', c->>'roadmap');
          if exists (select 1 from step_progress where step_id = sid)
            then raise exception 'step "%" has member progress: archive it instead', c->>'match'; end if;
          delete from steps where id = sid;
        else raise exception 'cannot delete "%"', tgt; end if;
        lines := lines || format('x deleted %s "%s"', tgt, c->>'match');

      elsif op = 'dup_activity' then
        aid := t_activity(c->>'match', c->>'phase', c->>'roadmap');
        insert into activities (phase_id, position, title, summary, objective, deliverable, est_duration, kind, instructions, requires_submission, status)
          select phase_id, position + 1, title || ' (copy)', summary, objective, deliverable, est_duration, kind, instructions, requires_submission, 'draft'
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

-- ---------- export: the live journey as a script that apply_commands can rebuild ----------
create or replace function t_q(x text) returns text language sql immutable as $$
  select '"' || replace(replace(regexp_replace(coalesce(x, ''), '\s+', ' ', 'g'), '\', '\\'), '"', '\"') || '"'; $$;
create or replace function t_opt(k text, v text) returns text language sql immutable as $$
  select case when coalesce(trim(v), '') = '' then '' else ' ' || k || '=' || t_q(v) end; $$;

create or replace function export_script() returns text language plpgsql security definer set search_path = public as $$
declare out text := ''; r roadmaps; p phases; a activities; s steps;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  for r in select * from roadmaps where not archived order by position loop
    out := out || 'roadmap ' || t_q(r.title) || t_opt('curator', r.curator_name) || t_opt('curator_title', r.curator_title)
        || case when r.curator_link is not null then ' curator_link=' || r.curator_link else '' end
        || t_opt('dur', r.est_duration) || t_opt('sum', r.summary) || t_opt('icon', r.icon)
        || case when cardinality(r.audience) > 0 then ' audience=' || array_to_string(r.audience, ',') else '' end || E'\n';
    for p in select * from phases where roadmap_id = r.id and status <> 'archived' order by position loop
      out := out || '  phase ' || t_q(p.title) || t_opt('icon', p.icon) || t_opt('dur', p.est_duration) || t_opt('desc', p.description) || E'\n';
      for a in select * from activities where phase_id = p.id and status <> 'archived' order by position loop
        out := out || '    activity ' || t_q(a.title) || t_opt('kind', a.kind) || t_opt('dur', a.est_duration) || t_opt('obj', a.objective)
            || t_opt('out', a.deliverable) || t_opt('sum', a.summary) || t_opt('instr', a.instructions)
            || case when a.requires_submission then ' submit=yes' else '' end || E'\n';
        for s in select * from steps where activity_id = a.id and not archived order by position loop
          out := out || '      step ' || t_q(s.title) || ' | '
              || replace(replace(replace(regexp_replace(coalesce(s.explanation, ''), '\s+', ' ', 'g'), '\', '\\'), '"', '\"'), '|', '/') || ' | '
              || s.completion || case when s.requires_review and s.completion <> 'review' then ' review' else '' end
              || case when s.resource_url is not null then ' link=' || s.resource_url else '' end || E'\n';
        end loop;
      end loop;
    end loop;
    for p in select * from phases where roadmap_id = r.id and status <> 'archived' and (status <> 'published' or not visible) order by position loop
      out := out || 'unpublish phase ' || t_q(p.title) || ' in roadmap ' || t_q(r.title) || E'\n';
    end loop;
    for a in select a2.* from activities a2 join phases p2 on p2.id = a2.phase_id where p2.roadmap_id = r.id and a2.status = 'draft' order by p2.position, a2.position loop
      out := out || 'unpublish activity ' || t_q(a.title) || ' in phase ' || t_q((select title from phases where id = a.phase_id)) || ' in roadmap ' || t_q(r.title) || E'\n';
    end loop;
    if r.deployed and exists (select 1 from phases where roadmap_id = r.id and status <> 'archived') then out := out || 'deploy roadmap ' || t_q(r.title) || E'\n'; end if;
    out := out || E'\n';
  end loop;
  return out;
end $$;
grant execute on function export_script() to authenticated;
