// member.js: member app entry. Dashboard, journey, leaderboard, profile. Activity workspace lives in workspace.js.
import { el, sb, boot, NAV, toast, empty, ring, bar, timeAgo, setTopbar, icon } from './core.js';
import { prepareAvatar } from './image.js';
import { loadJourney } from './data.js';
import { activityView } from './workspace.js';

const hello = () => { const h = new Date().getHours(); return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const go = id => `#/journey/${id}`;

async function board(weekly) {
  const { data, error } = await sb.rpc('leaderboard', { p_weekly: weekly });
  return error ? [] : data;
}
const boardRows = (rows, meId, n) => rows.slice(0, n).map(r => el('div', { class: 'lb' + (r.user_id === meId ? ' me' : '') },
  el('span', { class: 'rk' }, r.rank), el('span', { class: 'grow' }, r.full_name || 'Member'), el('b', {}, r.points)));

const pad = n => String(n).padStart(2, '0');
const section = (no, title, meta, body) => el('section', { class: 'stack' }, el('div', { class: 'sec' }, el('span', { class: 'secno' }, no), el('h2', {}, title), el('span', { class: 'mono muted', style: { marginLeft: 'auto' } }, meta || '')), body);

async function dashboard(main, me) {
  const [j, lb, notes] = await Promise.all([loadJourney(me.id), board(false), sb.from('notifications').select('id,body,read,created_at').order('created_at', { ascending: false }).limit(4)]);
  const first = (me.full_name || '').split(' ')[0] || 'there';
  if (!j.total) return main.replaceChildren(el('h1', {}, `Welcome, ${first}`), empty('Nothing here yet', 'No roadmap is open for you yet. Check back soon.'));
  const n = j.next;
  const mission = n ? el('a', { class: 'mission', href: go(n.activity.id) },
      el('div', { class: 'grow' }, el('span', { class: 'mono brass' }, `${n.activity.phase.title} › ${n.activity.title}`),
        el('h2', {}, n.state === 'needs_changes' ? `Revisit: ${n.title}` : n.title), n.explanation ? el('p', { class: 'muted' }, n.explanation) : null),
      el('span', { class: 'btn primary big' }, 'Continue mission →'))
    : el('div', { class: 'mission' }, el('div', { class: 'grow' }, el('h2', {}, j.waiting.length ? 'Everything is submitted' : 'All caught up'),
        el('p', { class: 'muted' }, j.waiting.length ? 'Your work is waiting on a review. You will be notified.' : 'You have finished every available step. Well done.')));
  const card = r => el('a', { class: 'rm-card', href: '#/roadmap/' + r.id },
    el('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } },
      el('div', { class: 'grow', style: { minWidth: 0 } }, el('span', { class: 'mono st st-' + r.state.replace(' ', '') }, r.state), el('h3', {}, r.title)), ring(r.pct, 54)),
    el('div', { class: 'row spread mono muted' }, el('span', {}, r.curator_name ? 'Curated by ' + r.curator_name : 'No curator'), el('span', {}, `${r.done}/${r.total}`)));
  const attention = [...j.changes.map(s => [s, 'Needs changes', 'bad']), ...j.waiting.map(s => [s, 'Awaiting review', 'info'])];
  const mine = lb.find(r => r.user_id === me.id);
  main.replaceChildren(el('div', { class: 'stack', style: { gap: '28px' } },
    el('div', { class: 'row spread' },
      el('div', {}, el('p', { class: 'mono muted' }, new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })), el('h1', {}, `Welcome back, ${first}`)),
      el('div', { class: 'panel row' }, ring(j.pct, 56), el('div', {}, el('b', { class: 'mono' }, `${j.done} of ${j.total} steps`), el('div', { class: 'muted' }, `Across ${j.roadmaps.length} roadmap${j.roadmaps.length > 1 ? 's' : ''}`)))),
    mission,
    section('01', 'Active roadmaps', `${j.roadmaps.length} enrolled`, el('div', { class: 'rm-grid' }, j.roadmaps.map(card))),
    el('div', { class: 'cols' },
      section('02', 'Submissions in review', `${attention.length} active`, attention.length
        ? el('div', { class: 'stack' }, attention.map(([s, label, k]) => el('a', { class: 'panel lrow2', href: go(s.activity.id) },
            el('div', { class: 'grow' }, el('b', {}, s.title), el('div', { class: 'mono muted' }, s.activity.title)), el('span', { class: 'chip ' + k }, label))))
        : el('p', { class: 'muted' }, 'Nothing is waiting on you or on a reviewer.')),
      el('div', { class: 'stack', style: { gap: '28px' } },
        section('03', 'Leaderboard', 'Top 5', lb.length ? el('div', { class: 'panel' }, boardRows(lb, me.id, 5), mine ? el('p', { class: 'muted', style: { marginTop: '8px' } }, `You are #${mine.rank} with ${mine.points} points.`) : null,
          el('a', { href: '#/leaderboard' }, 'See everyone')) : el('p', { class: 'muted' }, 'The leaderboard is off or has no scores yet.')),
        section('04', 'Updates', 'Recent', notes.data?.length ? el('div', { class: 'panel stack' }, notes.data.map(x => el('p', {}, el('span', { class: 'mono muted' }, timeAgo(x.created_at) + ' · '), x.body)), el('a', { href: '#/notifications' }, 'All notifications')) : el('p', { class: 'muted' }, 'No updates yet.'))))));
}

