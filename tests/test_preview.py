import os
import io
from PIL import Image

from app import app, UPLOAD_DIR
from diptych_creator import (
    calculate_pixel_dimensions,
    process_source_image,
    create_diptych_canvas,
)


def create_image(path, color):
    Image.new('RGB', (20, 20), color).save(path)


def test_preview_matches_final(tmp_path):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    img1_path = os.path.join(UPLOAD_DIR, 'a.jpg')
    img2_path = os.path.join(UPLOAD_DIR, 'b.jpg')
    create_image(img1_path, 'green')
    create_image(img2_path, 'blue')

    config = {
        'width': 4,
        'height': 3,
        'dpi': 10,
        'orientation': 'landscape',
        'gap': 2,
        'outer_border': 1,
        'border_color': '#ff0000',
        'fit_mode': 'fill'
    }

    diptych = {
        'config': config,
        'image1': {'path': img1_path},
        'image2': {'path': img2_path}
    }

    with app.test_client() as client:
        resp = client.post('/get_wysiwyg_preview', json={'diptych': diptych})
        assert resp.status_code == 200
        preview = Image.open(io.BytesIO(resp.data))

    final_dims = calculate_pixel_dimensions(config['width'], config['height'], config['dpi'])
    inner_w = final_dims[0] - 2 * config['outer_border']
    inner_h = final_dims[1] - 2 * config['outer_border']
    if config['orientation'] == 'portrait':
        processing = (inner_w, inner_h - config['gap'])
    else:
        processing = (inner_w - config['gap'], inner_h)

    img1 = process_source_image(img1_path, processing, 0, config['fit_mode'])
    img2 = process_source_image(img2_path, processing, 0, config['fit_mode'])
    final_canvas = create_diptych_canvas(
        img1,
        img2,
        final_dims,
        config['gap'],
        config['outer_border'],
        config['border_color']
    )
    buf = io.BytesIO()
    final_canvas.save(buf, format='JPEG', quality=90)
    buf.seek(0)
    final_jpeg = Image.open(buf)

    assert list(preview.getdata()) == list(final_jpeg.getdata())


def test_preview_missing_file(tmp_path):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    img1_path = os.path.join(UPLOAD_DIR, 'c.jpg')
    create_image(img1_path, 'red')

    config = {'width': 4, 'height': 3, 'dpi': 10}
    diptych = {
        'config': config,
        'image1': {'path': img1_path},
        'image2': {'path': 'missing.jpg'}
    }

    with app.test_client() as client:
        resp = client.post('/get_wysiwyg_preview', json={'diptych': diptych})
        assert resp.status_code == 404


def test_preview_fit_background_color(tmp_path):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    img1_path = os.path.join(UPLOAD_DIR, 'd.jpg')
    img2_path = os.path.join(UPLOAD_DIR, 'e.jpg')
    create_image(img1_path, 'yellow')
    create_image(img2_path, 'purple')

    config = {
        'width': 4,
        'height': 3,
        'dpi': 10,
        'orientation': 'landscape',
        'gap': 2,
        'outer_border': 1,
        'border_color': '#ff0000',
        'fit_mode': 'fit'
    }

    diptych = {
        'config': config,
        'image1': {'path': img1_path},
        'image2': {'path': img2_path}
    }

    with app.test_client() as client:
        resp = client.post('/get_wysiwyg_preview', json={'diptych': diptych})
        assert resp.status_code == 200
        preview = Image.open(io.BytesIO(resp.data))

    r, g, b = preview.getpixel((0, 0))
    assert r > 240 and g < 30 and b < 30

