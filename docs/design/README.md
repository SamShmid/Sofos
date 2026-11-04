# Sofos — design proposals (NOT implemented)

These are design mockups from the 2026-07-20 critique/redesign session. They are **static HTML previews, not shipped UI** — open them in a browser. The live app still uses its original styling until a redesign phase actually builds this. Each file is self-contained except for three Google Fonts (Bricolage Grotesque / Public Sans / IBM Plex Mono) pulled from a CDN.

## The approved direction
A **trail-map identity in Samuel's blue**: goals are *waypoints*, progress is *distance traveled*, and the app's many small data labels (roles, counts, dates, shareCodes) speak in a monospace map-legend voice. Navy `#003478` (the existing brand blue) is the primary and does the everyday work; a single bright **azure `#0E9CD6`** is spent *only* on "you are here"; red `#B42318` is reserved for destructive actions. **No green, no orange** — an earlier pass used pine-green + blaze-orange and Samuel kept everything except the hues.

## Files
- `design-language.html` — the system on one sheet: palette, type pairing, the waypoint-route signature, button/chip system, and the toast + inline-confirm patterns that replace the app's 57 native `alert()`/`confirm()` calls. **This is the canonical reference.**
- `workspace-mock.html` — the workspace page in the new language (real content): slim header, quiet sidebar, the roadmap as a banner route-card, project grid, a "needs your review" suggestions strip, links/files as rows.
- `roadmap-mock.html` — the signature piece: the serpentine as a *curved* dashed trail (solid where traveled), milestone markers, one azure "you are here" pulse (respects reduced-motion), status-accented goal cards.

## Related
- Full critique + implementation plan: see memory `sofos-redesign-direction.md`, or the "Redesign" note in `PROJECT_TASKS.md`.
- The portable multi-agent build framework prompt (separate concern): `../agent-orchestration-framework.md`.
