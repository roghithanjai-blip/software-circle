// editor.js: GUI journey editor. Edits the same tables the terminal does, so both stay in sync.
import { el, sb, rpc, toast, empty } from './core.js';

const KINDS = ['Build', 'Explore', 'Research', 'Challenge', 'Collaboration'];
const COMP = [['self', 'Self-complete'], ['evidence', 'Screenshot'], ['link', 'Link'], ['review', 'Admin review']];
const STATUS = [['draft', 'Draft'], ['published', 'Published'], ['archived', 'Archived']];
const byPos = (a, b) => (a.position - b.position) || String(a.id).localeCompare(String(b.id));
const nextPos = rows => rows.reduce((m, r) => Math.max(m, r.position || 0), 0) + 1;
const open = new Set();
let root, showArch = false, refocus = null, lastComp = 'self', inited = false;

async function save(table, id, patch) {
  const { error } = await sb.from(table).update(patch).eq('id', id);
  if (error) { toast(error.message, 'bad'); return false; }
  return true;
}
function inline(table, row, key, ph, cls = '') {
  const i = el('input', { value: row[key] || '', placeholder: ph, class: cls, 'aria-label': ph });
  i.addEventListener('change', async () => {
    const v = i.value.trim();
    if (key === 'title' && !v) { i.value = row.title; return toast('A title is required.', 'bad'); }
    if (await save(table, row.id, { [key]: v || null })) { row[key] = v || null; toast('Saved', 'ok'); } else i.value = row[key] || '';
  });
  return i;
}
async function reorder(table, list, row, dir) {
  const a = [...list].sort(byPos), i = a.findIndex(r => r.id === row.id), j = i + dir;
  if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
  const res = await Promise.all(a.map((r, n) => r.position !== n + 1 ? sb.from(table).update({ position: n + 1 }).eq('id', r.id) : null).filter(Boolean));
  const err = res.find(r => r.error); if (err) return toast(err.error.message, 'bad');
  draw();
}
const arrows = (table, list, row) => el('span', { class: 'row', style: { gap: '2px' } },
  el('button', { class: 'btn ghost mini', 'aria-label': 'Move up', onclick: () => reorder(table, list, row, -1) }, '↑'),
  el('button', { class: 'btn ghost mini', 'aria-label': 'Move down', onclick: () => reorder(table, list, row, 1) }, '↓'));
const archBtn = (table, row) => {
  const gone = table === 'steps' ? row.archived : row.status === 'archived';
  return el('button', { class: 'btn ghost ' + (gone ? '' : 'danger'), onclick: async () => {
    if (!gone && !confirm('Archive this? It disappears for members but their progress is kept.')) return;
    const patch = table === 'steps' ? { archived: !gone } : { status: gone ? 'draft' : 'archived', ...(table === 'phases' && !gone ? { visible: false } : {}) };
    if (await save(table, row.id, patch)) draw();
  } }, gone ? 'Restore' : 'Archive');
};

