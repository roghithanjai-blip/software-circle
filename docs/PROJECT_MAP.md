# Project map

Static site (vanilla JS modules, no build) + Supabase (Auth, Postgres, Storage). All security is Row Level Security plus `security definer` functions.

## Files

| Path | Job | Status |
|---|---|---|
| `index.html` + `js/member.js` + `css/moss.css` | member app in the Stitch "Software Circle" look: dashboard with roadmap boxes and rings, roadmap page, notifications, leaderboard, profile, first-login onboarding | working |
| `js/image.js` | resizes profile photos in the browser (up to 15 MB in, sharp 1024 px out) | working |
| `js/data.js`, `js/workspace.js` | member journey loader; activity workspace with link, screenshot and review submission | working |
| `admin.html` + `js/admin.js` | admin entry, Overview with journey map | working |
| `js/roadmaps.js`, `js/editor.js` | Roadmaps panel (boxes, deploy switch) and roadmap editor | working |
| `js/terminal.js`, `js/parser.js` | Terminal: parse, dry run, apply, export, history | working |
| `js/review.js`, `js/probationers.js` | evidence review; probation tracking (progress counted in the database) | working |
| `js/core.js`, `js/config.js`, `js/diag.js`, `css/app.css` | auth, router, UI helpers, keys, startup errors, styles | working |
| `sql/schema.sql` | core tables, RLS, points, leaderboard, storage | run 1st |
| `sql/schema_terminal.sql` | terminal v1 (superseded by v2 but still needed for `terminal_log`) | run 2nd |
| `sql/schema_teams.sql` | member-formed team rounds, requests, team stats, team terminal ops | run 3rd |
| `sql/schema_v2.sql` | roadmaps and deploy gate, roles, onboarding fields, login log, groups, tasks, circle directory, avatars | run 4th |
| `sql/schema_terminal_v2.sql` | roadmap-aware terminal, export | run 5th |
| `sql/schema_v3.sql` | audit fixes: types bug, https links, safe paths, prerequisites, points, indexes, server-side counts | run 6th |
| `sql/schema_v4.sql` | avatar bucket limit raised to 5 MB (the browser resizes first) | run 7th |
| `docs/TERMINAL_SPEC.md` | terminal language and parser contract | current |
| `docs/MASTER_KEY_PROMPT.md` | prompt for any AI agent: interviews you, outputs a terminal script | current |
| `docs/STITCH_PROMPT.md` | prompts for the Stitch member UI | current |
| `docs/OPENCODE_AUDIT_PROMPT.md` | read-only audit prompt | current |
| `docs/DECISIONS.md` | audit triage, answers to design questions, data-model notes | current |

## Setup order
1. Run the seven SQL files in the order above (all can be re-run safely).
2. Fill `js/config.js` with the project URL and anon key.
3. Run `npx serve .` and open `http://localhost:3000/`.
4. Sign up, confirm the email (or turn off "Confirm email" while testing), then make yourself admin:
   `update profiles set role = 'admin' where id = (select id from auth.users where email = 'YOU');` (run in the SQL editor).

## Still to build
- Admin: User management (people, roles, add-role button, login log, groups, assigning tasks), Feedback, Settings.
- Member: Tasks page, Circle (Members) page, team page, Research (spec received, awaiting confirmation of the change list). Stitch designs exist for Tasks and Circle.
- Achievements are in the database but nothing awards them yet.
