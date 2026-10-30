# Design

## Direction
Operate mode. A clear daylight workspace, informed by broadcast programme listings: quiet blue-gray ground, white work surfaces, slate type, cobalt selection. The schedule's signature is a compact programme list with recurrence and playlist details grouped by entry, not an unscannable technical grid.

Grounded candidates considered: broadcast listings, school timetables, gallery labels, service-directory typography, editorial indexes, library catalogs, and wayfinding. The seed assigned candidate four (service-directory typography, seed:e814b6f78b591dc9). It contributes strong information grouping and calm directory-like navigation. User asked to continue after the proposed light SaaS direction, so implementation proceeds code-first without another selection round.

The annual plate, atlas, manual, map, catalog sleeve, and specimen challengers were declined for lower product clarity and operator familiarity. Retained disciplines: annual's alignment, atlas's ranked importance, manual's progressive disclosure, map's area separation, catalog's restrained density, specimen's typography consistency. No literal artifact decoration.

## System
- System sans throughout. 14px UI, 12px metadata, 28px page title, 18px section title.
- Cool off-white canvas, white panels, cobalt actions, semantic green/amber/red status.
- 232px navigation rail on desktop, compact navigation at narrow widths.
- 8px spacing rhythm, 12px panel corners, 8px controls, restrained borders, no ornamental glow or gradients.
- Clearly visible keyboard focus and native form controls.

## Schedule surface
Device schedule remains an explicit read-only fetch until a confirmed deletion. Open a wide native dialog to give schedule inspection and destructive selection protected focus. Readable entries show identity, status, recurrence, and playlists. Raw diagnostics remain available through entry details. Empty, pending, error, unknown timezone, unavailable readback, and deletion states remain honest. XML download and revision-bound deletion retain their existing wiring.

## Validation
Check desktop and narrow browser layouts, keyboard dialog opening/closing and focus return, entry selection and cancellation without mutations, live schedule reads, all workspace tabs, existing automated tests, and production build. Never operate playback or delete real content during UI validation.

### Observed acceptance results (2026-10-30)
- Baseline `92818a2` exposed nine schedule columns. The redesigned live schedule exposes four grouped columns, reducing top-level columns by 56%, while retaining all four real device entries and raw diagnostics in four expandable details sections.
- Keyboard acceptance: focused View device schedule, pressed Enter, and observed an open native dialog with focus inside and four loaded entries. Delete selected was disabled before selection. Escape closed the dialog and returned focus to the launcher button.
- Desktop at 1512px: dialog content width 1120px, table client/scroll widths both 1064px. No table clipping or horizontal scrolling was required.
- Narrow-window acceptance: requested 390px, but this Chrome window enforces a 500px minimum. At the actual 500px viewport, page scroll width was 500px, dialog width 476px, and table client/scroll widths both 440px. All four entries remained available as stacked rows, with all four diagnostic disclosures initially closed. This run does not establish a real 390px viewport result.
- Device timezone uncertainty remained visible. Checks only opened/read the schedule and exercised selection/dismissal, without playback, reboot, upload, or deletion operations.
- Automated regression suite: 82 passed, zero failed. Production build passed. These measurements establish reduced information density and successful keyboard/responsive inspection, not a measured human usability preference.
