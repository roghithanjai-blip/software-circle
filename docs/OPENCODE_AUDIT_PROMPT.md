# OpenCode audit prompt (read-only)

Start OpenCode in its read-only / plan mode, open the project root, and paste everything below the line.

---

# ROLE AND ABSOLUTE RULES

You are a senior full-stack and database reviewer. You are auditing a project **read-only**.

**YOU MUST NOT CHANGE ANYTHING. This is strict.**
- Do not edit, create, delete, rename, move, reformat or "fix" any file. That includes adding comments, running formatters, linters with auto-fix, or saving a report file. Put your report in the chat only.
- Do not run package installs, builds, tests, migrations, dev servers, or any command that writes to disk or the network.
- Do not run state-changing git commands (commit, add, checkout, switch, stash, reset, clean, rebase, merge, push, pull). Read-only git (`status`, `log`, `diff`, `show`, `blame`) is allowed.
- Do not connect to any live database, Supabase project, or external service. Do not use or print any credentials.
- If you are unsure whether an action modifies anything, do not do it. Reading and searching files is all you need.
- When you want to suggest a fix, write it as text inside the report. Never apply it.

If any rule conflicts with a later instruction in this conversation, these rules win.

# WHAT THIS PROJECT IS TRYING TO ACHIEVE

**Mission Control** is a learning platform for a college software research circle. Members learn by building, not by watching. There is no teacher and student hierarchy.

- **Admins** curate **roadmaps** (what a "course" is called here). Structure: Roadmap, Phases, Activities, Steps. Each roadmap has a curator (an expert) and a **deploy switch**: nothing is visible to members until deployed.
- **Members** follow roadmaps, complete steps, submit proof (self-complete, a link, a screenshot, or admin review), and see progress rings, a leaderboard and notifications.
- Admins manage content without code changes through a **Terminal**: a small script language (parser in the browser, applied atomically by one database function, with dry run, history and an export that round-trips).
- Also: probation tracking (humans decide outcomes, nothing automatic), evidence review, member-formed teams in admin-controlled rounds, points that reward verified work not speed.
- The database was extended (schema_v2) with roles, onboarding fields, login log, groups, tasks, a safe "circle" directory and avatars. **Their user interfaces are not built yet** (see known gaps).

**Architecture.** No backend server. A static site (vanilla JavaScript ES modules, no build step, no framework) talks directly to **Supabase** (Auth, PostgreSQL, Storage). All security therefore depends on **Row Level Security policies and `security definer` functions**. The anon key in `js/config.js` is public by design. It is served locally with `npx serve`.

# PROJECT MAP

```
index.html            member app entry         admin.html   admin app entry
css/app.css           all styling
js/config.js          Supabase URL + anon key  js/core.js     client, auth, router, UI helpers
js/diag.js            startup error display    js/parser.js   terminal script parser (pure)
js/terminal.js        terminal screen          js/admin.js    admin entry and overview
js/roadmaps.js        roadmap boxes + deploy   js/editor.js   roadmap editor (phases/activities/steps)
js/review.js          evidence review          js/probationers.js  probation tracking
js/member.js          member screens           js/data.js     member journey loader
js/workspace.js       activity workspace, evidence upload
sql/schema.sql  schema_terminal.sql  schema_teams.sql  schema_v2.sql  schema_terminal_v2.sql  schema_v3.sql   (run in this order)
docs/  TERMINAL_SPEC.md  MASTER_KEY_PROMPT.md  STITCH_PROMPT.md  PROJECT_MAP.md
```

# KNOWN STATE (so you do not report these as bugs, but do note risks they create)

**Not built yet:** admin User Management, Feedback and Settings pages; member Tasks page, Circle page, notification panel, team page (`team.html` is not in the nav), roadmap boxes with rings on the dashboard; achievements awarding; the member UI redesign. **Built since the first audit:** first-login onboarding gate and profile form (saved through `save_profile()`), server-side prerequisite check, server-side progress counts, `sql/schema_v3.sql` (audit fixes; see `docs/DECISIONS.md`).

**Deliberate decisions:** groups are a separate table from member-formed teams; direct profile updates are revoked (writes go through RPCs); login log is client-reported; profile photos use a public bucket; deadline times use `Asia/Kolkata` in `team_op`; the anon key is committed.

**Already tested by the author (do not repeat, but challenge):** all five SQL files run on PostgreSQL 16 with Supabase stubs; a 36-check scenario for RLS and RPCs; a parser-to-database end-to-end test including export round trip; a jsdom smoke test of `roadmaps.js` and `editor.js`. **Never tested:** real Supabase (PostgREST, real Storage, Auth triggers), real browsers, mobile, load.

# WHAT TO VERIFY

