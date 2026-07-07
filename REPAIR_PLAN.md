# Diptych Creator Repair Summary

Investigation started: 2026-07-06
Implementation status: completed repair pass

## Current Validation Baseline

- `.\.venv\Scripts\python -m pytest -q`: 33 passed.
- `.\.venv\Scripts\python -m compileall -q .`: passed.
- Bundled Node `--check review_app\static\js\app.js`: passed.
- Browser UAT load at `http://127.0.0.1:5010`: page rendered with no console errors.
- HTTP workflow UAT against the running app: upload, thumbnail polling, auto-grouping, preview rendering, single-image output, portrait output, finalize, download IDs, and unsafe download blocking all passed.
- Detailed config-matrix UAT against the running app: uploaded PNG, JPEG, WebP, transparent PNG, and invalid JPEG fixtures, then verified landscape/fill, portrait/fit, square/fill, crop-focus left/right, transparent/fit, DPI metadata, output dimensions, sampled border/gap/cell colors, and unique output directories.

## Implemented Repairs

1. Fixed the app-blocking JavaScript parse error.
2. Added JavaScript syntax validation through `package.json`.
3. Centralized preview rendering so sync and async preview use the same backend path.
4. Fixed portrait final-generation sizing so already-final dimensions are not re-swapped.
5. Added server-side config validation for dimensions, DPI, orientation, fit mode, color, spacing, and border.
6. Made final generation validate pairs server-side and support one-image outputs.
7. Made `create_diptych` raise/report failures instead of silently returning without an output.
8. Added per-generation job IDs while preserving existing progress endpoint compatibility.
9. Added download IDs and a `commonpath`-based output path guard.
10. Removed destructive cache deletion and background thread startup from module import.
11. Added explicit startup services for local app execution.
12. Aligned browser/backend upload formats around Pillow-supported formats: JPEG, PNG, WebP, TIFF.
13. Removed unsupported HEIC/HEIF acceptance from backend validation.
14. Fixed thumbnail generation for alpha/non-RGB images and normalized thumbnail cache files to JPEG.
15. Changed spacing/border UI labels to pixels to match the backend unit model.
16. Added inline status messages for upload, auto-pair, generation, and download failures.
17. Reduced stale preview risk with request sequencing and tray preview URL revocation.
18. Updated local/Docker startup behavior so Docker runs `app.py` directly on `0.0.0.0`.
19. Updated dependency ranges so Pillow installs on Python 3.14.
20. Added setup, run, Docker, and validation documentation.
21. Removed the unused `diptych-creator-uat.tar` artifact from the source tree.
22. Made generation output directories unique per job to prevent same-second runs from overwriting prior outputs.
23. Flattened transparent thumbnail pixels against white so JPEG thumbnails do not inherit arbitrary hidden RGB values.

## Regression Coverage Added

- Alpha PNG thumbnail conversion.
- Invalid preview dimension rejection.
- Single-image final generation.
- Portrait final output dimensions.
- Same-second generation jobs do not overwrite each other's output.
- Config matrix coverage for landscape/fill, portrait/fit, square/fill, crop focus, single-image layout, transparent fit compositing, borders, gaps, DPI, and sampled cell colors.
- WebP upload and invalid image rejection.
- Download path guard behavior.

## Follow-Up Notes

- The test suite has two Pillow deprecation warnings in `tests/test_preview.py` for `Image.Image.getdata`; this does not fail now, but should be updated before Pillow 14.