async function roadmapView(main, me, hash) {
  const j = await loadJourney(me.id), rm = j.roadmaps.find(r => r.id === hash.split('/')[2]);
  if (!rm) return main.replaceChildren(empty('Roadmap not found', 'It may not be open for you.', el('a', { class: 'btn', href: '#/' }, 'Back to dashboard')));
  const open = rm.phases.filter(p => !p.locked).flatMap(p => p.activities.flatMap(a => a.steps));
  const next = open.find(s => s.state === 'todo' || s.state === 'needs_changes'), cur = next?.activity.phase.id;
  const block = (p, i) => el('div', { class: 'tlp ' + (p.complete ? 'done' : p.id === cur ? 'cur' : p.locked ? 'locked' : '') }, el('span', { class: 'tln' }, pad(i + 1)),
    el('div', { class: 'panel stack' },
      el('div', { class: 'row spread' }, el('div', {}, el('span', { class: 'mono st' }, `Phase ${pad(i + 1)} · ${p.complete ? 'done' : p.locked ? 'locked' : p.id === cur ? 'current' : 'open'}`), el('h2', {}, p.title)),
        el('span', { class: 'mono muted' }, p.locked ? `Unlocks after ${p.lockedBy}` : `${p.done} / ${p.total} steps`)),
      p.activities.map(a => el(p.locked ? 'div' : 'a', { class: 'arow2', href: p.locked ? null : go(a.id) },
        el('span', { class: 'chip info' }, a.kind), el('span', { class: 'grow' }, a.title), el('span', { class: 'mono muted' }, `${a.done}/${a.steps.length}`), a.complete ? el('span', { class: 'chip ok' }, 'done') : null))));
  const side = el('aside', { class: 'stack' },
    el('div', { class: 'panel stack' }, el('span', { class: 'mono muted' }, 'Next up'),
      next ? [el('h3', {}, next.title), next.explanation ? el('p', { class: 'muted' }, next.explanation) : null, el('a', { class: 'btn primary big', href: go(next.activity.id) }, 'Continue →')] : el('p', { class: 'muted' }, 'Nothing left to do here right now.')),
    el('div', { class: 'panel stack' }, el('span', { class: 'mono muted' }, 'Phase breakdown'),
      rm.phases.map((p, i) => { const pc = p.total ? Math.round(100 * p.done / p.total) : 0; return el('div', {}, el('div', { class: 'row spread' }, el('span', {}, `${pad(i + 1)} ${p.title}`), el('b', { class: 'mono' }, pc + '%')), bar(pc)); })));
  main.replaceChildren(el('div', { class: 'stack', style: { gap: '22px' } }, el('a', { href: '#/' }, '← Back to dashboard'),
    el('div', { class: 'panel hero' }, el('div', { class: 'stack grow' },
      el('div', { class: 'row' }, rm.est_duration ? el('span', { class: 'chip' }, rm.est_duration) : null, el('span', { class: 'chip' }, `${rm.phases.length} phases · ${rm.total} steps`)),
      el('h1', {}, rm.title), rm.summary ? el('p', { class: 'muted' }, rm.summary) : null,
      rm.curator_name ? el('p', { class: 'mono muted' }, `Curated by ${rm.curator_name}${rm.curator_title ? ' · ' + rm.curator_title : ''}`) : null),
      el('div', { class: 'row' }, ring(rm.pct, 110), el('div', {}, el('span', { class: 'mono muted' }, 'Overall progress'), el('div', {}, el('b', {}, `${rm.done} of ${rm.total} steps`))))),
    el('div', { class: 'split' }, el('div', { class: 'tl' }, rm.phases.map(block)), side)));
}