// Modal form for the longer fields.
function form(title, fields, vals, onSave) {
  const dlg = el('dialog', { class: 'dlg' }), box = {};
  const body = fields.map(f => {
    const v = vals[f.k];
    const c = f.type === 'textarea' ? el('textarea', { rows: 3 }, v || '')
      : f.type === 'select' ? el('select', {}, f.options.map(([o, l]) => el('option', { value: o, selected: o === (v ?? '') }, l)))
      : f.type === 'check' ? el('input', { type: 'checkbox', checked: !!v })
      : el('input', { value: v ?? '', list: f.list });
    box[f.k] = c;
    return f.type === 'check' ? el('label', { class: 'chk' }, c, f.label) : el('label', {}, f.label, c);
  });
  const read = () => Object.fromEntries(fields.map(f => [f.k, f.type === 'check' ? box[f.k].checked : (box[f.k].value.trim() || null)]));
  const f = el('form', {}, el('h2', {}, title), body, el('datalist', { id: 'kinds' }, KINDS.map(k => el('option', { value: k }))),
    el('div', { class: 'row', style: { justifyContent: 'flex-end' } },
      el('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close() }, 'Cancel'), el('button', { class: 'btn primary', type: 'submit' }, 'Save')));
  f.onsubmit = async e => { e.preventDefault(); if (await onSave(read())) { dlg.close(); draw(); } };
  dlg.append(f); dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal();
}
const need = (cond, msg) => { if (!cond) toast(msg, 'bad'); return cond; };

function phaseForm(p, phases) {
  form('Phase details', [
    { k: 'title', label: 'Title' }, { k: 'icon', label: 'Icon (an emoji)' }, { k: 'est_duration', label: 'Estimated duration' },
    { k: 'description', label: 'Description', type: 'textarea' }, { k: 'status', label: 'Status', type: 'select', options: STATUS },
    { k: 'visible', label: 'Visible to members when published', type: 'check' },
    { k: 'prerequisite_phase_id', label: 'Unlocks after', type: 'select', options: [['', 'No prerequisite'], ...phases.filter(x => x.id !== p.id).map(x => [x.id, x.title])] },
  ], p, v => need(v.title, 'A title is required.') && save('phases', p.id, v));
}
function activityForm(a) {
  form('Activity details', [
    { k: 'title', label: 'Title' }, { k: 'summary', label: 'Short description' }, { k: 'objective', label: 'Objective', type: 'textarea' },
    { k: 'deliverable', label: 'Expected outcome / deliverable' }, { k: 'est_duration', label: 'Estimated duration' },
    { k: 'kind', label: 'Type (Build, Explore, Research…)', list: 'kinds' }, { k: 'instructions', label: 'Activity instructions', type: 'textarea' },
    { k: 'requires_submission', label: 'Requires a final submission', type: 'check' }, { k: 'status', label: 'Status', type: 'select', options: STATUS },
  ], a, v => need(v.title, 'A title is required.') && save('activities', a.id, { ...v, kind: v.kind || 'build' }));
}
function stepForm(s) {
  form('Step details', [
    { k: 'title', label: 'Title' }, { k: 'explanation', label: 'One-line explanation' },
    { k: 'completion', label: 'Completion', type: 'select', options: COMP }, { k: 'requires_review', label: 'Needs admin approval', type: 'check' },
    { k: 'resource_url', label: 'Resource link (optional)' },
  ], s, v => {
    if (!need(v.title, 'A title is required.')) return false;
    if (!need(!v.resource_url || /^https?:\/\//.test(v.resource_url), 'The link must start with http:// or https://')) return false;
    return save('steps', s.id, { ...v, requires_review: v.completion === 'self' ? false : v.requires_review });
  });
}

function stepRow(s, steps) {
  const rev = el('input', { type: 'checkbox', checked: s.requires_review, 'aria-label': 'Needs admin approval', title: 'Needs admin approval' });
  const comp = el('select', { 'aria-label': 'Completion type' }, COMP.map(([v, l]) => el('option', { value: v, selected: v === s.completion }, l)));
  const sync = () => { rev.disabled = comp.value === 'self' || comp.value === 'review'; };
  comp.onchange = async () => {
    const patch = { completion: comp.value, ...(comp.value === 'self' ? { requires_review: false } : {}) };
    if (await save('steps', s.id, patch)) { Object.assign(s, patch); rev.checked = !!s.requires_review; sync(); toast('Saved', 'ok'); }
  };
  rev.onchange = async () => { if (await save('steps', s.id, { requires_review: rev.checked })) s.requires_review = rev.checked; };
  sync();
  return el('div', { class: 'srow' + (s.archived ? ' gone' : '') }, arrows('steps', steps, s),
    inline('steps', s, 'title', 'Step title'), inline('steps', s, 'explanation', 'One-line explanation'), comp,
    el('label', { class: 'chk muted', title: 'Needs admin approval' }, rev, 'Review'),
    el('span', { class: 'row', style: { gap: '4px', flexWrap: 'nowrap' } }, el('button', { class: 'btn ghost', onclick: () => stepForm(s) }, 'Details'), archBtn('steps', s)));
}
function addStep(a, steps) {
  const t = el('input', { placeholder: 'New step title, then Enter', 'data-add': a.id }), x = el('input', { placeholder: 'One-line explanation' });
  const c = el('select', { 'aria-label': 'Completion type' }, COMP.map(([v, l]) => el('option', { value: v, selected: v === lastComp }, l)));
  const go = async () => {
    if (!t.value.trim()) return;
    lastComp = c.value;
    const { error } = await sb.from('steps').insert({ activity_id: a.id, position: nextPos(steps), title: t.value.trim(), explanation: x.value.trim() || null, completion: c.value, requires_review: false });
    if (error) return toast(error.message, 'bad');
    refocus = a.id; draw();
  };
  for (const i of [t, x]) i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  return el('div', { class: 'srow' }, el('span'), t, x, c, el('span'), el('button', { class: 'btn', onclick: go }, 'Add step'));
}
async function duplicate(a) {
  const { id, created_at, steps, ...rest } = a;
  const { data, error } = await sb.from('activities').insert({ ...rest, title: a.title + ' (copy)', status: 'draft', position: a.position + 1 }).select('id').single();
  if (error) return toast(error.message, 'bad');
  const copy = steps.filter(s => !s.archived).map(({ id, activity_id, ...r }) => ({ ...r, activity_id: data.id }));
  if (copy.length) { const r = await sb.from('steps').insert(copy); if (r.error) return toast(r.error.message, 'bad'); }
  toast('Duplicated as a draft.', 'ok'); draw();
}
function activityView(a, acts) {
  const steps = a.steps.sort(byPos).filter(s => showArch || !s.archived);
  return el('div', { class: 'stack', style: { marginTop: '18px' } },
    el('div', { class: 'row' }, arrows('activities', acts, a), inline('activities', a, 'title', 'Activity title', 'title-in'),
      el('span', { class: 'chip info' }, a.kind), el('span', { class: 'chip ' + (a.status === 'published' ? 'ok' : a.status === 'draft' ? 'warn' : '') }, a.status),
      el('button', { class: 'btn ghost', onclick: () => activityForm(a) }, 'Details'), el('button', { class: 'btn ghost', onclick: () => duplicate(a) }, 'Duplicate'), archBtn('activities', a)),
    steps.map(s => stepRow(s, steps)), addStep(a, steps));
}
async function publish(p, on) {
  try {
    const r = await rpc('apply_commands', { p_cmds: [{ op: on ? 'publish' : 'unpublish', target: 'phase', match: p.title, cascade: on }], p_script: `${on ? 'publish' : 'unpublish'} phase "${p.title}"${on ? ' all' : ''}  # from the editor`, p_dry: false });
    if (!r.ok) return toast(r.error || 'Could not change publishing.', 'bad');
    toast(on ? 'Published. Members were notified.' : 'Unpublished.', 'ok'); draw();
  } catch {}
}
function phaseView(p, phases) {
  const acts = p.activities.sort(byPos).filter(a => showArch || a.status !== 'archived');
  const live = p.status === 'published' && p.visible;
  const t = el('input', { placeholder: 'New activity title, then Enter' });
  const addAct = async () => {
    if (!t.value.trim()) return;
    const { error } = await sb.from('activities').insert({ phase_id: p.id, position: nextPos(acts), title: t.value.trim() });
    if (error) return toast(error.message, 'bad'); open.add(p.id); draw();
  };
  t.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addAct(); } });
  const icon = inline('phases', p, 'icon', 'Icon'); icon.style.cssText = 'width:54px;text-align:center';
  const d = el('details', { class: 'card pe', open: open.has(p.id) },
    el('summary', {}, arrows('phases', phases, p), icon, inline('phases', p, 'title', 'Phase title', 'title-in'),
      el('span', { class: 'chip ' + (live ? 'ok' : p.status === 'draft' ? 'warn' : '') }, live ? 'live' : p.status === 'published' ? 'hidden' : p.status),
      el('button', { class: 'btn ' + (live ? 'ghost' : 'primary'), onclick: () => publish(p, !live) }, live ? 'Unpublish' : 'Publish'),
      el('button', { class: 'btn ghost', onclick: () => phaseForm(p, phases) }, 'Details'), archBtn('phases', p)),
    acts.length ? acts.map(a => activityView(a, acts)) : el('p', { class: 'muted', style: { marginTop: '14px' } }, 'No activities yet. Add the first one below.'),
    el('div', { class: 'row', style: { marginTop: '18px' } }, el('div', { style: { flex: 1, minWidth: '220px' } }, t), el('button', { class: 'btn', onclick: addAct }, 'Add activity')));
  d.addEventListener('toggle', () => d.open ? open.add(p.id) : open.delete(p.id));
  return d;
}

async function draw() {
  const { data, error } = await sb.from('phases').select('*, activities(*, steps(*))').order('position');
  if (error) return root.replaceChildren(empty('Could not load the journey', error.message));
  const phases = data.sort(byPos).filter(p => showArch || p.status !== 'archived');
  if (!inited && phases[0]) { open.add(phases[0].id); inited = true; }
  const np = el('input', { placeholder: 'New phase title, then Enter' });
  const addPhase = async () => {
    if (!np.value.trim()) return;
    const { error: e } = await sb.from('phases').insert({ position: nextPos(data), title: np.value.trim() });
    if (e) return toast(e.message, 'bad'); draw();
  };
  np.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); addPhase(); } });
  const arch = el('input', { type: 'checkbox', checked: showArch, onchange: ev => { showArch = ev.target.checked; draw(); } });
  root.replaceChildren(
    el('div', {}, el('h1', {}, 'Journey editor'), el('p', { class: 'muted' }, 'Edit anything here, or use the Terminal for bulk changes. New content stays draft until you publish it.')),
    el('div', { class: 'row' }, el('div', { style: { flex: 1, minWidth: '220px' } }, np), el('button', { class: 'btn primary', onclick: addPhase }, 'Add phase'),
      el('label', { class: 'chk muted' }, arch, 'Show archived'), el('a', { class: 'btn ghost', href: '#/terminal' }, 'Open terminal')),
    ...(phases.length ? phases.map(p => phaseView(p, phases)) : [empty('No phases yet', 'Type a title above and press Enter.')]));
  if (refocus) { root.querySelector(`[data-add="${refocus}"]`)?.focus(); refocus = null; }
}
export async function journeyView(main) { root = el('div', { class: 'stack', style: { gap: '18px' } }); main.replaceChildren(root); await draw(); }
