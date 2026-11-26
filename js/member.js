// member.js: member app entry. Dashboard, journey, leaderboard, profile. Activity workspace lives in workspace.js.
import { el, sb, boot, NAV, toast, empty, ring, timeAgo } from './core.js';
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

async function dashboard(main, me) {
  const [j, lb, notes] = await Promise.all([loadJourney(me.id), board(false), sb.from('notifications').select('id,body,read,created_at').order('created_at', { ascending: false }).limit(4)]);
  if (!j.total) return main.replaceChildren(el('h1', {}, `${hello()}, ${me.full_name.split(' ')[0] || 'there'}`), empty('Your journey is being prepared', 'No missions are published yet. Check back soon.'));
  const n = j.next;
  const mission = n ? el('a', { class: 'mission', href: go(n.activity.id) },
      el('div', { class: 'grow' }, el('span', { class: 'muted' }, `${n.activity.phase.title} › ${n.activity.title}`),
        el('h2', {}, n.state === 'needs_changes' ? `Revisit: ${n.title}` : n.title), n.explanation ? el('p', { class: 'muted' }, n.explanation) : null),
      el('span', { class: 'btn primary big' }, 'Continue mission →'))
    : el('div', { class: 'mission' }, el('div', { class: 'grow' }, el('h2', {}, j.waiting.length ? 'Everything is submitted' : 'Journey complete'),
        el('p', { class: 'muted' }, j.waiting.length ? 'Your work is waiting on a review. You will be notified.' : 'You have finished every published mission. Well done.')));
  const mine = lb.find(r => r.user_id === me.id);
  const attention = [...j.changes.map(s => [s, 'Needs changes', 'warn']), ...j.waiting.map(s => [s, 'Awaiting review', 'info'])];
  main.replaceChildren(el('div', { class: 'stack', style: { gap: '30px' } },
    el('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-end' } },
      el('div', {}, el('p', { class: 'muted' }, hello()), el('h1', {}, me.full_name || 'Welcome')),
      el('div', { class: 'row' }, ring(j.pct, 74), el('div', {}, el('b', {}, `${j.done} of ${j.total}`), el('div', { class: 'muted' }, 'steps complete')))),
    mission,
    el('div', { class: 'track', role: 'img', 'aria-label': `${j.done} of ${j.total} steps complete` }, j.steps.map(s => el('i', { class: s.state, title: s.title }))),
    el('div', { class: 'cols' },
      el('section', { class: 'stack' }, el('h2', {}, 'Status'),
        attention.length ? attention.map(([s, label, k]) => el('a', { class: 'lrow', href: go(s.activity.id) }, el('span', { class: 'grow' }, s.title, el('span', { class: 'muted' }, ' · ' + s.activity.title)), el('span', { class: 'chip ' + k }, label)))
          : el('p', { class: 'muted' }, 'Nothing is waiting on you or on a reviewer.'),
        ...(notes.data?.length ? [el('h2', { style: { marginTop: '14px' } }, 'Updates'), ...notes.data.map(x => el('p', {}, el('span', { class: 'muted' }, timeAgo(x.created_at) + ' · '), x.body))] : [])),
      el('section', { class: 'stack' }, el('h2', {}, 'Leaderboard'),
        lb.length ? [...boardRows(lb, me.id, 5), mine ? el('p', { class: 'muted' }, `You are #${mine.rank} with ${mine.points} points.`) : null, el('a', { href: '#/leaderboard' }, 'See everyone')]
          : el('p', { class: 'muted' }, 'The leaderboard is off or has no scores yet.')))));
  if (notes.data?.some(x => !x.read)) sb.from('notifications').update({ read: true }).eq('read', false).then(() => {});
}

async function journey(main, me) {
  const j = await loadJourney(me.id);
  if (!j.total) return main.replaceChildren(empty('Your journey is being prepared', 'No missions are published yet.'));
  const cur = j.next?.activity.phase.id;
  main.replaceChildren(el('div', { class: 'stack', style: { gap: '26px' } }, el('h1', {}, 'Journey'),
    el('div', { class: 'route' }, j.phases.map((p, i) => el('div', { class: 'stop ' + (p.complete ? 'done' : p.id === cur ? 'current' : p.locked ? 'locked' : '') },
      el('div', { class: 'row', style: { alignItems: 'baseline' } }, el('span', { class: 'num' }, String(i + 1).padStart(2, '0')), el('h2', {}, p.title), p.est_duration ? el('span', { class: 'muted' }, p.est_duration) : null),
      p.description ? el('p', { class: 'muted' }, p.description) : null,
      p.locked ? el('p', { class: 'chip', style: { display: 'inline-block', marginTop: '8px' } }, `Unlocks after ${p.lockedBy}`) : null,
      el('div', { class: 'acts' }, p.activities.map(a => el(p.locked ? 'div' : 'a', { class: 'arow', href: p.locked ? null : go(a.id) },
        el('span', { class: 'grow' }, a.title), el('span', { class: 'chip info' }, a.kind), el('span', { class: 'muted' }, `${a.done}/${a.steps.length}`),
        a.complete ? el('span', { class: 'chip ok' }, 'done') : null))))))));
}

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
  pick.onchange = () => {
    const x = pick.files[0]; if (!x) return;
    if (!EXT[x.type] || x.size > 2 * 1024 * 1024) { pick.value = ''; return toast('Use a PNG, JPG or WebP under 2 MB.', 'bad'); }
    file = x; show(URL.createObjectURL(x));
  };
  const save = el('button', { class: 'btn primary big', type: 'submit' }, onboarding ? 'Enter Mission Control' : 'Save details');
  const L = (t, c) => el('label', {}, t, c);
  const form = el('form', { class: 'stack', style: { maxWidth: '520px' } },
    el('div', { class: 'row' }, shot, el('div', { class: 'stack' }, el('span', { class: 'muted' }, 'Profile photo'), pick)),
    L('Full name', name), L('College roll number', roll), L('Mobile number', mobile), L('College email', mail), L('Year of study', year),
    L('LinkedIn (optional)', li), L('GitHub (optional)', gh),
    el('p', { class: 'muted' }, 'Your mobile number, roll number and email are visible to admins only.'), el('div', {}, save));
  form.onsubmit = async e => {
    e.preventDefault(); save.disabled = true; let path = null;
    try {
      if (file) {
        path = `${me.id}/${Date.now()}.${EXT[file.type]}`;
        const up = await sb.storage.from('avatars').upload(path, file, { contentType: file.type }); if (up.error) throw up.error;
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

const routes = { '#/': dashboard, '#/journey': journey, '#/journey/*': activityView, '#/leaderboard': leaderboard, '#/profile': profile };
// Members must finish onboarding before any screen opens. Admins are exempt.
for (const k of Object.keys(routes)) { const fn = routes[k]; routes[k] = (main, me, hash) => (me.onboarded_at || me.role === 'admin') ? fn(main, me, hash) : onboarding(main, me); }
NAV.member = NAV.member.filter(([h]) => routes[h]);   // hide pages that are not built yet (Team comes later)
boot(document.getElementById('app'), { role: 'member', routes });
