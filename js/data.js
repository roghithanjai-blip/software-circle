// data.js: loads the member's journey (RLS already limits it to published, visible content) and derives progress.
import { sb } from './core.js';

export async function loadJourney(uid) {
  const [tree, prog, subs, rms] = await Promise.all([
    sb.from('phases').select('id,position,title,description,icon,est_duration,prerequisite_phase_id,roadmap_id,activities(id,position,title,summary,objective,deliverable,est_duration,kind,instructions,steps(id,position,title,explanation,completion,resource_url,archived))').order('position'),
    sb.from('step_progress').select('step_id,status').eq('user_id', uid),
    sb.from('submissions').select('id,step_id,status,feedback,image_path,link_url,created_at').eq('user_id', uid).order('created_at', { ascending: false }),
    sb.from('roadmaps').select('id,position,title,summary,icon,curator_name,curator_title,est_duration'),
  ]);
  const err = [tree, prog, subs, rms].find(r => r.error); if (err) throw err.error;
  const st = new Map(prog.data.map(r => [r.step_id, r.status]));
  const sub = new Map(); subs.data.forEach(s => { if (!sub.has(s.step_id)) sub.set(s.step_id, s); });
  const by = (a, b) => a.position - b.position;
  // Build each parent object first so children point at the final objects (step.activity.phase must exist).
  const phases = tree.data.sort(by).map(p => {
    const P = { ...p };
    P.activities = p.activities.sort(by).map(a => {
      const A = { ...a, phase: P };
      A.steps = a.steps.filter(s => !s.archived).sort(by).map(s => ({ ...s, activity: A, state: st.get(s.id) === 'in_progress' ? 'todo' : (st.get(s.id) || 'todo'), sub: sub.get(s.id) || null }));
      return A;
    }).filter(a => a.steps.length);
    return P;
  }).filter(p => p.activities.length);
  phases.forEach(p => {
    p.activities.forEach(a => { a.done = a.steps.filter(s => s.state === 'completed').length; a.complete = a.done === a.steps.length; });
    p.total = p.activities.reduce((n, a) => n + a.steps.length, 0); p.done = p.activities.reduce((n, a) => n + a.done, 0); p.complete = p.total > 0 && p.done === p.total;
  });
  phases.forEach(p => { const pre = phases.find(x => x.id === p.prerequisite_phase_id); p.locked = !!pre && !pre.complete; p.lockedBy = pre?.title; });
  const steps = phases.flatMap(p => p.activities.flatMap(a => a.steps));
  const done = steps.filter(s => s.state === 'completed').length;
  const roadmaps = rms.data.sort(by).map(r => {
    const ps = phases.filter(p => p.roadmap_id === r.id), total = ps.reduce((n, p) => n + p.total, 0), done = ps.reduce((n, p) => n + p.done, 0);
    return { ...r, phases: ps, total, done, pct: total ? Math.round(100 * done / total) : 0, state: !done ? 'Not started' : done === total ? 'Completed' : 'In progress' };
  }).filter(r => r.phases.length);
  return { roadmaps, phases, steps, done, total: steps.length, pct: steps.length ? Math.round(100 * done / steps.length) : 0,
    next: steps.find(s => (s.state === 'todo' || s.state === 'needs_changes') && !s.activity.phase.locked) || null,
    waiting: steps.filter(s => s.state === 'submitted'), changes: steps.filter(s => s.state === 'needs_changes') };
}
