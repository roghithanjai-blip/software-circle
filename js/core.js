// core.js: shared by index.html, admin.html, team.html. Auth, role guard, router, UI helpers.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { CONFIG } from './config.js';

export const configured = !CONFIG.SUPABASE_URL.startsWith('PASTE');
export const sb = configured ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) : null;

// ---------- DOM helpers (text goes in as text, never as HTML) ----------
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}
const NS = 'http://www.w3.org/2000/svg';
export function svg(inner, cls = '') {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); if (cls) s.setAttribute('class', cls);
  s.innerHTML = inner; // inner is a trusted constant from this file only
  return s;
}
const ICONS = {
  home: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10l3 2-3 2M13 15h4"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  out: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
};
export const icon = (name, cls = '') => svg(ICONS[name] || '', cls);

export function toast(msg, kind = '') {
  let box = document.querySelector('.toasts');
  if (!box) { box = el('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = el('div', { class: 'toast ' + kind }, msg); box.append(t);
  setTimeout(() => t.remove(), 4200);
}

export function ring(pct, size = 96) {
  pct = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 36 36'); s.setAttribute('class', 'ring'); s.style.setProperty('--size', size + 'px');
  s.innerHTML = '<circle class="bg" cx="18" cy="18" r="15.9" pathLength="100"/><circle class="fg" cx="18" cy="18" r="15.9" pathLength="100"/>';
  const fg = s.querySelector('.fg');
  requestAnimationFrame(() => requestAnimationFrame(() => fg.style.strokeDasharray = `${pct} 100`));
  const w = el('div', { class: 'ring-wrap', style: { '--size': size + 'px' } }, s, el('b', {}, pct + '%'));
  return w;
}
export function bar(pct) {
  const i = el('i'); requestAnimationFrame(() => requestAnimationFrame(() => i.style.width = Math.max(0, Math.min(100, pct || 0)) + '%'));
  return el('div', { class: 'bar' }, i);
}
export const skeleton = (n = 3) => el('div', { class: 'stack' }, Array.from({ length: n }, () => el('div', { class: 'skeleton', style: { height: '54px' } })));
export const empty = (title, hint, action) => el('div', { class: 'empty' }, el('h3', {}, title), el('p', {}, hint), action || null);
export const fmtDate = d => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const timeAgo = d => {
  if (!d) return 'never';
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

// ---------- Theme + fonts ----------
const saved = (() => { try { return localStorage.getItem('theme'); } catch { return null; } })();
document.documentElement.dataset.theme = saved || 'dark';
export function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t; try { localStorage.setItem('theme', t); } catch {}
}
document.head.append(el('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;650&family=Instrument+Sans:wght@400;600&family=JetBrains+Mono:wght@400&display=swap' }));

// ---------- Data + auth ----------
// Admin rights are decided by RLS and the SQL functions. The role check here only chooses which screen to show.
export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) { toast(error.message, 'bad'); throw error; }
  return data;
}
export async function me() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  if (error) { toast('Could not load your profile: ' + error.message, 'bad'); return null; }
  sb.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', data.id).then(() => {});
  return { ...data, email: session.user.email };
}
export const signOut = async () => { await sb.auth.signOut(); location.hash = ''; location.reload(); };

