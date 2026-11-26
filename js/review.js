// review.js: admin evidence queue. The database trigger syncs step progress, points and notifications on review.
import { el, sb, toast, empty, timeAgo, skeleton } from './core.js';

const SEL = 'id,image_path,link_url,status,feedback,created_at,author:profiles!submissions_user_id_fkey(full_name),step:steps(title,completion,activity:activities(title))';
const safeUrl = u => /^https?:\/\/[^/@\s]+(\/\S*)?$/.test(u || '') ? u : null;

export async function reviewView(main) {
  let mode = 'submitted', urls = {};
  const list = el('div', { class: 'stack' });
  const tab = (m, label) => el('button', { class: 'btn ' + (mode === m ? 'primary' : 'ghost'), onclick: () => { mode = m; draw(); load(); } }, label);
  const tabs = el('div', { class: 'row' });
  const draw = () => tabs.replaceChildren(tab('submitted', 'Waiting'), tab('reviewed', 'Reviewed'));

  async function card(s) {
    const img = urls[s.image_path] || null;
    const link = safeUrl(s.link_url);
    const fb = el('textarea', { rows: 2, placeholder: 'Feedback for the member (optional)' });
    const decide = async status => {
      const { error } = await sb.from('submissions').update({ status, feedback: fb.value.trim() || null }).eq('id', s.id).eq('status', 'submitted');
      if (error) return toast(error.message, 'bad');
      toast(status === 'approved' ? 'Approved. The member was notified.' : 'Sent back for changes.', 'ok'); load();
    };
    const wait = s.status === 'submitted';
    return el('div', { class: 'card stack' },
      el('div', { class: 'row', style: { justifyContent: 'space-between' } },
        el('div', {}, el('h3', {}, s.step?.title || 'Step'), el('span', { class: 'muted' }, `${s.author?.full_name || 'Member'} · ${s.step?.activity?.title || ''} · ${timeAgo(s.created_at)}`)),
        el('span', { class: 'chip ' + ({ approved: 'ok', needs_changes: 'warn' }[s.status] || 'info') }, s.status.replace('_', ' '))),
      img ? el('a', { href: img, target: '_blank', rel: 'noopener' }, el('img', { src: img, alt: 'Submitted evidence', style: { maxWidth: '100%', maxHeight: '420px', borderRadius: '10px', border: '1px solid var(--line)' } })) : null,
      s.image_path && !img ? el('p', { class: 'muted' }, 'Could not load the image.') : null,
      link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, link) : null,
      wait ? [fb, el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: () => decide('approved') }, 'Approve'), el('button', { class: 'btn', onclick: () => decide('needs_changes') }, 'Needs changes'))]
        : (s.feedback ? el('p', { class: 'muted' }, 'Feedback: ' + s.feedback) : null));
  }
  async function load() {
    list.replaceChildren(skeleton(2));
    let q = sb.from('submissions').select(SEL).limit(50);
    q = mode === 'submitted' ? q.eq('status', 'submitted').order('created_at', { ascending: true }) : q.neq('status', 'submitted').order('reviewed_at', { ascending: false });
    const { data, error } = await q;
    if (error) return list.replaceChildren(empty('Could not load submissions', error.message));
    if (!data.length) return list.replaceChildren(empty(mode === 'submitted' ? 'Nothing waiting' : 'No reviews yet', mode === 'submitted' ? 'New evidence appears here, oldest first.' : 'Reviewed submissions show up here.'));
    urls = {};
    const paths = data.map(s => s.image_path).filter(Boolean);
    if (paths.length) { const { data: sg } = await sb.storage.from('evidence').createSignedUrls(paths, 600); (sg || []).forEach(x => { if (x.signedUrl) urls[x.path] = x.signedUrl; }); }
    list.replaceChildren(...await Promise.all(data.map(card)));
  }
  draw(); main.replaceChildren(el('div', { class: 'stack' }, el('div', {}, el('h1', {}, 'Evidence'), el('p', { class: 'muted' }, 'Approve or send back. Members are notified either way.')), tabs, list));
  load();
}
