// parser.js: pure functions, no DOM. parse(text) -> { cmds, errors }. See TERMINAL_SPEC.md for the language.
const KEYMAP = { dur: 'est_duration', desc: 'description', obj: 'objective', out: 'deliverable', sum: 'summary', instr: 'instructions', link: 'resource_url', submit: 'requires_submission', expl: 'explanation', review: 'requires_review' };
const BOOLS = ['requires_submission', 'requires_review'];
const COMPLETIONS = ['self', 'evidence', 'link', 'review'];
const PHASE_KEYS = ['icon', 'est_duration', 'description'];
const ACT_KEYS = ['kind', 'est_duration', 'objective', 'deliverable', 'summary', 'instructions', 'requires_submission'];
const STEP_KEYS = ['resource_url', 'completion', 'requires_review', 'explanation'];
const ALLOWED = {
  phase: PHASE_KEYS, activity: ACT_KEYS, step: STEP_KEYS,
  edit_phase: ['title', ...PHASE_KEYS], edit_activity: ['title', ...ACT_KEYS], edit_step: ['title', ...STEP_KEYS],
  teams_open: ['size', 'until', 'checkpoint'], assign: ['due'],
};
const un = s => s.replace(/\\(["\\])/g, '$1');

export function tokenize(s) {
  const out = [], re = /"((?:\\.|[^"\\])*)"|([A-Za-z_]+)=(?:"((?:\\.|[^"\\])*)"|(\S+))|(\S+)/g; let m;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) out.push({ t: 'str', v: un(m[1]) });
    else if (m[2]) {
      if (m[4] && m[4].startsWith('"')) throw new Error('unterminated quote');
      out.push({ t: 'kv', k: m[2].toLowerCase(), v: m[3] !== undefined ? un(m[3]) : m[4] });
    } else { if (m[5].startsWith('"')) throw new Error('unterminated quote'); out.push({ t: 'word', v: m[5] }); }
  }
  return out;
}

