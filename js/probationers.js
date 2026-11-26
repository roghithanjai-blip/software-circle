// probationers.js: tracking only. Humans decide outcomes; nothing here auto-rejects anyone.
import { el, sb, toast, empty, timeAgo, fmtDate } from './core.js';

const OUTCOMES = ['pending', 'accepted', 'extended', 'not_selected'];
const oc = o => ({ accepted: 'ok', extended: 'warn', not_selected: 'bad' }[o] || '');
const label = o => o.replace('_', ' ');
const safeUrl = u => /^https?:\/\//.test(u || '') ? u : null;

export async function probationersView(main, me) {
  const st = { sort: 'name', dir: 1, filter: 'all', open: null };
  const root = el('div', { class: 'stack' }); main.replaceChildren(root);

  async function load() {
    const [pr, prog, subs, members] = await Promise.all([
      sb.from('probations').select('user_id,start_date,end_date,outcome,decision_note,p:profiles!probations_user_id_fkey(full_name,last_active_at,github_url)'),
      sb.rpc('probation_progress'),   // counted in the database, not by downloading every completed step
      sb.from('submissions').select('user_id').eq('status', 'submitted'),
      sb.from('profiles').select('id,full_name').eq('role', 'member').order('full_name'),
    ]);
    const err = [pr, prog, subs, members].find(r => r.error); if (err) throw err.error;
    const by = new Map(); prog.data.forEach(r => (by.get(r.user_id) || by.set(r.user_id, []).get(r.user_id)).push(r));
    const pend = new Map(); subs.data.forEach(r => pend.set(r.user_id, (pend.get(r.user_id) || 0) + 1));
    const rows = pr.data.map(r => {
      const acts = by.get(r.user_id) || [], total = acts.reduce((n, a) => n + a.total, 0), n = acts.reduce((c, a) => c + a.done, 0);
      const left = acts.filter(a => a.done < a.total).map(a => ({ title: a.activity_title }));
      return { ...r, name: r.p?.full_name || 'Unnamed', done: n, total, pct: total ? Math.round(100 * n / total) : 0, left,
        current: left[0]?.title || (total ? 'All complete' : 'Nothing published'), pending: pend.get(r.user_id) || 0, last: r.p?.last_active_at };
    });
    return { rows, free: members.data.filter(m => !pr.data.some(r => r.user_id === m.id)) };
  }

  function addForm(free) {
    const sel = el('select', {}, el('option', { value: '' }, free.length ? 'Choose a member…' : 'No members available'), free.map(m => el('option', { value: m.id }, m.full_name || m.id.slice(0, 8))));
    const s = el('input', { type: 'date', 'aria-label': 'Start date', value: new Date().toISOString().slice(0, 10) }), e = el('input', { type: 'date', 'aria-label': 'End date' });
    const go = el('button', { class: 'btn primary', onclick: async () => {
      if (!sel.value) return toast('Choose a member first.', 'bad');
      const { error } = await sb.from('probations').insert({ user_id: sel.value, start_date: s.value || null, end_date: e.value || null });
      if (error) return toast(error.message, 'bad'); toast('Probationer added.', 'ok'); render();
    } }, 'Add probationer');
    return el('div', { class: 'card row' }, el('div', { style: { minWidth: '200px', flex: 1 } }, sel), el('label', {}, 'Start', s), el('label', {}, 'End', e), go);
  }

  async function detail(r) {
    const box = el('div', { class: 'stack', style: { padding: '14px 4px' } });
    const { data: notes } = await sb.from('probation_notes').select('body,created_at,a:profiles!probation_notes_author_fkey(full_name)').eq('user_id', r.user_id).order('created_at', { ascending: false });
    const note = el('textarea', { rows: 2, placeholder: 'Leave feedback for your records' });
    const addNote = el('button', { class: 'btn', onclick: async () => {
      if (!note.value.trim()) return;
      const { error } = await sb.from('probation_notes').insert({ user_id: r.user_id, author: me.id, body: note.value.trim() });
      if (error) return toast(error.message, 'bad'); toast('Note saved.', 'ok'); render();
    } }, 'Add note');
    const out = el('select', {}, OUTCOMES.map(o => el('option', { value: o, selected: o === r.outcome }, label(o))));
    const why = el('textarea', { rows: 2, placeholder: 'Decision note (optional)' }, r.decision_note || '');
    const s = el('input', { type: 'date', value: r.start_date || '' }), e = el('input', { type: 'date', value: r.end_date || '' });
    const save = el('button', { class: 'btn primary', onclick: async () => {
      const { error } = await sb.from('probations').update({ outcome: out.value, decision_note: why.value.trim() || null, start_date: s.value || null, end_date: e.value || null,
        decided_by: out.value === 'pending' ? null : me.id, decided_at: out.value === 'pending' ? null : new Date().toISOString() }).eq('user_id', r.user_id);
      if (error) return toast(error.message, 'bad'); toast('Saved.', 'ok'); render();
    } }, 'Save decision');
    const gh = safeUrl(r.p?.github_url);
    box.append(
      el('div', { class: 'row' }, el('span', { class: 'muted' }, `${r.done}/${r.total} steps`), r.pending ? el('span', { class: 'chip warn' }, `${r.pending} awaiting review`) : null, gh ? el('a', { href: gh, target: '_blank', rel: 'noopener noreferrer' }, 'GitHub') : null),
      el('div', {}, el('h3', {}, 'Incomplete activities'), r.left.length ? el('div', { class: 'row', style: { marginTop: '8px' } }, r.left.map(a => el('span', { class: 'chip' }, a.title))) : el('p', { class: 'muted' }, 'Nothing left in the published journey.')),
      el('div', { class: 'stack' }, el('h3', {}, 'Feedback notes'), ...(notes?.length ? notes.map(n => el('p', {}, el('span', { class: 'muted' }, `${n.a?.full_name || 'Admin'} · ${timeAgo(n.created_at)}: `), n.body)) : [el('p', { class: 'muted' }, 'No notes yet.')]), note, addNote),
      el('div', { class: 'stack' }, el('h3', {}, 'Decision'), el('p', { class: 'muted' }, 'Progress is tracked automatically. The outcome is always your call.'), el('div', { class: 'row' }, out, el('label', {}, 'Start', s), el('label', {}, 'End', e)), why, save));
    return box;
  }

  async function render() {
    let data; try { data = await load(); } catch (e) { return root.replaceChildren(empty('Could not load probationers', e.message)); }
    const { rows, free } = data, key = { name: r => r.name.toLowerCase(), progress: r => r.pct, steps: r => r.done, pending: r => r.pending, active: r => r.last ? +new Date(r.last) : 0, status: r => r.outcome };
    const shown = rows.filter(r => st.filter === 'all' || r.outcome === st.filter).sort((a, b) => { const x = key[st.sort](a), y = key[st.sort](b); return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
    const th = (k, t) => el('th', {}, el('button', { class: 'btn ghost', style: { padding: '2px 6px' }, onclick: () => { st.dir = st.sort === k ? -st.dir : 1; st.sort = k; render(); } }, t + (st.sort === k ? (st.dir > 0 ? ' ↑' : ' ↓') : '')));
    const filter = el('select', { 'aria-label': 'Filter by status', style: { width: 'auto' }, onchange: ev => { st.filter = ev.target.value; render(); } }, ['all', ...OUTCOMES].map(o => el('option', { value: o, selected: o === st.filter }, o === 'all' ? 'All statuses' : label(o))));
    const body = el('tbody');
    for (const r of shown) {
      const open = st.open === r.user_id;
      body.append(el('tr', { style: { cursor: 'pointer', borderTop: '1px solid var(--line)' }, onclick: () => { st.open = open ? null : r.user_id; render(); } },
        el('td', { style: { padding: '10px 8px' } }, r.name), el('td', {}, `${r.pct}%`), el('td', { class: 'muted' }, r.current), el('td', {}, `${r.done}/${r.total}`),
        el('td', {}, r.pending ? el('span', { class: 'chip warn' }, r.pending) : '–'), el('td', { class: 'muted' }, timeAgo(r.last)), el('td', {}, el('span', { class: 'chip ' + oc(r.outcome) }, label(r.outcome)))));
      if (open) body.append(el('tr', {}, el('td', { colspan: 7 }, await detail(r))));
    }
    root.replaceChildren(
      el('div', {}, el('h1', {}, 'Probationers'), el('p', { class: 'muted' }, 'Progress is tracked here. People make the decisions.')),
      addForm(free),
      rows.length ? el('div', { class: 'stack' }, el('div', { class: 'row' }, filter, el('span', { class: 'muted' }, `${shown.length} of ${rows.length}`)),
        el('div', { style: { overflowX: 'auto' } }, el('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: '720px', textAlign: 'left' } },
          el('thead', {}, el('tr', {}, th('name', 'Name'), th('progress', 'Progress'), el('th', {}, 'Current activity'), th('steps', 'Steps'), th('pending', 'Pending'), th('active', 'Last active'), th('status', 'Status'))), body)))
        : empty('No probationers yet', 'Add a member above to start tracking their journey.'));
  }
  render();
}
