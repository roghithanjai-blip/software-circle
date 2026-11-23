// admin.js: admin app entry. Only routes that exist appear in the nav.
import { el, sb, boot, NAV, toast, empty, timeAgo, bar } from './core.js';
import { terminalView } from './terminal.js';
import { reviewView } from './review.js';
import { probationersView } from './probationers.js';

const head = { count: 'exact', head: true };
const count = q => q.then(r => { if (r.error) throw r.error; return r.count ?? 0; });

async function overview(main, profile) {
  const [members, pending, round, logs, quiet, tree, done] = await Promise.all([
    count(sb.from('profiles').select('id', head).eq('role', 'member')),
    count(sb.from('submissions').select('id', head).eq('status', 'submitted')),
    sb.from('team_rounds').select('name,team_size,closes_at').eq('status', 'open').maybeSingle(),
    sb.from('terminal_log').select('ok,script,created_at').order('created_at', { ascending: false }).limit(6),
    sb.from('profiles').select('full_name,last_active_at').eq('role', 'member').order('last_active_at', { ascending: true, nullsFirst: true }).limit(5),
    sb.from('phases').select('id,title,icon,status,visible,position,est_duration,activities(id,title,kind,status,position,steps(id,archived))').order('position'),
    sb.from('step_progress').select('user_id,step_id').eq('status', 'completed').limit(10000),
  ]);
  if (tree.error) throw tree.error;
  const phases = tree.data.map(p => ({ ...p, activities: [...p.activities].sort((a, b) => a.position - b.position) }));
  const acts = phases.flatMap(p => p.activities).filter(a => a.status !== 'archived');
  const stepCount = a => a.steps.filter(s => !s.archived).length;
  const stepAct = new Map(); acts.forEach(a => a.steps.forEach(s => stepAct.set(s.id, a.id)));
  const byAct = new Map();   // activity -> (user -> completed steps)
  (done.data || []).forEach(r => { const a = stepAct.get(r.step_id); if (!a) return; const m = byAct.get(a) || new Map(); m.set(r.user_id, (m.get(r.user_id) || 0) + 1); byAct.set(a, m); });
  const finishers = a => { const n = stepCount(a); return n ? [...(byAct.get(a.id)?.values() || [])].filter(c => c >= n).length : 0; };

  const stat = (n, label) => el('div', { class: 'stat' }, el('b', {}, n), el('span', {}, label));
  const live = phases.filter(p => p.status === 'published' && p.visible).length;
  const stats = el('div', { class: 'stats' },
    stat(members, 'members'), stat(pending, 'awaiting review'),
    stat(`${live}/${phases.filter(p => p.status !== 'archived').length}`, 'phases live'),
    stat(acts.length, 'activities'), stat(acts.reduce((n, a) => n + stepCount(a), 0), 'steps'),
    stat(round.data ? 'Open' : 'None', round.data ? `team round, teams of ${round.data.team_size}` : 'team round'));

  const copyCmd = (kind, title) => el('button', { class: 'btn ghost', title: 'Copy an edit command for the terminal', onclick: async () => {
    try { await navigator.clipboard.writeText(`edit ${kind} "${title.replace(/"/g, '\\"')}" set `); toast('Edit command copied. Paste it in the Terminal.', 'ok'); }
    catch { toast('Could not copy; select and copy manually.', 'bad'); }
  } }, 'Edit');
  const chip = s => el('span', { class: 'chip ' + ({ published: 'ok', draft: 'warn' }[s] || '') }, s);

  const map = phases.length ? el('div', { class: 'route' }, phases.map(p => el('div', { class: 'stop ' + (p.status === 'published' && p.visible ? 'done' : p.status === 'archived' ? 'locked' : '') },
    el('details', { open: p.status !== 'archived' },
      el('summary', {}, el('h3', {}, `${p.icon || ''} ${p.title}`.trim()), chip(p.status), p.status === 'published' && !p.visible ? el('span', { class: 'chip' }, 'hidden') : null,
        p.est_duration ? el('span', { class: 'muted' }, p.est_duration) : null, copyCmd('phase', p.title)),
      el('div', { class: 'acts' }, p.activities.filter(a => a.status !== 'archived').length
        ? p.activities.filter(a => a.status !== 'archived').map(a => el('div', { class: 'arow' },
            el('span', { class: 'grow' }, a.title), el('span', { class: 'chip info' }, a.kind), chip(a.status),
            el('span', { class: 'muted' }, `${stepCount(a)} steps`), el('span', { class: 'chip' }, `${finishers(a)}/${members} finished`), copyCmd('activity', a.title)))
        : el('p', { class: 'muted', style: { padding: '6px 10px' } }, 'No activities yet.')))))
    : empty('No phases yet', 'Open the Terminal and describe your first phase.', el('a', { class: 'btn primary', href: '#/terminal' }, 'Open terminal'));

  const runs = el('div', { class: 'card stack' }, el('h3', {}, 'Recent terminal runs'),
    ...((logs.data || []).length ? logs.data.map(r => el('div', { class: 'row' }, el('span', { class: 'chip ' + (r.ok ? 'ok' : 'bad') }, r.ok ? 'applied' : 'failed'),
      el('span', { class: 'muted' }, timeAgo(r.created_at)), el('span', {}, (r.script || '').split('\n').find(l => l.trim() && !l.trim().startsWith('#'))?.slice(0, 48) || ''))) : [el('p', { class: 'muted' }, 'Nothing applied yet.')]));
  const q = el('div', { class: 'card stack' }, el('h3', {}, 'Least recently active'),
    ...((quiet.data || []).length ? quiet.data.map(m => el('div', { class: 'row', style: { justifyContent: 'space-between' } }, el('span', {}, m.full_name || 'Unnamed'), el('span', { class: 'muted' }, timeAgo(m.last_active_at)))) : [el('p', { class: 'muted' }, 'No members yet. Members appear after they sign up.')]));

  main.replaceChildren(el('div', { class: 'stack', style: { gap: '26px' } },
    el('div', {}, el('h1', {}, 'Overview'), el('p', { class: 'muted' }, `Hi ${(profile.full_name || 'admin').split(' ')[0]}. Everything below is live from the database.`)),
    stats,
    el('section', { class: 'stack' }, el('h2', {}, 'Journey map'), map),
    el('div', { class: 'grid' }, runs, q)));
}

const routes = { '#/': overview, '#/terminal': (main) => terminalView(main), '#/review': (main) => reviewView(main), '#/probationers': (main, p) => probationersView(main, p) };
NAV.admin = NAV.admin.filter(([href]) => routes[href]);   // hide pages that are not built yet
boot(document.getElementById('app'), { role: 'admin', routes });