async function notifications(main) {
  const { data, error } = await sb.from('notifications').select('id,kind,body,read,created_at').order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  const markAll = el('button', { class: 'btn', onclick: async () => { const { error: e } = await sb.from('notifications').update({ read: true }).eq('read', false); if (e) return toast(e.message, 'bad'); notifications(main); } }, 'Mark all read');
  main.replaceChildren(el('div', { class: 'stack' }, el('div', { class: 'row spread' }, el('h1', {}, 'Notifications'), data.some(x => !x.read) ? markAll : null),
    data.length ? el('div', { class: 'panel' }, data.map(x => el('div', { class: 'lrow2' }, el('i', { class: 'dot' + (x.read ? ' off' : '') }), el('div', { class: 'grow' }, x.body, el('div', { class: 'mono muted' }, x.kind.replace(/_/g, ' '))), el('span', { class: 'mono muted' }, timeAgo(x.created_at)))))
      : empty('Nothing yet', 'Approvals, feedback and new roadmaps show up here.')));
}

// Bar above every screen: breadcrumb, notification bell, theme, who you are.
setTopbar((me, route) => {
  const dot = el('i', { class: 'dot', hidden: true });
  sb.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false).then(r => { if (r.count) dot.hidden = false; });
  const names = { '#/': 'Workspace', '#/leaderboard': 'Leaderboard', '#/profile': 'Profile', '#/notifications': 'Notifications' };
  const pic = photoUrl(me.avatar_url);
  return el('header', { class: 'topbar' }, el('span', { class: 'mono' }, 'Software Circle / ', el('b', {}, names[route] || 'Roadmap')),
    el('div', { class: 'row', style: { marginLeft: 'auto', gap: '14px' } },
      el('a', { class: 'bell', href: '#/notifications', 'aria-label': 'Notifications' }, icon('bell'), dot),
      el('a', { class: 'who', href: '#/profile' }, pic ? el('img', { class: 'mini-av', src: pic, alt: '' }) : el('span', { class: 'mini-av ph' }, (me.full_name || '?').slice(0, 1).toUpperCase()), el('span', {}, el('b', {}, me.full_name || 'Member'), el('div', { class: 'mono muted' }, me.email)))));
});

async function leaderboard(main, me) {
  let weekly = false; const box = el('div', { class: 'stack' });
  const draw = async () => {
    const rows = await board(weekly);
    box.replaceChildren(el('div', { class: 'row' }, el('button', { class: 'btn ' + (weekly ? 'ghost' : 'primary'), onclick: () => { weekly = false; draw(); } }, 'All time'), el('button', { class: 'btn ' + (weekly ? 'primary' : 'ghost'), onclick: () => { weekly = true; draw(); } }, 'This week')),
      rows.length ? boardRows(rows, me.id, 100) : empty('Nothing here yet', 'Points appear as steps are completed and approved.'));
  };
  main.replaceChildren(el('div', { class: 'stack' }, el('h1', {}, 'Leaderboard'), el('p', { class: 'muted' }, 'Points reward finished and verified work, not speed.'), box)); await draw();
}

