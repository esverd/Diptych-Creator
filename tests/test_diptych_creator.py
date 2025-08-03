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
from app import app, get_capture_time, UPLOAD_TIMES, UPLOAD_DIR
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


def test_fit_mode_background_color(tmp_path):
    path = tmp_path / "img.jpg"
    Image.new('RGB', (10, 10), 'blue').save(path)
    result = process_source_image(
        str(path),
        (40, 40),
        rotation_override=0,
        fit_mode='fit',
        auto_rotate=False,
        background_color='#ff0000',
    )
    assert result.getpixel((0, 0)) == (255, 0, 0)


def test_auto_group_chronological(tmp_path):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    img1 = os.path.join(UPLOAD_DIR, 'old.jpg')
    img2 = os.path.join(UPLOAD_DIR, 'mid.jpg')
    img3 = os.path.join(UPLOAD_DIR, 'new.jpg')
    Image.new('RGB', (10, 10), 'red').save(img1)
    Image.new('RGB', (10, 10), 'green').save(img2)
    Image.new('RGB', (10, 10), 'blue').save(img3)
    t1 = datetime(2020, 1, 1).timestamp()
    t2 = datetime(2020, 1, 2).timestamp()
    t3 = datetime(2020, 1, 3).timestamp()
    os.utime(img1, (t1, t1))
    os.utime(img2, (t2, t2))
    os.utime(img3, (t3, t3))

    with app.test_client() as client:
        resp = client.post('/auto_group', json={})
        assert resp.status_code == 200
        pairs = resp.get_json()['pairs']

    assert pairs[0] == ['old.jpg', 'mid.jpg']


def _save_oriented(img, orientation, path):
    """Helper to save an image with a given EXIF orientation."""
    from diptych_creator import ORIENTATION_TAG
    exif = Image.Exif()
    if ORIENTATION_TAG:
        exif[ORIENTATION_TAG] = orientation
    img.save(path, format="TIFF", exif=exif)


def test_exif_orientation_mirrored(tmp_path):
    """verify mirrored EXIF orientations are handled correctly"""
    from diptych_creator import apply_exif_orientation

    # Orientation 2 - horizontal mirror
    img = Image.new('RGB', (2, 1))
    img.putpixel((0, 0), (1, 2, 3))
    img.putpixel((1, 0), (4, 5, 6))
    path = tmp_path / 'ori2.jpg'
    _save_oriented(img, 2, path)
    with Image.open(path) as im:
        out = apply_exif_orientation(im)
        assert out.getpixel((0, 0)) == (4, 5, 6)

    # Orientation 4 - vertical mirror
    img = Image.new('RGB', (1, 2))
    img.putpixel((0, 0), (10, 20, 30))
    img.putpixel((0, 1), (40, 50, 60))
    path = tmp_path / 'ori4.jpg'
    _save_oriented(img, 4, path)
    with Image.open(path) as im:
        out = apply_exif_orientation(im)
        assert out.getpixel((0, 0)) == (40, 50, 60)

    # Orientation 5 - horizontal mirror then rotate 90 CCW
    img = Image.new('RGB', (2, 3))
    colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0), (255, 0, 255), (0, 255, 255)]
    for idx, col in enumerate(colors):
        img.putpixel((idx % 2, idx // 2), col)
    expected = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT).transpose(Image.Transpose.ROTATE_90)
    path = tmp_path / 'ori5.jpg'
    _save_oriented(img, 5, path)
    with Image.open(path) as im:
        out = apply_exif_orientation(im)
        assert list(out.getdata()) == list(expected.getdata())

    # Orientation 7 - horizontal mirror then rotate 90 CW
    expected = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT).transpose(Image.Transpose.ROTATE_270)
    path = tmp_path / 'ori7.jpg'
    _save_oriented(img, 7, path)
    with Image.open(path) as im:
        out = apply_exif_orientation(im)
        assert list(out.getdata()) == list(expected.getdata())


