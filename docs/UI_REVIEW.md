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

Final browser check after push: invalid Custom width + Download All displayed "Correct the custom width and height before downloading" and focused the width field; corrected to 6 inches and restored preset. Updated after-invalid-dimensions.jpg captures this export guard. Browser viewport override reset; editor left open for inspection.

## Iteration 2: sizing and image framing (2026-10-05)

Recorded before implementation:

| ID | Evidence / usability problem | Intended improvement | Status |
| --- | --- | --- | --- |
| UI-15 | Output/custom dimensions use inches; spacing and border use pixels. DPI changes alter physical border widths; no coherent conversion or pixel output summary. before-crop-controls.jpg. | One unit preference (mm / inches / pixels) controls all lengths, converts values without changing composition, and shows export pixels/DPI separately. Physical spacing scales with DPI and preview. | Recorded |
| UI-16 | Shared horizontal/vertical crop focus dropdowns move both images. No independent zoom, interactive positioning or safe cancel/reset. | Per-photo framing dialog: live frame, drag image, zoom, position controls, rotate, reset, Apply/Cancel; each photo retains independent adjustments in preview/export. | Recorded |
| UI-17 | Source processing auto-rotates even manual rotations; Fit mode auto-rotates despite documentation. User cannot reliably predict orientation. | Explicit per-photo orientation; new UI photos never rotate automatically; maintain legacy API defaults. | Recorded |
| UI-18 | Size/custom drafts and orientation are indirect: custom fields don't represent portrait output width/height. Changing units or DPI could discard invalid drafts. | Always-visible output width/height in selected units, directly representing final orientation. Validate and preserve draft, output summary, readable preset names, clear DPI consequences. | Recorded |
| UI-19 | Preview scales output DPI down but leaves pixel gaps/borders unchanged. Preview may disagree with final printed composition. | Scale legacy pixel spacing at preview DPI cap and support physical spacing consistently in both paths; verify preview/export geometry. | Recorded |

- UI-20 (recorded during iteration-2 verification): the added measurement/framing controls make the right panel taller and push tray navigation off screen; modal select inherits flex-grow and becomes oversized. Fix: keep desktop workspace and pair tray in the viewport, independently scroll the settings/library, and give modal form controls a fixed height.
- UI-21 (recorded during iteration-2 verification): clicking an already-placed photo still asks for a library selection, while the adjustment button can be below the fold in the settings panel. Fix: click a placed photo directly to frame it; selecting a library image still makes the click replace that slot. Make canvas instructions/accessible names match the current action.

### Iteration-2 implementation and verification

UI-15 through UI-21 implemented; mobile remains deferred.

- A single saved unit preference converts all editable lengths. Canonical dimensions/spacing remain physical values; exported pixels are identified separately. Verified mm → inches → pixels → mm conversion without a composition change. 152.4 × 101.6 mm at 300 DPI is 1800 × 1200 pixels; physical-mode 600 DPI doubles those pixels and retains 3 mm spacing. Pixel-mode DPI changes retain pixel dimensions/spacing and change print size. Blank dimensions prevent unit switching and export rather than discarding the draft.
- Width and height now show final orientation directly. Units also appear in accessible names for output dimensions, spacing and border. Pixel summary no longer repeats itself.
- Photo framing is independent: Fill zoom 100–400%; Fit size 10–100%; horizontal/vertical positioning; mouse dragging, arrow-key movement (Shift for larger steps), clockwise rotation, reset, Apply and Cancel. Controls that cannot move a photo at the current scale are disabled. New UI photos never auto-rotate. Shared crop dropdowns removed.
- Cancel at 400%/edge position reopened at the unchanged 100%/center. Drag moved horizontal position to 33%; ArrowLeft moved to 34% (the photo itself moves left). Apply updated only photo 1. Photo 2 independently used Fit at 91%; rotation/reset and alignment were exercised. Click on a placed canvas photo opens the same dialog directly; selecting a library photo changes the click to replacement.
- Live draft previews use a bounded, EXIF-corrected source and third guides; preview/export use each photo's own mode, zoom, rotation and position. Final browser ZIP exported 250% crop on photo 1 and 91% Fit on photo 2; visually inspected the downloaded JPEG against the canvas and dialog. Evidence: framing-crop-editor.jpg, framing-fit-editor.jpg, units-framing-workspace.jpg, units-framing-export.jpg.
- Export at 300 DPI with 3 mm spacing and 5 mm outer border produced 1800 × 1200 pixels with 300 DPI metadata; sampled the white border/gap and the fitted photo's padding. Legacy pixel spacing now scales when preview resolution is capped, and physical spacing scales at both preview/export resolutions.
- Desktop workspace keeps header/tray visible, independently scrolls side panels and sizes the canvas to actual available height (including feedback banners). Requested 1024 × 768 maps to 1138 × 853 CSS pixels under the host's display scaling. The page matched that viewport; canvas bottom 643px and tray bottom 853px remained visible. Evidence: units-laptop-workspace.jpg.
- Automated verification: 49 pytest tests passed; measurement conversion/validation assertions passed for inches/mm/pixels across 72/150/300/600 DPI; JS syntax checks passed. New tests cover physical/legacy preview scaling, independent crop/zoom preview versus export, fitted resizing/positioning, manual rotation, invalid adjustments, and EXIF-correct source loading.

### Next exploration

- UI-22 (recorded, not yet fixed): Auto Pair replaces manually curated pairs and framing with no undo. Placement/removal/deletion also lack recovery. Investigate preserving per-photo adjustments through auto-pair and a practical Undo/Redo workflow before considering the broader UX iteration complete.

- UI-23 (recorded before fixing): deleting a pair before the active pair changes the active composition; tray reorder leaves the composition heading stale. Preserve active identity on deletion and refresh the heading after reorder.


### Iteration 3: edit recovery (2026-10-05)

UI-22 and UI-23 implemented. Evidence: before-pair-recovery.jpg shows the previous Auto Pair result resetting photos to 100%; after-pair-framing-preserved.jpg shows 400% framing retained; undo-laptop-workspace.jpg shows recovery controls at laptop size.

- Undo/Redo recovers up to 50 composition edits: placement/moving, removal, rotation, photo framing, size presets, typed layout settings, orientation, adding/deleting/reordering pairs and Auto Pair. Consecutive changes to a focused numeric/color input form one edit. Navigation and unit display changes are not edits; uploads remain in the library when earlier composition edits are undone. History lasts for the current page session.
- Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo outside text/form controls. Native input editing keeps its own shortcuts. Modal drafts and in-progress server jobs block composition history restoration.
- Auto Pair retains independent framing and the layout of an unchanged ordered pair. Newly formed pairs use the active layout. Undo restores the previous pairs and active pair together. New edits clear the redo branch.
- Browser verification: apply 400% crop, add empty pair, Auto Pair preserves crop; Undo restores Pair 2 of 2, Redo rebuilds; remove photo then Undo restores 400% crop; rotation after Undo clears Redo; Ctrl+Z restores rotation. Three-pair deletion test kept the middle portrait composition active after deleting pair 1, then Undo restored all three.
- Laptop requested 1024�768 (1138�853 CSS pixels under host scaling): page width equals viewport; Undo, Redo, Auto Pair and Download All remain visible. Screenshot visually inspected.
- Automated checks: 49 Python tests passed; measurement checks passed; history checks cover coalescing, immutable snapshots, no-ops, bounded history, redo invalidation, per-photo framing preservation, unchanged-pair layout and odd-image pairing. JavaScript syntax and git whitespace checks passed.
