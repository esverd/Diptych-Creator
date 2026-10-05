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
