# Stitch prompt pack: member UI for Mission Control

How to use: paste **Paste 1** first, then generate one screen at a time with **Paste 2 to 12**. Stitch gives better results one screen per prompt. When you paste the generated code back to Claude, send one screen per message, HTML and CSS together, starting with the dashboard.

Admin screens are not part of this pack.

## Element inventory (everything the member UI contains)

**App shell**
- Left rail (desktop), icon rail (tablet), bottom bar (phone): Dashboard, Tasks, Leaderboard, Circle, Profile
- Top bar: notification bell with unread dot, theme toggle, avatar menu (profile, sign out)
- Toasts, modal, slide-over panel, breadcrumbs, tabs, tooltips

**Screens**
1. Sign in and create account
2. First-login onboarding (cannot be skipped)
3. Dashboard: continue-mission bar, roadmap boxes, status, upcoming tasks, leaderboard preview, updates
4. Roadmap page (full screen): curator, overall progress, phase timeline, activities
5. Activity workspace: objective, deliverable, steps, evidence upload, link submit, reviewer feedback
6. Tasks: list with filters, task detail
7. Leaderboard: all time and this week
8. Circle: everyone, grouped by role
9. Notifications panel and page
10. Profile: view and edit
11. Empty, locked, loading and error states

**Components**
- Buttons: primary, secondary, ghost, danger, loading
- Inputs: text, email, phone, select, file upload with circular photo preview, validation messages
- Status chips: Not started, In progress, Awaiting review, Needs changes, Done, Locked, Individual, Team
- Progress: ring (green arc, percentage in the centre), thin bar, segmented step strip (one segment per step)
- Roadmap box with hover state, avatar with initials fallback, timeline with stops, collapsible step row with tick, list row, tabs, skeleton loader, empty state

---

## Paste 1: global brief (give this to Stitch first)

Design the member-facing web app for **Mission Control**, a platform where members of a college software research circle follow expert-curated **roadmaps** (for example "Machine Learning", "Probation", "Set up your desktop for X"). Members learn by building: they complete small steps, submit proof (links or screenshots), and see their progress. There is no teacher and student hierarchy. The tone is calm, confident and practical, like a good developer tool, not a school website.

**Look and feel.** Dark-first, with a polished light mode. A premium developer-tool feel, restrained and editorial, built on strong typography and spacing rather than decoration.

**Colour tokens.**
- Background #0D1220, surface #141B2E, raised surface #1B2440, lines #27314F
- Text #E8ECF7, muted text #8C97B5
- Amber #F2B544 only for the single primary action on a screen
- Green #5ED6A4 for progress rings and completed states
- Blue #7B93FF for informational states, red #FF7A7A for problems

**Type.** Bricolage Grotesque for headings, Instrument Sans for body text, JetBrains Mono only for code. Radii 8, 12 and 18 px. 4 px spacing grid. Line icons, 1.75 px stroke, Lucide style.

**Layout.** Left navigation rail on desktop, icon rail on tablet, bottom bar on phone. Generous whitespace. A coherent layout, not a wall of cards: use cards only where a card is the real unit (a roadmap box, a task).

**Avoid:** purple or pink gradients, glassmorphism, neon glows, emoji used as icons, stock illustrations, a hero with three identical feature cards, confetti or childish gamification, centred-everything layouts, lorem ipsum, decorative blobs. Use realistic content from an Indian college software circle (names like Aarav, Meera, Karthik; roadmaps like "Machine Learning").

**Output.** Semantic HTML and one CSS file. Colours, radii and spacing as CSS variables. Plain CSS only: no Tailwind, no frameworks, no JavaScript libraries. Responsive from 360 px to 1440 px. Visible focus states, AA contrast, aria labels on icon buttons. Meaningful class names.

## Paste 2: Sign in and onboarding

Two screens. (1) Sign in: product name, short line "Pick up your roadmap where you left off", email, password, primary button, link to create an account, no social buttons. (2) First-login onboarding that blocks the app until it is complete: heading "Tell us about you", a circular profile photo upload with live preview and a Replace link, then fields for full name, college roll number, mobile number, college email, year of study (select), LinkedIn link and GitHub link, each with a label, hint and inline validation message. One amber button "Enter Mission Control". A note that mobile number and roll number are visible to admins only.

