# Decisions and audit triage

## First code audit (OpenCode): what was done

| Finding | Verdict | Action |
|---|---|---|
| S01 orphaned screenshot if the submission fails | real | `workspace.js` deletes the uploaded file when `complete_step` fails. `admin_orphan_evidence()` lists leftovers older than a day |
| S02, S03 silent 10,000 / 20,000 row limits | real | replaced by `activity_finishers()` and `probation_progress()` (counted in the database) |
| S04 `apply_commands` callable by any signed-in user | not a flaw | its first statement is `is_admin()`; a wrapper would rely on the same check. Kept |
| S05, S10 N+1 signed URLs, weak link check | real | one batched `createSignedUrls` call; member links must be `https` with no `user@` part (client and database) |
| S06, S24 profile guard and direct updates | partly real | the session flag cannot be set by a browser client, but direct writes were still too loose. `UPDATE` on `profiles` is revoked from signed-in users; all writes go through `save_profile()` / `admin_set_user()` |
| S07 path traversal in storage names | not exploitable | object keys are literal strings, `..` is not resolved. Hardened anyway: path must be `<uid>/<one safe file name>` |
| S09 missing indexes | real | added |
| S11 | auditor withdrew it | none |
| S12 verified-evidence points | real, and worse | the review sync ran before the submission row was saved, so reviewed work never earned the bonus while unreviewed screenshots did. Fixed with an AFTER trigger; the bonus now needs a human reviewer |
| (found while testing) | real | `complete_step` failed for every link, screenshot and review step: the status was an untyped text CASE. Fixed |
| S14, S15, S16, S18, S26 "missing files" | files not saved in the repo | `schema_terminal_v2.sql` and the docs are in the sync pack |
| S19 router picks the first wildcard | real, minor | longest match wins |
| S20, S21 | real, minor | tick colour for "needs changes"; light-theme muted and line colours darker |
| S13, S22 `avatar_url` holds a path | decision | kept the name, documented below; renaming touches many functions |
| S23 two role systems | decision | see below |
| S17, S25, S27, S28, S30 | accepted | dead v1 team DDL is harmless; admin list is low traffic; login log is best-effort |
| S29 `last_active_at` written on every load | real, minor | removed; `log_login()` runs once per browser session |
| prerequisite phases only a display lock | real | `complete_step` now refuses steps in a locked phase |

## Answers to the audit's open questions
- **Roles.** `profiles.role` is permission (`admin` or `member`). `profiles.role_key` is a label (lead, manager, member, probationer, former member, plus any you add) used for audience, Circle grouping and probation. They are separate on purpose; an admin can carry any label.
- **Avatars.** The bucket is public on purpose so the Circle can show photos. `profiles.avatar_url` stores the storage path (`<user_id>/<file>`); build the URL with `getPublicUrl`.
- **Groups vs teams.** Separate tables. Teams are member-formed in rounds with one team per person. Groups are admin-formed with any membership.
- **Timezone.** Team deadlines use `Asia/Kolkata`, set in `team_op`.
- **Login log.** Client-reported, one entry per browser session, with a one-minute de-duplication.
- **Scale.** `loadJourney` fetches a member's whole visible journey. Fine for hundreds of steps; add a summary function if a roadmap grows past a few thousand.

## Operations
- College email rule: `update platform_settings set value = '"yourcollege.edu"' where key = 'college_email_domain';`
- Leftover screenshots: `select * from admin_orphan_evidence();`