// Cuts " # comment" outside quotes.
function stripComment(s) {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') q = !q;
    else if (s[i] === '#' && !q && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s;
}
// Splits on | outside quotes.
function splitBars(s) {
  const parts = []; let cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { cur += c + s[++i]; continue; }
    if (c === '"') q = !q;
    if (c === '|' && !q) { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur); return parts;
}

function coerce(k, v, allowed, where) {
  const col = KEYMAP[k] || k;
  if (!allowed.includes(col)) throw new Error(`unknown option "${k}" for ${where}. Allowed: ${allowed.join(', ')}`);
  if (BOOLS.includes(col)) {
    if (/^(yes|true|1|on)$/i.test(v)) return [col, true];
    if (/^(no|false|0|off)$/i.test(v)) return [col, false];
    throw new Error(`${k} must be yes or no`);
  }
  if (col === 'completion' && !COMPLETIONS.includes(v)) throw new Error(`completion must be one of: ${COMPLETIONS.join(', ')}`);
  if (col === 'resource_url' && !/^https?:\/\//.test(v)) throw new Error('link must start with http:// or https://');
  if ((col === 'until' || col === 'due') && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${k} must be a date like 2026-12-05`);
  if (col === 'size') { const n = Number(v); if (!Number.isInteger(n) || n < 2 || n > 10) throw new Error('size must be 2 to 10'); return [col, n]; }
  return [col, v];
}
function pick(obj, allowed, where) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) { const [c, x] = coerce(k, v, allowed, where); out[c] = x; }
  return out;
}

function scan(tokens) {
  const r = { strs: [], opts: {}, ctx: {}, set: null, to: null, at: null, flags: [], words: [] };
  let inSet = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t === 'str') r.strs.push(t.v);
    else if (t.t === 'kv') (inSet ? (r.set ||= {}) : r.opts)[t.k] = t.v;
    else {
      const w = t.v.toLowerCase(), a = tokens[i + 1], b = tokens[i + 2];
      if (w === 'in') {
        const kind = a?.t === 'word' ? a.v.toLowerCase() : '';
        if (!['phase', 'activity'].includes(kind) || b?.t !== 'str') throw new Error('expected: in phase "name"  or  in activity "name"');
        r.ctx[kind] = b.v; i += 2;
      } else if (w === 'to') {
        const aw = a?.t === 'word' ? a.v.toLowerCase() : '';
        if ((aw === 'phase' || aw === 'activity') && b?.t === 'str') { r.to = { kind: aw, name: b.v }; i += 2; }
        else if (aw === 'teams') { r.to = { kind: 'teams' }; i += 1; }
        else if (a?.t === 'str') { r.to = { kind: 'name', name: a.v }; i += 1; }
        else throw new Error('expected something after "to"');
      } else if (w === 'at') {
        const n = Number(a?.v);
        if (!Number.isInteger(n) || n < 1) throw new Error('"at" needs a position like at 2');
        r.at = n; i += 1;
      } else if (w === 'set') inSet = true;
      else if (w === 'all') r.flags.push('all');
      else r.words.push(t.v);
    }
  }
  return r;
}
const need = (cond, msg) => { if (!cond) throw new Error(msg); };
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

export function parse(text) {
  const cmds = [], errors = []; let ctx = { phase: null, activity: null };
  text.split(/\r?\n/).forEach((raw, idx) => {
    try {
      const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length;
      let body = raw.trim();
      if (!body || body.startsWith('#')) return;
      const first = body.split(/\s/)[0].toLowerCase();
      if (first !== 'step') body = stripComment(body);   // step explanations are free text: "#" stays
      if (indent === 0) ctx = { phase: null, activity: null };
      if (first === 'step') return cmds.push(parseStep(body, indent, ctx));

      const toks = tokenize(body);
      need(toks[0]?.t === 'word', 'a command must start with a word like phase, edit, publish');
      const cmd = toks[0].v.toLowerCase(), rest = toks.slice(1);

      if (cmd === 'phase') {
        const s = scan(rest); need(s.strs[0], 'phase needs a title in quotes');
        ctx = { phase: s.strs[0], activity: null };
        cmds.push({ op: 'add_phase', title: s.strs[0], ...pick(s.opts, ALLOWED.phase, 'phase') });
      } else if (cmd === 'activity') {
        const s = scan(rest); need(s.strs[0], 'activity needs a title in quotes');
        const phase = s.ctx.phase || (indent > 0 ? ctx.phase : null);
        need(phase, 'activity must be indented under a phase, or add: in phase "name"');
        ctx = { phase, activity: s.strs[0] };
        cmds.push({ op: 'add_activity', phase, title: s.strs[0], ...pick(s.opts, ALLOWED.activity, 'activity') });
      } else if (cmd === 'edit') {
        const target = rest[0]?.v?.toLowerCase(); need(['phase', 'activity', 'step'].includes(target), 'edit what? phase, activity or step');
        const s = scan(rest.slice(1)); need(s.strs[0], `edit ${target} needs the current title in quotes`);
        need(s.set && Object.keys(s.set).length, 'nothing to change: add  set key=value');
        cmds.push(clean({ op: 'edit', target, match: s.strs[0], phase: s.ctx.phase, activity: s.ctx.activity, set: pick(s.set, ALLOWED['edit_' + target], target) }));
      } else if (cmd === 'move') {
        const target = rest[0]?.v?.toLowerCase(); need(['phase', 'activity', 'step'].includes(target), 'move what? phase, activity or step');
        const s = scan(rest.slice(1)); need(s.strs[0], `move ${target} needs a title in quotes`);
        need(s.to || s.at, 'move needs  to ...  and/or  at N');
        if (s.to) need(s.to.kind === (target === 'activity' ? 'phase' : target === 'step' ? 'activity' : '#'), target === 'phase' ? 'phases move with: at N' : `an ${target} moves to a ${target === "activity" ? "phase" : "activity"}`);
        cmds.push(clean({ op: 'move', target, match: s.strs[0], phase: s.ctx.phase, activity: s.ctx.activity, to_phase: s.to?.kind === 'phase' ? s.to.name : undefined, to_activity: s.to?.kind === 'activity' ? s.to.name : undefined, at: s.at }));
      } else if (cmd === 'publish' || cmd === 'unpublish') {
        const target = rest[0]?.v?.toLowerCase(); need(['phase', 'activity'].includes(target), `${cmd} what? phase or activity`);
        const s = scan(rest.slice(1)); need(s.strs[0], `${cmd} ${target} needs a title in quotes`);
        cmds.push(clean({ op: cmd, target, match: s.strs[0], phase: s.ctx.phase, cascade: target === 'phase' && s.flags.includes('all') ? true : undefined }));
      } else if (cmd === 'archive' || cmd === 'delete') {
        const target = rest[0]?.v?.toLowerCase(); need(['phase', 'activity', 'step'].includes(target), `${cmd} what? phase, activity or step`);
        const s = scan(rest.slice(1)); need(s.strs[0], `${cmd} ${target} needs a title in quotes`);
        cmds.push(clean({ op: cmd, target, match: s.strs[0], phase: s.ctx.phase, activity: s.ctx.activity }));
      } else if (cmd === 'dup') {
        need(rest[0]?.v?.toLowerCase() === 'activity', 'only activities can be duplicated: dup activity "name"');
        const s = scan(rest.slice(1)); need(s.strs[0], 'dup activity needs a title in quotes');
        cmds.push(clean({ op: 'dup_activity', match: s.strs[0], phase: s.ctx.phase }));
      } else if (cmd === 'teams') {
        const sub = rest[0]?.v?.toLowerCase(); const s = scan(rest.slice(1));
        need(['open', 'close', 'autoform', 'dissolve'].includes(sub), 'teams open | close | autoform | dissolve');
        if (sub === 'open') cmds.push(clean({ op: 'teams_open', name: s.strs[0], ...pick(s.opts, ALLOWED.teams_open, 'teams open') }));
        else {
          need(!s.words.length && !s.strs.length && !Object.keys(s.opts).length, `teams ${sub} takes nothing after it (one command per line)`);
          cmds.push({ op: 'teams_' + sub });
        }
      } else if (cmd === 'team') {
        const sub = rest[0]?.v?.toLowerCase(); const s = scan(rest.slice(1));
        need(['create', 'assign', 'remove'].includes(sub), 'team create | assign | remove');
        need(s.strs[0], `team ${sub} needs a name in quotes`);
        if (sub === 'create') cmds.push({ op: 'team_create', team: s.strs[0] });
        else if (sub === 'remove') cmds.push({ op: 'team_remove', member: s.strs[0] });
        else { need(s.to?.kind === 'name', 'team assign "member" to "team"'); cmds.push({ op: 'team_assign', member: s.strs[0], team: s.to.name }); }
      } else if (cmd === 'assign') {
        need(rest[0]?.v?.toLowerCase() === 'activity', 'assign activity "name" to teams');
        const s = scan(rest.slice(1)); need(s.strs[0] && s.to?.kind === 'teams', 'assign activity "name" to teams [due=2026-12-10]');
        cmds.push(clean({ op: 'task_assign', match: s.strs[0], ...pick(s.opts, ALLOWED.assign, 'assign') }));
      } else throw new Error(`unknown command "${cmd}"`);
    } catch (e) { errors.push({ line: idx + 1, msg: e.message }); }
  });
  return { cmds, errors };
}

function parseStep(body, indent, ctx) {
  const parts = splitBars(body.replace(/^step\s*/i, ''));
  need(parts.length <= 3, 'too many | separators: keep the explanation on one line without |');
  const s = scan(tokenize(parts[0])); need(s.strs[0], 'step needs a title in quotes');
  const activity = s.ctx.activity || (indent > 0 ? ctx.activity : null);
  need(activity, 'step must be indented under an activity, or add: in activity "name"');
  const phase = s.ctx.phase || (indent > 0 ? ctx.phase : null);
  const o = { op: 'add_step', activity, title: s.strs[0], completion: 'self' };
  if (phase) o.phase = phase;
  const expl = parts[1]?.trim(); if (expl) o.explanation = un(expl);
  if (parts[2] !== undefined) {
    const t = scan(tokenize(parts[2])), w = t.words.map(x => x.toLowerCase());
    need(w.length <= 2 && w.every(x => COMPLETIONS.includes(x)), `completion must be one of: ${COMPLETIONS.join(', ')} (optionally followed by "review")`);
    if (w.length === 2) {
      need(w[1] === 'review' && (w[0] === 'evidence' || w[0] === 'link'), 'two words only as: evidence review  or  link review');
      o.completion = w[0]; o.requires_review = true;
    } else if (w.length === 1) o.completion = w[0];
    Object.assign(o, pick(t.opts, ['resource_url'], 'step'));
  }
  return o;
}