export function authView(onDone) {
  let signup = false;
  const name = el('input', { placeholder: 'Full name', autocomplete: 'name' });
  const email = el('input', { type: 'email', placeholder: 'you@email.com', autocomplete: 'email', required: true });
  const pass = el('input', { type: 'password', placeholder: 'Password (8+ characters)', autocomplete: 'current-password', required: true, minlength: 8 });
  const nameRow = el('label', { style: { display: 'none' } }, 'Name', name);
  const go = el('button', { class: 'btn primary big', type: 'submit' }, 'Sign in');
  const swap = el('button', { class: 'btn ghost', type: 'button' }, 'New here? Create an account');
  swap.onclick = () => {
    signup = !signup; nameRow.style.display = signup ? '' : 'none';
    go.textContent = signup ? 'Create account' : 'Sign in';
    swap.textContent = signup ? 'Have an account? Sign in' : 'New here? Create an account';
  };
  const form = el('form', { class: 'stack' }, nameRow, el('label', {}, 'Email', email), el('label', {}, 'Password', pass), go, swap);
  form.onsubmit = async e => {
    e.preventDefault(); go.disabled = true;
    const res = signup
      ? await sb.auth.signUp({ email: email.value.trim(), password: pass.value, options: { data: { full_name: name.value.trim() } } })
      : await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    go.disabled = false;
    if (res.error) return toast(res.error.message, 'bad');
    if (signup && !res.data.session) return toast('Check your email to confirm your account, then sign in.', 'ok');
    onDone();
  };
  return el('div', { class: 'auth' }, el('h1', {}, CONFIG.BRAND), el('p', { class: 'muted', style: { margin: '6px 0 22px' } }, 'Sign in to continue your journey.'), form);
}

// ---------- Shell + router ----------
export const NAV = {
  member: [['#/', 'Dashboard', 'home'], ['#/journey', 'Journey', 'route'], ['#/leaderboard', 'Leaderboard', 'trophy'], ['team.html', 'Team', 'users'], ['#/profile', 'Profile', 'user']],
  admin: [['#/', 'Overview', 'home'], ['#/terminal', 'Terminal', 'terminal'], ['#/probationers', 'Probationers', 'users'], ['#/review', 'Evidence', 'inbox'], ['#/feedback', 'Feedback', 'chat'], ['#/settings', 'Settings', 'gear']],
};
export function shell(root, role, items = NAV[role]) {
  const route = location.hash || '#/';
  const main = el('main', { class: 'main', id: 'view' });
  const links = items.map(([href, label, ic]) => el('a', { class: 'nav' + (href === route ? ' active' : ''), href, 'aria-label': label }, icon(ic), el('span', {}, label)));
  const rail = el('nav', { class: 'rail' }, el('div', { class: 'brand' }, el('i'), el('span', {}, CONFIG.BRAND)), links, el('div', { class: 'spacer' }),
    el('button', { class: 'nav btn ghost', onclick: toggleTheme, 'aria-label': 'Toggle theme' }, icon('sun'), el('span', {}, 'Theme')),
    el('button', { class: 'nav btn ghost', onclick: signOut, 'aria-label': 'Sign out' }, icon('out'), el('span', {}, 'Sign out')));
  root.replaceChildren(el('div', { class: 'shell' }, rail, main));
  return main;
}
// routes: { '#/': async (main) => {...}, '#/journey': ... }. Re-renders on hash change.
export function startRouter(root, role, routes, profile) {
  const draw = async () => {
    const main = shell(root, role);
    const h = routes[location.hash || '#/'] || routes['#/'];
    main.replaceChildren(skeleton());
    try { main.replaceChildren(); await h(main, profile); }
    catch (e) { main.replaceChildren(empty('Something went wrong', e.message || 'Try reloading the page.')); }
  };
  addEventListener('hashchange', draw); draw();
}

// ---------- Page bootstrap: call from index.html / admin.html / team.html ----------
export async function boot(root, { role, routes, onMember }) {
  if (!configured) return root.replaceChildren(el('div', { class: 'auth' }, el('h1', {}, 'Almost there'), el('p', { class: 'muted' }, 'Open js/config.js and paste your Supabase URL and anon key.')));
  const go = async () => {
    const p = await me();
    if (!p) return root.replaceChildren(authView(go));
    if (role === 'admin' && p.role !== 'admin') return root.replaceChildren(el('div', { class: 'auth' }, el('h1', {}, 'Admins only'), el('p', { class: 'muted' }, 'This area is for circle admins.'), el('a', { class: 'btn', href: 'index.html', style: { display: 'inline-block', marginTop: '14px' } }, 'Back to my journey')));
    if (role === 'member' && p.role === 'admin' && !location.search.includes('as=member')) return location.replace('admin.html');
    startRouter(root, role, routes, p);
  };
  go();
}
