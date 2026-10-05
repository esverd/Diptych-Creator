# Diptych Creator

Local Flask app for arranging uploaded images into diptych layouts and exporting JPEG or ZIP output.

## Setup

Use Python 3.12 or newer. The dependency ranges in `requirements.txt` support the Python 3.14 runtime on this machine.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt pytest
```

## Run Locally

```powershell
.\.venv\Scripts\python app.py
```

Then open `http://127.0.0.1:5000`.

For the desktop-style launcher that opens the browser automatically:

```powershell
.\.venv\Scripts\python start.py
```

## Validate

Python tests:

```powershell
.\.venv\Scripts\python -m pytest -q
```

JavaScript syntax:

```powershell
node --check review_app/static/js/app.js
```

If Node is not on PATH in Codex, use the bundled Node runtime shown by the workspace dependency loader.

## Docker

The container runs `app.py` directly and binds to `0.0.0.0:5000`.

```powershell
docker build -t diptych-creator .
docker run --rm -p 5000:5000 diptych-creator
```

## Sizing and photo framing

Choose **Units for all lengths** to work in millimeters, inches, or pixels. Output width/height, photo spacing, and outer border use the same unit. Changing the unit converts the controls without changing the composition. In physical units, DPI changes export pixel resolution while print size and spacing stay fixed. In pixels, DPI changes print size while pixel dimensions stay fixed.

Click a placed photo (or its **Crop, position & resize** button) to adjust it independently. **Fill frame** supports zooming and cropping; **Fit whole photo** keeps the full photo and allows reducing its size. Drag to position, use arrow keys for finer movements, rotate clockwise, or reset the framing. **Cancel** discards the draft; **Apply adjustments** uses the result in preview and export. Photos keep their original orientation unless explicitly rotated.


Composition edits support Undo/Redo for the current page session (up to 50 edits). Use the toolbar or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z outside form fields. Auto Pair preserves each photo's framing; Undo restores the previous arrangement. Uploaded photos remain available when edits are undone.

The photo library supports filename search and All/Available/Placed filters. Placed photos link to their pair. Select a photo to show explicit slot actions, and cancel with Escape or Cancel. Swap photos reverses a pair while retaining each photo's adjustments.


## Saved workspace

The editor automatically saves photo references, pairs, individual framing, layout settings, active pair and library search/filter in this browser. Reopen the same address in the same browser to resume. Undo history remains limited to the current page session. The saved indicator reports browser storage failures rather than claiming that changes were saved.

Uploaded originals in `.cache/uploads` now remain across normal app restarts; transient thumbnails are regenerated when needed. **New workspace** keeps one recoverable previous workspace. Restore it from the welcome screen or use **Previous workspace** in the editor to switch between the two. Starting another new workspace replaces that previous snapshot. Photo files remain cached locally.

If a cached original is removed, the library marks it missing. Use **Relink photo** to choose a replacement while keeping its rotation, cropping and size. Missing photos block export and Auto Pair until recovered. Keep the original photos separately; browser storage and cached uploads are local working copies.

For an explicit cache reset, launch with `DIPTYCH_CLEAN_CACHE=1`. That removes cached photo files; saved browser workspaces will require relinking. Leave it unset for normal recovery. Docker recovery also requires persisting the `/app/.cache` directory across container replacement.
