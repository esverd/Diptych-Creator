import os
import sys
import pytest
from PIL import Image
from PIL import ImageDraw

# Ensure the project root is on the path when tests are executed from the
# tests directory.
PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from diptych_creator import create_diptych_canvas, process_source_image, create_diptych
from app import app, get_capture_time, UPLOAD_TIMES, UPLOAD_DIR
from datetime import datetime
import random
from unittest.mock import patch

def cell_size(final_dims, gap, outer=0, both=True):
    w, h = final_dims
    landscape = w >= h
    inner_w = w - 2 * outer
    inner_h = h - 2 * outer
    effective_gap = gap if both else 0
    if landscape:
        return ( (inner_w - effective_gap) // 2, inner_h )
    else:
        return ( inner_w, (inner_h - effective_gap) // 2 )

def make_img(w=50, h=50, color='white'):
    return Image.new('RGB', (w, h), color)


def clear_upload_dir():
    if os.path.exists(UPLOAD_DIR):
        for f in os.listdir(UPLOAD_DIR):
            path = os.path.join(UPLOAD_DIR, f)
            if os.path.isfile(path):
                os.remove(path)

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


def test_square_treated_as_landscape():
    cell_w, cell_h = cell_size((100, 100), 10, both=True)
    img1 = make_img(cell_w, cell_h, 'red')
    img2 = make_img(cell_w, cell_h, 'blue')
    canvas = create_diptych_canvas(img1, img2, (100, 100), gap_px=10)
    # left sample should be red
    assert canvas.getpixel((cell_w // 2, cell_h // 2)) == (255, 0, 0)
    # right sample should be blue
    assert canvas.getpixel((100 - cell_w // 2 - 1, cell_h // 2)) == (0, 0, 255)


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
    clear_upload_dir()
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    for f in os.listdir(UPLOAD_DIR):
        os.remove(os.path.join(UPLOAD_DIR, f))
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
    clear_upload_dir()


def test_auto_group_aspect_ratio(tmp_path):
    clear_upload_dir()
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    img1 = os.path.join(UPLOAD_DIR, 'square1.jpg')
    img2 = os.path.join(UPLOAD_DIR, 'square2.jpg')
    img3 = os.path.join(UPLOAD_DIR, 'wide1.jpg')
    img4 = os.path.join(UPLOAD_DIR, 'wide2.jpg')
    Image.new('RGB', (100, 100), 'red').save(img1)
    Image.new('RGB', (110, 100), 'red').save(img2)
    Image.new('RGB', (200, 100), 'red').save(img3)
    Image.new('RGB', (210, 100), 'red').save(img4)
    with app.test_client() as client:
        resp = client.post('/auto_group', json={'method': 'aspect_ratio'})
        assert resp.status_code == 200
        pairs = resp.get_json()['pairs']
    assert pairs[0] == ['square1.jpg', 'square2.jpg']
    assert pairs[1] == ['wide1.jpg', 'wide2.jpg']
    clear_upload_dir()


def test_auto_group_dominant_color(tmp_path):
    clear_upload_dir()
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    r1 = os.path.join(UPLOAD_DIR, 'r1.jpg')
    r2 = os.path.join(UPLOAD_DIR, 'r2.jpg')
    b1 = os.path.join(UPLOAD_DIR, 'b1.jpg')
    b2 = os.path.join(UPLOAD_DIR, 'b2.jpg')
    Image.new('RGB', (10, 10), 'red').save(r1)
    Image.new('RGB', (10, 10), 'red').save(r2)
    Image.new('RGB', (10, 10), 'blue').save(b1)
    Image.new('RGB', (10, 10), 'blue').save(b2)
    with app.test_client() as client:
        resp = client.post('/auto_group', json={'method': 'dominant_color'})
        assert resp.status_code == 200
        pairs = resp.get_json()['pairs']
    pair_sets = [set(p) for p in pairs]
    assert set(['r1.jpg', 'r2.jpg']) in pair_sets
    assert set(['b1.jpg', 'b2.jpg']) in pair_sets
    clear_upload_dir()


def test_auto_group_random(tmp_path):
    clear_upload_dir()
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    names = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']
    for name in names:
        Image.new('RGB', (10, 10), 'white').save(os.path.join(UPLOAD_DIR, name))
    random.seed(0)
    with app.test_client() as client, patch('app.os.listdir', return_value=names):
        resp = client.post('/auto_group', json={'method': 'random'})
        assert resp.status_code == 200
        pairs = resp.get_json()['pairs']
    assert pairs == [['c.jpg', 'a.jpg'], ['b.jpg', 'd.jpg']]
    clear_upload_dir()


def test_preserve_exif_metadata(tmp_path):
    img1 = tmp_path / "left.jpg"
    img2 = tmp_path / "right.jpg"
    im1 = Image.new('RGB', (10, 10), 'white')
    exif = im1.getexif()
    exif[271] = 'UnitTest'  # Make
    exif[272] = 'UTModel'   # Model
    exif[306] = '2020:01:01 10:00:00'  # DateTime
    im1.save(img1, exif=exif)
    Image.new('RGB', (10, 10), 'black').save(img2)
    out = tmp_path / "out.jpg"
    create_diptych(
        {'path': str(img1)},
        {'path': str(img2)},
        str(out),
        (20, 10),
        0,
        'fill',
        72,
        preserve_exif=True,
    )
    with Image.open(out) as result:
        exif_res = result.getexif()
        assert exif_res.get(271) == 'UnitTest'
        assert exif_res.get(272) == 'UTModel'
        assert exif_res.get(306) == '2020:01:01 10:00:00'



from PIL import ImageDraw


def test_process_source_image_crop_focus(tmp_path):
    path = tmp_path / "two_colors.jpg"
    img = Image.new('RGB', (10, 40))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, 9, 19], fill='red')
    draw.rectangle([0, 20, 9, 39], fill='blue')
    img.save(path)

    top = process_source_image(
        str(path),
        (20, 40),
        fit_mode='fill',
        auto_rotate=False,
        crop_focus=(0.5, 0.0),
    )
    bottom = process_source_image(
        str(path),
        (20, 40),
        fit_mode='fill',
        auto_rotate=False,
        crop_focus=(0.5, 1.0),
    )
    r, g, b = top.getpixel((top.width // 2, top.height // 2))
    assert r > 200 and b < 50
    r, g, b = bottom.getpixel((bottom.width // 2, bottom.height // 2))
    assert b > 200 and r < 50


def test_create_diptych(tmp_path):
    img1 = tmp_path / "img1.jpg"
    img2 = tmp_path / "img2.jpg"
    Image.new('RGB', (10, 10), 'red').save(img1)
    Image.new('RGB', (10, 10), 'green').save(img2)
    output = tmp_path / "out.jpg"

    from diptych_creator import create_diptych

    create_diptych(
        {"path": str(img1)},
        {"path": str(img2)},
        str(output),
        (40, 20),
        gap_px=2,
        fit_mode='fit',
        dpi=72,
        border_color='#00ff00',
    )

    result = Image.open(output)
    assert result.size == (40, 20)
    r, g, b = result.getpixel((0, 0))
    assert abs(r - 0) < 10 and abs(g - 255) < 10 and b < 10


def test_auto_group_orientation(tmp_path):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    for f in os.listdir(UPLOAD_DIR):
        os.remove(os.path.join(UPLOAD_DIR, f))
    land1 = os.path.join(UPLOAD_DIR, 'land1.jpg')
    port1 = os.path.join(UPLOAD_DIR, 'port1.jpg')
    land2 = os.path.join(UPLOAD_DIR, 'land2.jpg')
    Image.new('RGB', (20, 10), 'red').save(land1)
    Image.new('RGB', (10, 20), 'blue').save(port1)
    Image.new('RGB', (20, 10), 'green').save(land2)
    t1 = datetime(2020, 1, 1).timestamp()
    t2 = datetime(2020, 1, 2).timestamp()
    t3 = datetime(2020, 1, 3).timestamp()
    os.utime(land1, (t1, t1))
    os.utime(port1, (t2, t2))
    os.utime(land2, (t3, t3))

    with app.test_client() as client:
        resp = client.post('/auto_group', json={'method': 'orientation'})
        assert resp.status_code == 200
        pairs = resp.get_json()['pairs']

    assert pairs[0] == ['land1.jpg', 'land2.jpg']
    assert pairs[1] == ['port1.jpg']

