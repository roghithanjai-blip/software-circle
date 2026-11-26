# Terminal language (v2: roadmaps)

Runs inside `admin.html`, Terminal. Flow: **write, Dry run (preview, nothing saved), Apply (atomic)**. If any line fails, nothing changes. Every applied run is saved in `terminal_log`. The full agent-facing version is `docs/MASTER_KEY_PROMPT.md`.

Structure: **Roadmap, Phases, Activities, Steps.** A roadmap is hidden from members until it is **deployed** (toggle in the admin panel, or `deploy roadmap`). Content inside it needs no separate publish lines.

## Basics
- `#` starts a comment (except inside a step explanation). Blank lines are ignored.
- Names are matched by title, case-insensitive. Missing or duplicate titles stop the run with a clear error. Add `in roadmap "X"` (or `in phase "Y"`, `in activity "Z"`) to disambiguate.
- Nesting by indentation, 2 spaces per level: roadmap 0, phase 2, activity 4, step 6. A line at the left edge never inherits context, so it must name where it belongs.
- Values with spaces must be quoted: `dur="8 weeks"`. Stray words are errors, not ignored.

## Create
```
roadmap "Machine Learning" curator="Dr. Kavya Rao" curator_title="ML Engineer, Acme" curator_link=https://linkedin.com/in/x dur="8 weeks" sum="Train your first model" icon=🧠 audience=member,probationer
  phase "Foundations" dur="2 weeks" desc="Python and data"
    activity "Clean a dataset" kind=build dur="3h" obj="..." out="..." submit=yes
      step "Set up" | Create a venv | self
      step "Show the plot" | Screenshot the chart | evidence review link=https://example.com/docs
```
- roadmap options: `curator curator_title curator_link dur sum icon audience` (`audience=everyone` or role keys)
- phase options: `icon dur desc`
- activity options: `kind dur obj out sum instr submit=yes|no`
- step: `step "Title" | one-line explanation | completion [review] [link=URL]`, completion is `self`, `link`, `evidence` or `review`. `self review` is invalid.

## Change
```
edit roadmap "ML" set curator="New Name" dur="10 weeks" audience=everyone
edit phase "Foundations" in roadmap "ML" set desc="New text"
edit step "Set up" in activity "Clean a dataset" set title="Set up env" completion=evidence review=yes
move roadmap "ML" at 1
move phase "Foundations" in roadmap "ML" to roadmap "Other" at 2
move activity "Clean a dataset" in phase "Foundations" to phase "Modelling" at 1
move step "Set up" in activity "Clean a dataset" to activity "Other" at 3
dup activity "Clean a dataset" in phase "Foundations"
```

## Release and remove
```
deploy roadmap "ML"          # refused if the roadmap has no phases
undeploy roadmap "ML"
unpublish phase "Foundations" in roadmap "ML"     # optional hold-back inside a deployed roadmap
archive roadmap "ML"         # hidden, progress kept (also phase, activity, step)
delete activity "Draft"      # only if nobody has progress
```

## Teams (member-formed, from `schema_teams.sql`)
```
teams open "Git Pairing" size=3 until=2026-12-05 checkpoint="Clean a dataset"
teams close | teams autoform | teams dissolve        (one per line)
team create "Team Alpha"
team assign "Asha" to "Team Alpha"
team remove "Asha"
assign activity "Branch Battle" to teams due=2026-12-10
```
`until` and `due` are dates, end of day India time. Users, roles, groups, tasks and the login log are managed in the admin panels, not here.

## Parser output contract (`js/parser.js` to `apply_commands`)
| Line | JSON |
|---|---|
| `roadmap` | `{op:"add_roadmap", title, curator_name, curator_title, curator_link, est_duration, summary, icon, audience:[...]}` |
| `phase` | `{op:"add_phase", roadmap, title, icon, est_duration, description}` |
| `activity` | `{op:"add_activity", roadmap?, phase, title, kind, est_duration, objective, deliverable, summary, instructions, requires_submission}` |
| `step` | `{op:"add_step", roadmap?, phase?, activity, title, explanation, completion, requires_review, resource_url}` |
| `edit T "m" [in ...] set k=v` | `{op:"edit", target, match, roadmap?, phase?, activity?, set:{...}}` |
| `move T "m" [in ...] [to ...] [at N]` | `{op:"move", target, match, roadmap?, phase?, activity?, to_roadmap?, to_phase?, to_activity?, at?}` |
| `deploy` / `undeploy` | `{op, match}` |
| `publish` / `unpublish` | `{op, target, match, roadmap?, phase?, cascade?}` |
| `archive` / `delete` | `{op, target, match, roadmap?, phase?, activity?}` |
| `dup activity` | `{op:"dup_activity", match, roadmap?, phase?}` |
| team commands | see `schema_teams.sql` (`teams_open`, `teams_close`, `teams_autoform`, `teams_dissolve`, `team_create`, `team_assign`, `team_remove`, `task_assign`) |

## Continuing with an AI agent
Use **Export current** to get the live journey as a script (it round-trips: export, wipe, apply gives the same export). Paste it to the agent together with `docs/MASTER_KEY_PROMPT.md`.
