// workspace.js: one activity as an interactive workspace. Completion rules are enforced by the complete_step() database function.
import { el, sb, rpc, toast, empty, bar, icon } from './core.js';
import { loadJourney } from './data.js';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const LABEL = { submitted: ['Awaiting review', 'info'], needs_changes: ['Needs changes', 'warn'], completed: ['Done', 'ok'] };

export async function activityView(main, me, hash) {
  const id = hash.split('/')[2], j = await loadJourney(me.id);
  const a = j.phases.flatMap(p => p.activities).find(x => x.id === id);
  if (!a) return main.replaceChildren(empty('Mission not found', 'It may not be published yet.', el('a', { class: 'btn', href: '#/journey' }, 'Back to journey')));
  const again = () => activityView(main, me, hash);
  const open = a.steps.find(s => s.state === 'todo' || s.state === 'needs_changes');

  const run = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg, 'ok'); await again(); } catch (e) { if (e && e.message) toast(e.message, 'bad'); } };
  const submitBtn = (label, fn) => { const b = el('button', { class: 'btn primary' }, label); b.onclick = async () => { b.disabled = true; await fn(); b.disabled = false; }; return b; };

  function evidence(s) {
    let file = null; const prev = el('div'), pick = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Choose a screenshot' });
    const send = submitBtn('Submit screenshot', () => run(async () => {
      const path = `${me.id}/${s.id}-${Date.now()}.${EXT[file.type]}`;
      const up = await sb.storage.from('evidence').upload(path, file, { contentType: file.type });
      if (up.error) { toast(up.error.message, 'bad'); throw up.error; }
      try { await rpc('complete_step', { p_step: s.id, p_path: path }); }
      catch (e) { await sb.storage.from('evidence').remove([path]); throw e; }   // no orphaned screenshot if the submission fails
    }, 'Submitted for review.'));
    send.disabled = true;
    const clear = () => { file = null; pick.value = ''; prev.replaceChildren(); send.disabled = true; };
    pick.onchange = () => {
      const f = pick.files[0]; if (!f) return clear();
      if (!EXT[f.type]) { clear(); return toast('Use a PNG, JPG or WebP image.', 'bad'); }
      if (f.size > 5 * 1024 * 1024) { clear(); return toast('Keep the image under 5 MB.', 'bad'); }
      file = f; send.disabled = false;
      prev.replaceChildren(el('img', { src: URL.createObjectURL(f), alt: 'Preview of your screenshot', class: 'shot' }), el('button', { class: 'btn ghost', onclick: clear }, 'Remove'));
    };
    return el('div', { class: 'stack' }, pick, prev, el('div', {}, send));
  }
  function linkBox(s) {
    const u = el('input', { type: 'url', placeholder: 'https://github.com/you/repo', 'aria-label': 'Link URL' });
    return el('div', { class: 'row' }, el('div', { style: { flex: 1, minWidth: '220px' } }, u), submitBtn('Submit link', () => {
      if (!/^https:\/\//.test(u.value.trim())) return toast('Enter a link starting with https://', 'bad');
      return run(() => rpc('complete_step', { p_step: s.id, p_link: u.value.trim() }), 'Link submitted.');
    }));
  }
  function body(s) {
    const out = [];
    if (s.explanation) out.push(el('p', { class: 'muted' }, s.explanation));
    if (s.resource_url && /^https?:\/\//.test(s.resource_url)) out.push(el('a', { href: s.resource_url, target: '_blank', rel: 'noopener noreferrer' }, 'Open resource ↗'));
    if (s.state === 'needs_changes' && s.sub?.feedback) out.push(el('p', { class: 'note' }, 'Reviewer: ' + s.sub.feedback));
    if (s.state === 'submitted') out.push(el('p', { class: 'muted' }, 'Submitted. A reviewer will look at it soon.'));
    if (s.state === 'todo' || s.state === 'needs_changes') {
      if (s.completion === 'evidence') out.push(evidence(s));
      else if (s.completion === 'link') out.push(linkBox(s));
      else if (s.completion === 'review') out.push(el('div', {}, submitBtn('Submit for review', () => run(() => rpc('complete_step', { p_step: s.id }), 'Submitted for review.'))));
    }
    return out;
  }
  function tick(s) {
    const done = s.state === 'completed';
    if (s.completion !== 'self') return el('span', { class: 'tick', style: { cursor: 'default', ...({ submitted: { borderColor: 'var(--info)' }, needs_changes: { borderColor: 'var(--warn)' } }[s.state] || {}) }, 'aria-hidden': 'true' }, icon('check'));
    return el('button', { class: 'tick', 'aria-label': done ? 'Mark as not done' : 'Mark as done', 'aria-pressed': String(done),
      onclick: () => run(() => rpc(done ? 'uncomplete_step' : 'complete_step', { p_step: s.id }), done ? null : 'Step complete.') }, icon('check'));
  }
  const rows = a.steps.map(s => el('details', { class: 'step' + (s.state === 'completed' ? ' done' : '') + (s === open ? ' current' : ''), open: s === open },
    el('summary', {}, tick(s), el('span', { class: 'step-title grow' }, s.title), LABEL[s.state] ? el('span', { class: 'chip ' + LABEL[s.state][1] }, LABEL[s.state][0]) : null), el('div', { class: 'step-body stack' }, body(s))));

  const kind = el('select', { 'aria-label': 'Feedback type' }, [['general', 'General feedback'], ['too_difficult', 'Too difficult'], ['unclear', 'Unclear instructions'], ['technical_issue', 'Technical issue'], ['suggestion', 'Suggestion']].map(([v, l]) => el('option', { value: v }, l)));
  const msg = el('textarea', { rows: 2, placeholder: 'Tell the admins what would make this better' });
  const fb = el('details', { class: 'stack' }, el('summary', { class: 'muted' }, 'Give feedback on this mission'), kind, msg, el('div', {}, el('button', { class: 'btn', onclick: async () => {
    const { error } = await sb.from('activity_feedback').insert({ user_id: me.id, activity_id: a.id, category: kind.value, message: msg.value.trim() || null });
    if (error) return toast(error.message, 'bad'); msg.value = ''; toast('Thanks, the admins will see this.', 'ok');
  } }, 'Send')));

  main.replaceChildren(el('div', { class: 'stack', style: { gap: '22px', maxWidth: '760px' } },
    el('a', { href: '#/journey' }, '← Journey'),
    el('div', {}, el('p', { class: 'muted' }, a.phase.title), el('h1', {}, a.title), el('div', { class: 'row', style: { marginTop: '10px' } }, el('span', { class: 'chip info' }, a.kind), a.est_duration ? el('span', { class: 'muted' }, a.est_duration) : null, el('span', { class: 'muted' }, `${a.done}/${a.steps.length} steps`))),
    bar(100 * a.done / a.steps.length),
    el('div', { class: 'cols' }, a.objective ? el('div', {}, el('h3', {}, 'Objective'), el('p', { class: 'muted' }, a.objective)) : null, a.deliverable ? el('div', {}, el('h3', {}, 'You will produce'), el('p', { class: 'muted' }, a.deliverable)) : null),
    a.instructions ? el('details', {}, el('summary', {}, 'Instructions'), el('p', { class: 'muted', style: { whiteSpace: 'pre-wrap', marginTop: '8px' } }, a.instructions)) : null,
    el('div', {}, rows), a.complete ? el('p', { class: 'mission' }, 'Mission complete. Pick your next one from the journey.') : null, fb));
}
