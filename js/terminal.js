// terminal.js: the admin console view. Parse -> dry run (rolled back) -> apply (atomic, logged).
import { el, sb, rpc, toast, timeAgo, empty } from './core.js';
import { parse } from './parser.js';

const HELP = `phase "Foundations" icon=🚀 dur="2 weeks"
  activity "Hello Git" kind=build dur="2h" out="A repo with one commit"
    step "Install git" | Run git --version | self
    step "Show your log" | Screenshot git log | evidence review

edit step "Install git" in activity "Hello Git" set title="Set up git"
move activity "Hello Git" to phase "Foundations" at 2
publish phase "Foundations" all

teams open "Git Pairing" size=3 until=2026-12-05 checkpoint="Hello Git"
teams close      # stop formation, teams stay
teams autoform   # place everyone still without a team
teams dissolve   # end the round and free everyone
team assign "Asha" to "Team Alpha"
assign activity "Branch Battle" to teams due=2026-12-10`;

const cls = l => ({ '+': 'add', '-': 'del', x: 'del' }[l[0]] || 'chg');

export async function terminalView(main) {
  let dryText = null;
  const ta = el('textarea', { class: 'term', spellcheck: 'false', placeholder: 'Write or paste a script. Ctrl+Enter runs a dry run.', 'aria-label': 'Terminal script' });
  const out = el('div', { class: 'term-out', 'aria-live': 'polite' });
  const dryBtn = el('button', { class: 'btn' }, 'Dry run');
  const applyBtn = el('button', { class: 'btn primary', disabled: true }, 'Apply');
  const exportBtn = el('button', { class: 'btn ghost' }, 'Export current');
  const histBtn = el('button', { class: 'btn ghost' }, 'History');
  const hist = el('div', { class: 'card stack', style: { display: 'none' } });

  const show = (lines, err) => {
    out.replaceChildren(...lines.map(l => el('div', { class: cls(l) }, l)), err ? el('div', { class: 'del' }, 'Error: ' + err) : null);
  };
  const lock = () => { applyBtn.disabled = true; dryText = null; };
  ta.addEventListener('input', lock);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); dry(); }
  });

  async function run(isDry) {
    const text = ta.value, { cmds, errors } = parse(text);
    if (errors.length) { show(errors.map(e => `line ${e.line}: ${e.msg}`).map(l => '- ' + l)); return null; }
    if (!cmds.length) { show(['Nothing to run.']); return null; }
    const res = await rpc('apply_commands', { p_cmds: cmds, p_script: text, p_dry: isDry });
    show(res.log || [], res.error);
    return { res, text, n: cmds.length };
  }
  async function dry() {
    dryBtn.disabled = true;
    try {
      const r = await run(true);
      if (r?.res.ok) { dryText = r.text; applyBtn.disabled = false; toast(`Dry run passed: ${r.n} command${r.n > 1 ? 's' : ''}. Nothing saved yet.`, 'ok'); }
      else lock();
    } catch { lock(); } finally { dryBtn.disabled = false; }
  }
  async function apply() {
    if (dryText !== ta.value) return toast('Run a dry run on this exact script first.', 'bad');
    if (!confirm('Apply this script? It changes the live journey.')) return;
    applyBtn.disabled = true;
    try {
      const r = await run(false);
      if (r?.res.ok) { toast('Applied.', 'ok'); dryText = null; loadHistory(); }
      else toast('Nothing was changed.', 'bad');
    } catch {} finally { applyBtn.disabled = true; }
  }
  async function loadHistory() {
    const { data, error } = await sb.from('terminal_log').select('id,script,ok,created_at').order('created_at', { ascending: false }).limit(15);
    if (error) return hist.replaceChildren(empty('Could not load history', error.message));
    hist.replaceChildren(el('h3', {}, 'Recent runs'), ...(data.length ? data.map(r => el('div', { class: 'row', style: { justifyContent: 'space-between' } },
      el('span', {}, el('span', { class: 'chip ' + (r.ok ? 'ok' : 'bad') }, r.ok ? 'applied' : 'failed'), ' ', timeAgo(r.created_at), ' · ', (r.script || '').split('\n').find(l => l.trim() && !l.trim().startsWith('#'))?.slice(0, 60) || ''),
      el('button', { class: 'btn ghost', onclick: () => { ta.value = r.script || ''; lock(); out.replaceChildren(); } }, 'Load'))) : [empty('No runs yet', 'Applied scripts show up here.')]));
  }
  dryBtn.onclick = dry; applyBtn.onclick = apply;
  exportBtn.onclick = async () => {
    if (ta.value.trim() && !confirm('Replace the editor contents with the current journey?')) return;
    const s = await rpc('export_script'); ta.value = s || '# The journey is empty. Start with: phase "Name"'; lock(); out.replaceChildren();
  };
  histBtn.onclick = () => { const open = hist.style.display === 'none'; hist.style.display = open ? '' : 'none'; if (open) loadHistory(); };

  main.replaceChildren(el('div', { class: 'stack' },
    el('div', {}, el('h1', {}, 'Terminal'), el('p', { class: 'muted' }, 'Describe changes, check them with a dry run, then apply. If any line fails, nothing changes.')),
    ta, el('div', { class: 'row' }, dryBtn, applyBtn, exportBtn, histBtn), out, hist,
    el('details', { class: 'card' }, el('summary', {}, 'Cheat sheet'), el('pre', { class: 'term-out', style: { marginTop: '10px' } }, HELP))));
}