## Paste 3: Dashboard

The member's home. Top: greeting with first name, the date, and a small green progress ring with "14 of 38 steps". Then a wide **Continue mission** bar: breadcrumb (Roadmap › Activity), the next step title, one-line explanation, and one amber button "Continue mission". Below it the section **Roadmaps** as a responsive grid of boxes (Probation, Machine Learning, Personal workflow fixing, Set up your desktop for web dev). Each box shows the roadmap name, a line "Curated by Dr. Kavya Rao", step count, a status line (Not started, In progress, Complete) and, at the bottom corner, a small circular progress ring with the percentage in the centre and the green arc drawn to that percentage (50% shows a half circle). On hover the box lifts slightly and its outline brightens. Further down, in two columns: **Status** (items needing changes or awaiting review) with **Upcoming tasks** (three rows with deadlines), and **Leaderboard** (top 5 plus "You are #4 with 120 points") with **Updates**.

## Paste 4: Roadmap page (opens from a box, full screen)

Back link to the dashboard. Header: roadmap title, one-line summary, a **Curated by** block (avatar, name, role such as "ML Engineer, Acme"), estimated duration, a large green progress ring. Main area: a vertical **timeline** of phases with numbered stops (01, 02, 03), a connecting line, done stops filled green, the current stop highlighted amber, locked stops dimmed with "Unlocks after Foundations". Under each phase: its activities as rows with a type chip (Build, Explore, Research, Challenge), steps done "3/7", and a Done chip. A narrow side panel shows "Next up" with the next step.

## Paste 5: Activity workspace

Breadcrumb, activity title, type chip, duration, progress bar. Two short columns: **Objective** and **You will produce**. A collapsible Instructions section. Then the steps as collapsible rows with a tick circle, title and status chip. Show five states: done (green tick, struck title), current (open, amber title), awaiting review (blue chip), needs changes (red chip with a quoted reviewer note), and a todo step. Inside an open step: one-line explanation, optional resource link, and the right control: a self-complete tick, a link field with Submit, or a screenshot upload area with image preview, Remove and Replace, then Submit screenshot. At the bottom: a "Give feedback on this activity" disclosure with a type select and a message box.

## Paste 6: Tasks

Page title Tasks. Filter tabs: All, Individual, Team, Due soon, Done. A list where each row has the task title, a chip (Individual or Team), the deadline with relative time ("Due in 3 days", red when overdue), a status chip and who assigned it. Second screen: **task detail** as a slide-over or full page with title, description, type, deadline, assigned by, team members with avatars if it is a team task, linked activity, a submission area (link or note, optional screenshot) and a status timeline.

## Paste 7: Leaderboard

Tabs All time and This week. A clean ranked list: rank number, avatar, name, points, the viewer's own row highlighted in amber text. A small "How points work" expander (steps, verified evidence, activities) stating that speed is not rewarded. An empty state for a week with no points.

## Paste 8: Circle

Title Circle, a search field, and sections grouped by role: Lead, Manager, Members, Probationers, Former members (muted). Each person: avatar, name, role chip, year of study, small GitHub and LinkedIn icon links. Clicking a person opens a small profile popover. Do not show phone number, roll number or email. Dense, calm, scannable list, not big cards.

## Paste 9: Notifications

A bell in the top bar with an unread dot opens a dropdown panel; also a full page version. Each item: small type icon (approved, needs changes, new roadmap, task assigned, milestone), a one-line message, time ago, unread indicator. Buttons "Mark all read". Include an empty state.

## Paste 10: Profile

Photo with Replace, full name, role chip, year. Stats row (steps done, points, rank). A "My details" form with roll number, mobile number, college email, year of study, LinkedIn and GitHub, and a Save button. Below: progress per roadmap (small rings), and a restrained achievements row (First Commit, Debugger, Builder) as quiet outlined badges, not cartoon medals.

## Paste 11: States

One screen showing: loading skeleton for the dashboard, an empty roadmap list ("No roadmaps are open for you yet"), a locked phase, an error banner with Retry, and a toast for "Step complete".

## Paste 12: Mobile

The dashboard and the activity workspace at 390 px wide with the bottom navigation bar, stacked roadmap boxes and a sticky Continue mission button.