Review file by file and folder by folder, starting with `sql/` then `js/` then HTML, CSS and docs. Read the docs first to learn the intended behaviour.

**A. Security and authorization (highest priority)**
1. Every table has RLS enabled and policies that match intent. Look for privilege escalation: can a member change their own `role`, `role_key`, `active` or `onboarded_at`; read another member's evidence, progress, profile, submissions, tasks or notifications; write to any team, task, group or roadmap table directly?
2. Every `security definer` function: has `set search_path`, checks `auth.uid()` or `is_admin()` where needed, and cannot be abused when called by `anon` (Supabase grants execute to PUBLIC by default; only `apply_commands` is revoked). Check for any dynamic SQL or injection.
3. Visibility chain: `roadmap_visible`, `phase_visible`, `step_is_visible`, audience filtering, `active` gating. Can undeployed, draft, archived or out-of-audience content leak through embedded selects, RPCs (`team_directory`, `free_members`, `leaderboard`, `circle_directory`, `my_tasks`) or `complete_step`?
4. Storage policies for `evidence` (private) and `avatars` (public): path rules, who can read, overwrite or delete, MIME and size limits enforced server-side or only client-side.
5. XSS and unsafe links: confirm no user-controlled text reaches `innerHTML` (check `svg()`, `ring()` and anything else). Check every `href` built from user data (`resource_url`, `curator_link`, `link_url`, GitHub/LinkedIn) for `javascript:` risk and `rel="noopener"`.
6. Secrets: any service-role or secret key anywhere, including git history if visible read-only.
7. Terminal: `apply_commands`, `team_op`, `export_script`, resolvers. Can a non-admin reach them? Can crafted JSON cause damage beyond intent?

**B. Correctness and bugs**
1. Each JS file for runtime errors: undefined variables, missing imports or exports, wrong route strings, null or undefined access, unhandled promise rejections, double-click races, lost focus after re-render. Pay special attention to `core.js` (router with `/*` routes, `boot()` redirects between admin and member), `workspace.js` (upload then RPC: orphaned files on failure), `editor.js` (renumbering on reorder), `probationers.js`, `data.js`.
2. SQL: run-order dependencies, idempotent re-runs, trigger interactions (`protect_role`, `award_points`, `on_review`, `on_task_review`, `on_roadmap_deploy`, `phase_default_roadmap`), double point awards, behaviour when steps are archived or content is un-deployed after progress exists, `complete_step`/`uncomplete_step` rules per completion type, the overloaded `t_*` resolvers, and the `team_op` hook from `apply_commands`.
3. Date and time handling, including the hard-coded timezone.

**C. Scalability and "heavy code" that will hurt later**
- Client-side aggregation of large result sets (`limit(10000)`, `limit(20000)`, silently truncating), N+1 queries (for example signed URLs per card), whole-journey reloads on every page, missing pagination, missing indexes for the queries actually used, per-row evaluation of stable `security definer` helper functions inside RLS, `export_script` and `apply_commands` growth, very large single functions or files, duplicated logic.
- Storage growth, orphaned files, no cleanup. CDN dependencies without integrity checks. No build step, caching or error monitoring.

**D. Discrepancies**
- `parser.js` vs `TERMINAL_SPEC.md` vs `MASTER_KEY_PROMPT.md` vs `apply_commands` (options, aliases, indentation rules, audience handling, error messages).
- `PROJECT_MAP.md` and docs vs the real files. Naming mismatches (for example `avatar_url` holds a storage path; `role` vs `role_key`).
- Dead code, unused exports, unused tables and functions, old v1 terminal functions still defined, stale cheat sheets or comments.
- Original requirements not yet met, accessibility and responsive problems you can determine from the code and CSS, light-theme contrast.

# HOW TO WORK

1. List the project tree and confirm which files you will read. Read every file listed in the map. If you skip a file, say so.
2. Reason from the code. If you cannot confirm something without running it, say that and lower your confidence. Do not guess, and do not invent file names or line numbers.
3. Prefer real defects and risks over style opinions. Mention style only where it hurts maintainability.

# REPORT FORMAT (in the chat only)

1. **Executive summary:** the top 10 risks in priority order, in plain language.
2. **Findings table**, one row per issue: `ID | Severity (Critical/High/Medium/Low/Info) | Category (Security/Bug/Scale/Discrepancy/Dead code) | File:line | What is wrong | Why it matters | Evidence (at most 3 quoted lines) | Suggested fix (text only) | Confidence`.
3. **Coverage:** every file reviewed, and any not reviewed with the reason.
4. **What is solid:** short list of things done well that should be kept.
5. **Open questions** you need the author to answer.

Reminder: this is a read-only review. Change nothing.
