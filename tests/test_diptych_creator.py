import os
import sys
import pytest
from PIL import Image

# Ensure the project root is on the path when tests are executed from the
# tests directory.
PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from diptych_creator import create_diptych_canvas, process_source_image
from app import get_capture_time, UPLOAD_TIMES
import app as flask_app
from datetime import datetime

def cell_size(final_dims, gap, outer=0, both=True):
    w, h = final_dims
    landscape = w > h
    inner_w = w - 2 * outer
    inner_h = h - 2 * outer
    effective_gap = gap if both else 0
    if landscape:
        return ( (inner_w - effective_gap) // 2, inner_h )
    else:
        return ( inner_w, (inner_h - effective_gap) // 2 )

def make_img(w=50, h=50, color='white'):
    return Image.new('RGB', (w, h), color)

def test_landscape_gap_used_when_both_images():
    cell_w, cell_h = cell_size((100, 50), 10, both=True)
    img1 = make_img(cell_w, cell_h)
    img2 = make_img(cell_w, cell_h)
    canvas = create_diptych_canvas(img1, img2, (100, 50), gap_px=10)
    assert canvas.size == (100, 50)

def test_landscape_no_gap_when_missing_image():
    cell_w, cell_h = cell_size((100, 50), 10, both=False)
    img1 = make_img(cell_w, cell_h)
    canvas = create_diptych_canvas(img1, None, (100, 50), gap_px=10)
    assert canvas.size == (100, 50)

def test_portrait_gap_used_when_both_images():
    cell_w, cell_h = cell_size((50, 100), 10, both=True)
    img1 = make_img(cell_w, cell_h)
    img2 = make_img(cell_w, cell_h)
    canvas = create_diptych_canvas(img1, img2, (50, 100), gap_px=10)
    assert canvas.size == (50, 100)

def test_portrait_no_gap_when_missing_image():
    cell_w, cell_h = cell_size((50, 100), 10, both=False)
    img = make_img(cell_w, cell_h)
    canvas = create_diptych_canvas(None, img, (50, 100), gap_px=10)
    assert canvas.size == (50, 100)


def test_auto_rotate_landscape_into_portrait_cell(tmp_path):
    path = tmp_path / "landscape.jpg"
    Image.new('RGB', (100, 50), 'blue').save(path)
    result = process_source_image(str(path), (100, 80))
    assert result.size == (50, 80)


def test_auto_rotate_portrait_into_landscape_cell(tmp_path):
    path = tmp_path / "portrait.jpg"
    Image.new('RGB', (50, 100), 'red').save(path)
    result = process_source_image(str(path), (80, 100))
    assert result.size == (80, 50)


def test_get_capture_time_falls_back_to_upload(tmp_path):
    path = tmp_path / "sample.jpg"
    Image.new('RGB', (10, 10), 'white').save(path)
    UPLOAD_TIMES['sample.jpg'] = datetime(2021, 1, 1, 12, 0, 0)
    try:
        ts = get_capture_time(str(path))
        assert ts == UPLOAD_TIMES['sample.jpg']
    finally:
        UPLOAD_TIMES.clear()

def test_auto_group_pairs_by_capture(tmp_path):
    old_dir = flask_app.UPLOAD_DIR
    flask_app.UPLOAD_DIR = str(tmp_path)
    os.makedirs(flask_app.UPLOAD_DIR, exist_ok=True)
    flask_app.UPLOAD_TIMES.clear()

    dt1 = datetime(2021, 1, 1, 12, 0, 0)
    dt2 = datetime(2021, 1, 1, 12, 0, 1)
    exif_tag = flask_app.DATE_TAGS[0]
    img = Image.new('RGB', (5, 5), 'white')
    exif = Image.Exif()
    exif[exif_tag] = dt1.strftime('%Y:%m:%d %H:%M:%S')
    img.save(os.path.join(flask_app.UPLOAD_DIR, 'a1.jpg'), exif=exif)
    exif = Image.Exif()
    exif[exif_tag] = dt2.strftime('%Y:%m:%d %H:%M:%S')
    img.save(os.path.join(flask_app.UPLOAD_DIR, 'a2.jpg'), exif=exif)

    Image.new('RGB', (5, 5), 'white').save(os.path.join(flask_app.UPLOAD_DIR, 'b1.jpg'))
    Image.new('RGB', (5, 5), 'white').save(os.path.join(flask_app.UPLOAD_DIR, 'b2.jpg'))
    flask_app.UPLOAD_TIMES['b1.jpg'] = datetime(2021, 1, 2, 12, 0, 0)
    flask_app.UPLOAD_TIMES['b2.jpg'] = datetime(2021, 1, 2, 12, 0, 1)

    client = flask_app.app.test_client()
    resp = client.post('/auto_group', json={'threshold': 2})
    data = resp.get_json()
    assert data['pairs'] == [['a1.jpg', 'a2.jpg'], ['b1.jpg', 'b2.jpg']]

    flask_app.UPLOAD_DIR = old_dir
    flask_app.UPLOAD_TIMES.clear()
