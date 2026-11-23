# Terminal language

Runs inside `admin.html`. Flow: **write → Dry run (preview, nothing saved) → Apply (atomic)**. If any line fails, nothing is changed. Every applied run is saved in `terminal_log`.

## Basics
- `#` starts a comment. Blank lines are ignored.
- Names are matched by title, case-insensitive. Missing or duplicate titles stop the run with a clear error.
- Indentation (2 spaces) gives context: an `activity` under a `phase` belongs to it; a `step` under an `activity` belongs to it.
- Outside nesting, say where with `in phase "X"` / `in activity "Y"`.
- New content is **draft** until you `publish`.

## Create
```
phase "Foundations" icon=🚀 dur="2 weeks" desc="Get comfortable with the tools"
  activity "Hello Git" kind=build dur="2h" obj="Understand commits" out="A repo with one commit" submit=yes
    step "Install git" | Run git --version | self
    step "Push a repo" | Push it to GitHub | link
    step "Show your log" | Screenshot git log | evidence review
    step "Explain a branch" | Describe it to a peer | review link=https://git-scm.com/docs
```
Step line: `step "Title" | one-line explanation | completion [review] [link=URL]`
Completion: `self`, `evidence`, `link`, `review`. Adding `review` to `evidence` or `link` sends it to admin approval.

Options: `icon` `dur` `desc` `kind` `obj` `out` `sum` `instr` `submit=yes|no`

## Change
```
edit step "Install git" in activity "Hello Git" set title="Set up git" completion=evidence
edit activity "Hello Git" set dur="3h"
edit phase "Foundations" set icon=🧭
move activity "Hello Git" to phase "Foundations" at 2
move step "Show your log" in activity "Hello Git" at 1
move phase "Foundations" at 1
dup activity "Hello Git"
```

## Publish and remove
```
publish phase "Foundations" all     # "all" also publishes its activities; members get a notification
publish activity "Hello Git"
unpublish phase "Foundations"
archive step "Install git"          # hidden, progress kept
delete activity "Draft idea"        # only if nobody has progress
```

## Parser output contract (`js/terminal.js` → `apply_commands`)
| Line | JSON |
|---|---|
| `phase` | `{op:"add_phase", title, icon, est_duration, description}` |
| `activity` | `{op:"add_activity", phase, title, kind, est_duration, objective, deliverable, summary, instructions, requires_submission}` |
| `step` | `{op:"add_step", activity, phase?, title, explanation, completion, requires_review, resource_url}` |
| `edit T "m" [in …] set k=v` | `{op:"edit", target, match, phase?, activity?, set:{…}}` |
| `move T "m" [in …] [to …] [at N]` | `{op:"move", target, match, phase?, activity?, to_phase?, to_activity?, at?}` |
| `publish/unpublish T "m" [all]` | `{op:"publish"\|"unpublish", target, match, cascade}` |
| `archive` / `delete` | `{op:…, target, match, phase?, activity?}` |
| `dup activity "m"` | `{op:"dup_activity", match, phase?}` |

Option keys map to columns: `dur→est_duration`, `desc→description`, `obj→objective`, `out→deliverable`, `sum→summary`, `instr→instructions`, `link→resource_url`, `submit→requires_submission`.

## Continuing with Claude
Run `select export_script();` (or the Export button) and paste the result to Claude. Then say what to add or change, and Claude replies with a terminal script ready to paste.

---

# Team commands (need `schema_teams.sql`)

```
teams open "Git Pairing" size=3 until=2026-12-05 checkpoint="Hello Git"
teams close                      # stop formation; teams stay, pending requests cancelled
teams autoform                   # place everyone still teamless (fills open teams first)
teams dissolve                   # end the round, free every member; history is kept
team create "Team Alpha"
team assign "Asha" to "Team Alpha"      # name or email
team remove "Asha"
assign activity "Branch Battle" to teams due=2026-12-10
```
- `until` / `due` are dates; the deadline is the end of that day (India time, set in `team_op`).
- `checkpoint` is the activity where members get the "Form a team" prompt. The Form-team button in profiles is visible whenever a round is open.
- Only one round can be open at a time. A member can be in only one active team (database rule).
- Members create teams, request to join, invite, accept or decline from their profile. All rules run in the database.

| Line | JSON |
|---|---|
| `teams open` | `{op:"teams_open", name, size, until?, checkpoint?}` |
| `teams close` / `autoform` / `dissolve` | `{op:"teams_close"\|"teams_autoform"\|"teams_dissolve"}` |
| `team create "T"` | `{op:"team_create", team}` |
| `team assign "M" to "T"` | `{op:"team_assign", member, team}` |
| `team remove "M"` | `{op:"team_remove", member}` |
| `assign activity "A" to teams [due=…]` | `{op:"task_assign", match, due?}` |

## Member-side functions the UI calls
`create_team(name)`, `request_join(team)`, `invite_member(team, user)`, `respond_request(id, accept)`, `leave_team()`, `set_team_repo(team, url)`, `add_team_link(team, url, label)`, `team_directory()`, `free_members()`, `team_stats(team)` (powers the Team page).
