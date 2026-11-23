# Project map

| File | Job | Status |
|---|---|---|
| `schema.sql` | tables, RLS, `complete_step()`, points, leaderboard, storage | done |
| `schema_terminal.sql` | `apply_commands()`, `export_script()`, `terminal_log` | done |
| `schema_teams.sql` | team rounds, requests/invites, one-team rule, team stats, team terminal ops | done |
| `TERMINAL_SPEC.md` | terminal language and parser contract | done |
| `css/app.css` | dark/light theme, shell, rings, route timeline, steps, terminal styles | done |
| `js/config.js` | Supabase URL + anon key (you fill in) | done |
| `js/core.js` | Supabase client, sign in/up, role guard, router, UI helpers | done |
| `js/parser.js` | pure script parser, tested against the spec examples and bad input | done |
| `js/terminal.js` | terminal view: dry run, apply, export, history, cheat sheet | done |
| `admin.html` + `js/admin.js` | overview + journey map, terminal, evidence review (`js/review.js`), probationers (`js/probationers.js`); feedback + settings next | partly done |
| `index.html` + `js/member.js` | login, dashboard, Continue Mission, activity workspace, leaderboard, profile | todo |
| `team.html` + `js/team.js` | team page: members, task progress, GitHub links; form-team panel | todo |

Setup order: run `schema.sql`, then `schema_terminal.sql`, then `schema_teams.sql`, then promote yourself to admin (last line of `schema.sql`).
