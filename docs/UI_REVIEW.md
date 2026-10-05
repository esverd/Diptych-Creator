# UI assessment and improvement log

Assessment date: 2026-10-05. Latest origin/main pulled before assessment.

Evidence uses synthetic landscape, portrait, square and corrupt JPEG files (no personal photos). Screenshots are in docs/ui-review. Each finding is recorded before implementation; verification will be appended after fixes.

| ID | Finding / reproduction | Planned fix | Status |
| --- | --- | --- | --- |
| UI-01 | Upload only a corrupt JPEG on welcome: no visible error; next successful upload still shows stale error. before-invalid-upload.jpg, before-editor.jpg. | Make status and loading visible during onboarding; actionable upload message; clear stale feedback on retry. | Recorded |
| UI-02 | At 850px the two 288px sidebars leave a tiny canvas. before-editor.jpg. | Responsive workspace with narrower desktop library, full-width canvas and mobile views below 1100px. | Recorded |
| UI-03 | Empty canvas appears as an unexplained white rectangle; thumbnails require dragging, preventing reliable keyboard/touch placement. | Labeled slots, click/tap image selection then slot placement, keyboard controls and selected feedback. | Recorded |
| UI-04 | Mobile menu opens both panels at once; panel offsets assume a fixed header height. | Explicit Preview / Images / Settings views in normal document flow, consistent selection and Escape return. | Recorded |
| UI-05 | Tray has unlabeled non-keyboard div controls, tiny delete targets, no pair context; arrows scroll a non-scrolling parent. | Semantic controls, active state, pair labels, larger targets, scroll the actual tray. | Recorded |
| UI-06 | Advanced options have no disclosure cue; number/color fields inherit select arrows; custom values silently default or reset during editing. | Clear disclosure, input-specific styling, validate dimensions inline while preserving drafts. | Recorded |
| UI-07 | Welcome lacks workflow explanation; editor lacks hierarchy and output summary. | Consistent visual system, onboarding guidance, workspace title and live output dimensions. | Recorded |

## Verification checklist

- Invalid-only and mixed uploads: visible feedback and retry.
- Desktop, medium, phone: no horizontal page overflow; all views reachable.
- Click and keyboard placement; replacement/move; remove and rotate.
- Empty/new pair, switching, delete, tray scroll; odd auto-pair.
- Custom blank/negative dimensions and recovery; portrait/square; advanced settings.
- Export and preview failure feedback; successful ZIP download.
- Existing automated checks; screenshots before and after.

## Findings during verification

- UI-08 (recorded before fix): empty tray previews have no orientation class and collapse to almost zero size. Selecting an image leaves stale selection text after placement. Fix: always size tray cards, show an Empty label, reset placement hint.
- UI-09 (recorded before fix): preview errors only appear in the console. Fix: display a retry instruction in the status banner.
- Scope update: user prioritizes desktop/laptop; phone-specific assessment is deferred. Main verification widths: 1440, 1280, 1024.
- UI-10 (recorded before fix): selecting Custom immediately snaps back to a preset because rendering derives the selector from unchanged dimensions. Fix: preserve explicit custom mode during edits, while switching pairs still restores the appropriate preset.
- UI-11 (recorded before fix): portrait canvas can grow taller than a laptop viewport, pushing pair navigation below the fold. Fix: constrain canvas width using its aspect ratio and available viewport height; maintain correct preview proportions.
- UI-12 (recorded before fix): adding an empty pair leaves the prior composition visible until another action requests a preview; portrait drop targets remain side by side although output images are stacked. Fix: refresh on pair creation and orient the slot grid with the composition.
- UI-13 (recorded before fix): after refreshing and uploading three images, Auto Pair creates five pairs including prior-session cache files, which are absent from the visible library. Fix: send the current library filenames and restrict grouping to that set; retain old API behavior when filenames are omitted. Regression test covers isolation and odd leftovers.
- UI-14 (recorded before fix): invalid custom drafts preserve the last valid config for preview, so export could silently use those previous values. Fix: block export with a clear correction message until the visible draft is valid.

## Implemented fixes and verification (2026-10-05)

UI-01 through UI-03 and UI-05 through UI-14 are implemented. UI-04 has a minimal fallback navigation repair; further mobile polish is deferred at the user's request.

- UI-01: corrupt-only upload now shows supported-format guidance above welcome. A valid retry clears the old message. Evidence: after-invalid-upload.jpg.
- UI-02 / UI-07 / UI-11: balanced sidebars, restrained colors, clear composition heading/output summary, bounded portrait canvas. Evidence: after-desktop.jpg, after-laptop-1024.jpg, after-laptop-portrait.jpg. Browser viewport override uses the host display scale: requested 1024 produced 1138 CSS pixels, requested 1280 produced 1422 CSS pixels. DOM checks reported no horizontal overflow at those effective widths.
- UI-03 / UI-12: Enter activated both thumbnail and target; click placement, moving a placed image, replacing a slot, removal and restoration worked. Portrait targets follow stacked composition. Empty pair clears preview after the normal preview debounce. Evidence: after-empty-pair.jpg.
- UI-05 / UI-08: pair editing/add/delete use native buttons and active state; final remaining pair cannot be deleted. Empty cards remain sized. Fourteen-card tray scrolled horizontally via right arrow (scrollLeft 692, scrollWidth 2116, clientWidth 1423).
- UI-06 / UI-10 / UI-14: Custom stays open; blank and negative dimensions remain editable with inline errors; 7.2 × 5.2 recovers. Export guards invalid visible drafts. Evidence: after-invalid-dimensions.jpg. Advanced disclosure renders + / -; number and color inputs have no select arrows.
- UI-09: temporarily moved a synthetic uploaded JPEG aside; changing fit caused a visible preview failure with retry guidance. Restored the JPEG, changed fit again and preview recovered. Evidence: after-preview-error.jpg.
- UI-13: three visible images now produce two pairs despite other cached files; isolated backend regression confirms current-library filtering and rejects malformed filename lists.
- Square disables orientation; rotation, portrait, crop/fill, fit and expanded options were exercised.
- ZIP export completed through the browser to Downloads/diptych_results.zip.
- Automated verification: 34 pytest tests passed; JavaScript syntax passed; git diff --check passed. Two pre-existing Pillow getdata deprecation warnings remain.

## Future assessment notes

Screenshots use synthetic blocks to make layout and state transitions obvious. A later reviewer should repeat with a larger collection of real photos, long filenames and mixed photographic subjects to evaluate crop decisions and library scanning. Phone-specific polish remains deferred. The app continues to load its existing Tailwind/Sortable/font dependencies from CDNs.
