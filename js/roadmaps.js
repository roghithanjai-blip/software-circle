// roadmaps.js: admin Roadmaps panel (the "courses"). Boxes with a deploy switch; a box opens the roadmap editor.
import { el, sb, toast, empty } from './core.js';

// A switch that deploys or undeploys a roadmap. Members only see deployed roadmaps (enforced by the database).
export function deploySwitch(rm, phaseCount, onDone) {
  const i = el('input', { type: 'checkbox', class: 'switch', checked: rm.deployed, 'aria-label': `Deploy ${rm.title}` });
  i.addEventListener('change', async () => {
    const on = i.checked;
    if (on && !phaseCount()) { i.checked = false; return toast('Add at least one phase before deploying.', 'bad'); }
    if (on && !confirm(`Deploy "${rm.title}"? Members it is meant for will see it and get a notification.`)) { i.checked = false; return; }
    if (!on && !confirm(`Undeploy "${rm.title}"? Members stop seeing it. Their progress is kept.`)) { i.checked = true; return; }
    i.disabled = true;
    const { error } = await sb.from('roadmaps').update({ deployed: on }).eq('id', rm.id);
    i.disabled = false;
    if (error) { i.checked = !on; return toast(error.message, 'bad'); }
    rm.deployed = on; toast(on ? 'Deployed.' : 'Undeployed.', 'ok'); onDone?.();
  });
  return i;
}

export async function roadmapsView(main) {
  const { data, error } = await sb.from('roadmaps')
    .select('id,position,title,summary,icon,curator_name,curator_title,est_duration,audience,deployed,phases(id,status,activities(id,status,steps(id,archived)))')
    .eq('archived', false).order('position');
  if (error) throw error;
  const count = r => {
    const ph = r.phases.filter(p => p.status !== 'archived'), acts = ph.flatMap(p => p.activities.filter(a => a.status !== 'archived'));
    return { phases: ph.length, steps: acts.reduce((n, a) => n + a.steps.filter(s => !s.archived).length, 0) };
  };

  const title = el('input', { placeholder: 'New roadmap title', 'aria-label': 'New roadmap title' });
  const create = async () => {
    if (!title.value.trim()) return;
    const { data: row, error: e } = await sb.from('roadmaps').insert({ title: title.value.trim(), position: data.reduce((m, r) => Math.max(m, r.position || 0), 0) + 1 }).select('id').single();
    if (e) return toast(e.code === '23505' ? 'A roadmap with that title already exists.' : e.message, 'bad');
    location.hash = '#/roadmaps/' + row.id;
  };
  title.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); create(); } });

  const boxes = data.map(r => {
    const c = count(r);
    return el('div', { class: 'rbox' + (r.deployed ? ' live' : '') },
      el('div', { class: 'row', style: { flexWrap: 'nowrap' } },
        el('span', { class: 'ricon', 'aria-hidden': 'true' }, r.icon || r.title.slice(0, 1).toUpperCase()),
        el('h3', { class: 'grow' }, el('a', { class: 'rlink', href: '#/roadmaps/' + r.id }, r.title)),
        deploySwitch(r, () => c.phases)),
      r.summary ? el('p', { class: 'muted clamp' }, r.summary) : el('p', { class: 'muted' }, 'No summary yet.'),
      el('p', { class: 'muted' }, r.curator_name ? `Curated by ${r.curator_name}${r.curator_title ? ', ' + r.curator_title : ''}` : 'No curator set'),
      el('div', { class: 'row' }, el('span', { class: 'chip' }, `${c.phases} phases · ${c.steps} steps`), r.est_duration ? el('span', { class: 'chip' }, r.est_duration) : null,
        el('span', { class: 'chip info' }, r.audience.length ? r.audience.join(', ') : 'everyone')),
      el('span', { class: 'rstate' }, r.deployed ? 'Deployed' : 'Not yet deployed'));
  });
  main.replaceChildren(el('div', { class: 'stack', style: { gap: '22px' } },
    el('div', {}, el('h1', {}, 'Roadmaps'), el('p', { class: 'muted' }, 'Prepare roadmaps privately, then flip the switch when they are ready. Open a box to edit it.')),
    el('div', { class: 'rgrid' }, boxes,
      el('div', { class: 'rbox rnew' }, el('h3', {}, 'New roadmap'), title, el('div', {}, el('button', { class: 'btn primary', onclick: create }, 'Create'))))));
}