const photoUrl = path => path ? sb.storage.from('avatars').getPublicUrl(path).data.publicUrl : null;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// One form for first login and for later edits. Everything is validated by the save_profile() database function.
function detailsForm(me, { onboarding }) {
  const inp = (v, p = {}) => el('input', { value: v ?? '', ...p });
  const name = inp(me.full_name, { autocomplete: 'name' }), roll = inp(me.roll_no), mobile = inp(me.mobile, { type: 'tel', inputmode: 'numeric', placeholder: '10-digit number' });
  const mail = inp(me.college_email, { type: 'email' }), li = inp(me.linkedin_url, { placeholder: 'https://linkedin.com/in/you' }), gh = inp(me.github_url, { placeholder: 'https://github.com/you' });
  const year = el('select', {}, el('option', { value: '' }, 'Choose…'), [1, 2, 3, 4].map(y => el('option', { value: y, selected: y === me.year_of_study }, `Year ${y}`)));
  const shot = el('div'); let file = null;
  const show = src => shot.replaceChildren(src ? el('img', { class: 'avatar', src, alt: 'Profile photo' }) : el('div', { class: 'avatar ph', 'aria-hidden': 'true' }, (me.full_name || '?').slice(0, 1).toUpperCase()));
  show(photoUrl(me.avatar_url));
  const pick = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Choose a profile photo' });
  pick.onchange = async () => {
    const x = pick.files[0]; if (!x) return;
    try { file = await prepareAvatar(x); show(URL.createObjectURL(file.blob)); }   // up to 15 MB in, 1024 px sharp copy out
    catch (e) { file = null; pick.value = ''; toast(e.message, 'bad'); }
  };
  const save = el('button', { class: 'btn primary big', type: 'submit' }, onboarding ? 'Enter Mission Control' : 'Save details');
  const L = (t, c) => el('label', {}, t, c);
  const form = el('form', { class: 'stack', style: { maxWidth: '520px' } },
    el('div', { class: 'row' }, shot, el('div', { class: 'stack' }, el('span', { class: 'muted' }, 'Profile photo'), pick, el('span', { class: 'mono muted' }, 'Any size up to 15 MB. We resize it and keep it sharp.'))),
    L('Full name', name), L('College roll number', roll), L('Mobile number', mobile), L('College email', mail), L('Year of study', year),
    L('LinkedIn (optional)', li), L('GitHub (optional)', gh),
    el('p', { class: 'muted' }, 'Your mobile number, roll number and email are visible to admins only.'), el('div', {}, save));
  form.onsubmit = async e => {
    e.preventDefault(); save.disabled = true; let path = null;
    try {
      if (file) {
        path = `${me.id}/${Date.now()}.${file.ext}`;
        const up = await sb.storage.from('avatars').upload(path, file.blob, { contentType: file.type }); if (up.error) throw up.error;
      }
      const { error } = await sb.rpc('save_profile', { p_full_name: name.value, p_roll_no: roll.value, p_mobile: mobile.value, p_college_email: mail.value,
        p_year: year.value ? Number(year.value) : null, p_avatar: path, p_linkedin: li.value.trim() || null, p_github: gh.value.trim() || null });
      if (error) { if (path) await sb.storage.from('avatars').remove([path]); throw error; }
      toast('Saved.', 'ok'); if (onboarding) location.reload();
    } catch (err) { toast(err.message || 'Could not save.', 'bad'); } finally { save.disabled = false; }
  };
  return form;
}
function onboarding(main, me) {
  main.replaceChildren(el('div', { class: 'stack', style: { gap: '18px' } }, el('h1', {}, 'Tell us about you'),
    el('p', { class: 'muted' }, 'We need these details before you start. You can change them later in Profile.'), detailsForm(me, { onboarding: true })));
}
async function profile(main, me) {
  const [j, pts] = await Promise.all([loadJourney(me.id), sb.from('point_events').select('points')]);
  const total = (pts.data || []).reduce((n, r) => n + r.points, 0);
  main.replaceChildren(el('div', { class: 'stack', style: { gap: '22px' } }, el('h1', {}, 'Profile'),
    el('div', { class: 'row' }, ring(j.pct, 84), el('div', {}, el('b', {}, `${j.done} of ${j.total} steps`), el('div', { class: 'muted' }, `${total} points · ${me.email}`))),
    detailsForm(me, { onboarding: false })));
}

const routes = { '#/': dashboard, '#/roadmap/*': roadmapView, '#/journey/*': activityView, '#/notifications': notifications, '#/leaderboard': leaderboard, '#/profile': profile };
// Members must finish onboarding before any screen opens. Admins are exempt.
for (const k of Object.keys(routes)) { const fn = routes[k]; routes[k] = (main, me, hash) => (me.onboarded_at || me.role === 'admin') ? fn(main, me, hash) : onboarding(main, me); }
NAV.member = NAV.member.filter(([h]) => routes[h]);   // hide pages that are not built yet (Team comes later)
boot(document.getElementById('app'), { role: 'member', routes });
