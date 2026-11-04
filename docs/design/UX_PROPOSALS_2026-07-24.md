# Sofos UI/UX Proposals — 2026-07-24

**Status: PROPOSAL — nothing here is implemented.** For Samuel to mark up. Companion mockups: `mock2-workspace.html`, `mock2-project.html`, `mock2-home.html`, `mock2-onboarding.html`, `mock2-dark.html` (same directory).

## How this was produced
Research: Astryx (Meta's open-source design system — neutral base + strategic accent, generous whitespace, progressive disclosure, one chip/badge language, first-class dark mode) + 2026 SaaS-design references (Linear-style minimalism/speed; onboarding that routes by intent; empty states as the make-or-break moment). Fleet: 6 agents against a sim stack (fresh DB, real built SPA) — 3 Playwright browser personas (novice following onboarding end-to-end; impatient skeptic; systematic screen inventory, ~100 screenshots), 1 zero-knowledge API agent (onboarding from nothing: 14 requests to competency, 6.5/10), 2 expert reviewers (visual design-language; UX flows/IA — both live-tested plus source-read). Persona ratings: first-impression clarity 3/10, onboarding 5/10, task ease 7/10, visual appeal 7/10. Repeated verdict: **"the bones are good"** — fast interactions, clean base palette, strong roadmap metaphor, exemplary modal a11y, unified error banners. The gaps are composition, wayfinding, feedback visibility, and system consistency.

---

## A. Verified defects (a bugfix slice, separate from design work — awaiting your go)

These were found and reproduced by the fleet. They're small code fixes, listed here only because the design work assumes they're gone:

1. **Sidebar active-state goes stale** on `/projects/:id/roadmap|board` — highlights the last-visited workspace (reproduced twice).
2. **"Replay tour" is dead in normal use** — the sessionStorage flag is only read in Layout's mount-once effect, and Layout never remounts on SPA navigation (P28 design flaw, mine). Fix: re-check on route change.
3. **Organize modal misbuckets hierarchy** — unrelated top-level workspaces render as children of the open workspace; `TreePicker`'s `__root__` bucket logic is correct, `OrganizeTree`'s copy is not.
4. **Mobile project page stacks content above identity** — the tasks/notes column renders before the project's title/description at phone width; a user scrolls a wall of tasks before learning what page they're on.
5. **Share form fails silently for real users** — with no target picked (the default), submit sets an error the skeptic persona never saw, and success requires a second confirm-modal step; net effect read as "dead button, no network request." Fix: inline error next to the button, disable submit until valid, and/or collapse the confirm step.
6. **Keyboard access hole**: `.delete-x` / `.goal-edit-btn` / drag handles use hover-only `visibility: hidden` with no `:focus-within` fallback — every edit/delete/reorder control is keyboard-unreachable (and undiscoverable on touch) despite correct aria-labels.
7. **TaskItem checkbox unlabeled** (GoalNode's is correct — copy the pattern).

## B. Design proposals (themed, ranked within theme; effort S/M/L)

### B1. One component system (foundation for everything else)
- **One `.chip` base** — role/status/op/tag chips are four hand-synced copies of the same recipe; collapse to one base + modifiers. Give `reader` a deliberate quiet style (today it looks unstyled). (S-M)
- **One danger button** — `.btn-danger` and `.danger-btn` are byte-identical duplicates used inconsistently. (S)
- **One card family** — bring `board-card` onto `--radius-card` + `--surface` (it's the only card that doesn't match). (S)
- **One row primitive** — `.row-list` (borderless hover) vs `.member-row` (boxed) both mean "a resource in a list"; pick one. (M)
- **One section-header idiom** — `.section-label` everywhere a page groups content (Settings uses h3/h4; ProjectPage mixes three treatments in one column). Add the missing `· N` counts to Tasks/Notes headers (every sibling section has them). (M)
- **Honor the token scales** — ~50 off-scale rem values and ~15 near-duplicate font sizes vs. the 7 declared tokens; sweep onto the scale, extending it 2-3 stops where genuinely needed. (M-L, mechanical)
- **Legibility floor** — the 0.65–0.72rem uppercase+letterspaced mono meta text is a pervasive readability tax; raise the floor or drop the letterspacing at that size. (S)

### B2. Page composition & hierarchy (the "8 equal zones" problem)
- WorkspacePage and ProjectPage present 8-9 peer sections with identical visual weight. Proposal (see `mock2-workspace.html`, `mock2-project.html`): two-tier structure — **primary zone** (identity: breadcrumb, title, description, tags + the content that page exists for) and a **secondary panel band** (Links/Files/Suggestions grouped in a shared quiet panel), with exactly two heading weights. Roadmap+Board route-cards merge into one compact "views" row. (M)
- **Max-width for reading surfaces** — notes/descriptions currently float in unbounded whitespace at 1440px. (S)
- **Move modal deserves its consequence** — indentation, icons, destination breadcrumb preview ("Website → will live under: Home / Ops"). TreePicker already has depth data; the mock shows the treatment. (S-M)

### B3. Navigation & wayfinding
- **Real breadcrumbs on Roadmap and Board** (they hand-roll a single back link and lose the trail). (S)
- **Sidebar: show the current trail** — keep top-level-only listing, but when inside a nested workspace, show an indented "you are here" trail under its top-level ancestor (not a full tree — just the active path). (M)
- **Resolve the Home/Overview/Home-workspace triple collision** — proposal: nav + page both say **Overview**; only the default workspace keeps the name "Home". (S)
- **Quick-switcher (deferred candidate)** — Cmd-K jump to any workspace/project. High value as nesting grows; largest nav item. (L)

### B4. Onboarding & first-run (ratings: 3/10 clarity, 5/10 usefulness)
- **The login page must say what Sofos is** — one sentence + three glyph bullets (see `mock2-onboarding.html`). The single cheapest first-impression fix. (S)
- **Tour: show, don't tell** — today 4 of 5 steps float unanchored (their targets aren't mounted on Home) and the copy front-loads collaboration jargon. Proposal: cut to 3 anchored steps on Home (workspaces grid → the seeded Home card → sidebar/trash), move board/roadmap/suggestions steps to **contextual first-visit tips** that fire the first time each surface is actually opened (one dismissible card each, same seen-flag mechanism). (M)
- **Defer the share code** — don't lead with it at registration; move it to the Sharing step/tip and Settings. (S)
- **Explain the agent checkbox** — one helper line under "Register as an agent account" ("for AI/automation accounts — humans leave this off"). (S)

### B5. The review loop (owners) & suggester experience
- **Home "Needs your review" must roll up** — it currently shows only tenant-root suggestions (structurally ~always 0) while real ones wait inside workspaces: a false all-clear on the landing page. Proposal: aggregate pending counts across all owned containers with per-container jump links (see `mock2-home.html`). (M)
- **Propose-mode should announce itself** — suggesters see the same "+ Task"/"Edit" buttons as writers and only learn from a toast afterward. Proposal: role-aware labels ("Suggest task…") + a quiet persistent "you're suggesting" banner per container. (M)
- **"My suggestions" view** — a suggester currently has to remember every container they proposed into; one list (status + retract) fixes it. (M)

### B6. Boards & tasks
- **Project board should see its subtree** — the novice read the non-rolling project board as data loss. Proposal: project board includes sub-project tasks with a "· includes sub-projects" toggle (default on), matching the workspace board's behavior. (M — needs one API param, design-approved first)
- **Mobile board scroll affordance** — partial next-column peek + edge fade (mock demonstrates). (S)
- **Column ergonomics** — max-height + internal scroll per column so a 30-task column doesn't grow the page. (S)
- **PRODUCT DECISION flagged, not proposed**: due dates / priorities do not exist and the novice hunted for both. Deliberate minimalism or a future phase? Your call — if wanted, it's a full feature (model + UI + boards/roadmap interplay).

### B7. Dark mode (Astryx-inspired, staged)
- **Stage 1 now (S)**: tokenize the 3 hardcoded overlay/shadow rgba escapes; add a `--surface-raised` elevation token.
- **Stage 2 (M-L)**: full dark palette — core tokens + dark-safe tag hues (the 24 hardcoded tag hex values need genuinely different values, not inverted lightness) + shadow strategy. `mock2-dark.html` shows the proposed dark workspace page.

### B8. Agent onboarding DX (from the zero-knowledge agent, 6.5/10)
- Unauthenticated hint: `GET /api` (and the 401 body) should point at register + guide ("Sofos vX · POST /api/auth/register · docs at /api/guide"). (S)
- Register response for humans gains a small `next` pointer (agents already get `agentSetup`); the guide/`/api/me` should be reachable knowledge *before* the register decision — make the guide public or add a public excerpt. (S-M)
- `isAgent: true` discoverability — the flag that unlocks the good onboarding is invisible; mention it in the unauth hint + register validation messages. (S)
- OpenAPI spec (deferred candidate). (L)

## C. Proposed implementation plan (for your markup — nothing scheduled)

| Slice | Contents | Size |
|---|---|---|
| **UX-0 bugfixes** | Section A items 1-7 | S — one phase |
| **UX-1 foundation** | B1 component unification + legibility floor + B7 stage 1 | M |
| **UX-2 composition** | B2 page recomposition + B3 breadcrumbs/naming/sidebar trail | M |
| **UX-3 onboarding** | B4 all + share-form redesign remainder | M |
| **UX-4 review loop** | B5 all | M |
| **UX-5 boards** | B6 (minus the due-dates decision) | S-M |
| **UX-6 dark mode** | B7 stage 2 | M-L |
| **UX-7 agent DX** | B8 (minus OpenAPI) | S |

Suggested order: UX-0 → UX-1 → UX-2 → UX-3, then 4/5/7 in any order, 6 when wanted. Deferred/decision items: quick-switcher, due dates/priorities, OpenAPI, tag-color strategy (hash collisions noted — user-assignable colors are an alternative).

## D. What the fleet says to protect (don't regress these)
Fast optimistic interactions everywhere; the completed-tasks interaction; the workspace board roll-up ("the single best see-everything view"); the roadmap YOU-ARE-HERE metaphor and its microcopy; unified red error banners; modal focus discipline; mobile drawer nav; 2-clicks-back-to-anything.
