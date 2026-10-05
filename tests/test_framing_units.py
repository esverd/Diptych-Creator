import io
import math

import pytest
from PIL import Image, ImageDraw

import app as app_module
from diptych_creator import create_diptych, process_source_image


@pytest.fixture
def image_store(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, 'UPLOAD_DIR', str(tmp_path))
    source = Image.new('RGB', (300, 100))
    draw = ImageDraw.Draw(source)
    for x, color in [(0, 'red'), (100, 'green'), (200, 'blue')]:
        draw.rectangle((x, 0, x + 99, 99), fill=color)
    source.save(tmp_path / 'stripes.png')
    return tmp_path


def test_physical_lengths_scale_with_preview_dpi():
    config = {'width': 6, 'height': 4, 'dpi': 300, 'gap_inches': 0.1, 'outer_border_inches': 0.2}
    final, dims, _, border, gap = app_module.normalize_config(config)
    preview, small_dims, _, small_border, small_gap = app_module.normalize_config(config, dpi_cap=150)
    assert dims == (1800, 1200) and small_dims == (900, 600)
    assert (border, gap) == (60, 30)
    assert (small_border, small_gap) == (30, 15)
    assert final['width'] == preview['width'] == 6


def test_legacy_pixel_lengths_scale_only_at_preview_cap():
    config = {'width': 6, 'height': 4, 'dpi': 600, 'gap': 80, 'outer_border': 40}
    assert app_module.normalize_config(config)[3:] == (40, 80)
    assert app_module.normalize_config(config, dpi_cap=150)[3:] == (10, 20)


@pytest.mark.parametrize('field,value', [('gap_inches', -1), ('outer_border_inches', math.inf), ('width', math.nan)])
def test_invalid_physical_lengths_rejected(field, value):
    with pytest.raises(ValueError):
        app_module.normalize_config({'width': 6, 'height': 4, 'dpi': 300, field: value})


def test_independent_zoom_and_position_match_preview_and_export(image_store):
    left = {'path': 'stripes.png', 'auto_rotate': False, 'fit_mode': 'fill', 'zoom': 2, 'crop_focus': [0, 0.5]}
    right = {**left, 'crop_focus': [1, 0.5]}
    config = {'width': 2, 'height': 1, 'dpi': 300, 'gap_inches': 0.1, 'outer_border_inches': 0.1, 'fit_mode': 'fit'}
    preview = app_module.render_diptych_preview({'image1': left, 'image2': right, 'config': config})
    image1, image2 = map(app_module.resolve_uploaded_image, [left, right])
    normalized, dimensions, _, border, gap = app_module.normalize_config(config)
    output = image_store / 'output.jpg'
    create_diptych(image1, image2, str(output), dimensions, gap, normalized['fit_mode'], 300, border,
                   crop_focus1=image1['crop_focus'], crop_focus2=image2['crop_focus'])
    with Image.open(output) as final:
        assert final.size == (600, 300) and preview.size == (300, 150)
        for canvas in [preview, final]:
            left_pixel = canvas.getpixel((canvas.width // 4, canvas.height // 2))
            right_pixel = canvas.getpixel((3 * canvas.width // 4, canvas.height // 2))
            assert left_pixel[0] > 240 and left_pixel[2] < 15
            assert right_pixel[2] > 240 and right_pixel[0] < 15


def test_fit_resize_and_alignment_preserve_whole_photo(image_store):
    frame = process_source_image(str(image_store / 'stripes.png'), (200, 100), fit_mode='fit', auto_rotate=False,
                                 crop_focus=(1, 1), is_landscape_diptych=True, zoom=0.5)
    assert frame.size == (100, 100)
    assert frame.getpixel((10, 10)) == (255, 255, 255)
    assert frame.getpixel((53, 95))[0] > 240  # red end is retained
    assert frame.getpixel((95, 95))[2] > 240  # blue end is retained


def test_manual_clockwise_rotation_is_not_undone(image_store):
    frame = process_source_image(str(image_store / 'stripes.png'), (200, 100), rotation_override=90,
                                 fit_mode='fit', auto_rotate=False, is_landscape_diptych=True)
    assert frame.getpixel((50, 10))[0] > 240
    assert frame.getpixel((50, 90))[2] > 240


@pytest.mark.parametrize('adjustment', [{'zoom': 0}, {'zoom': 5}, {'zoom': math.nan}, {'crop_focus': [2, 0]}, {'crop_focus': [0]}, {'fit_mode': 'unknown'}])
def test_invalid_image_adjustments_rejected(image_store, adjustment):
    with pytest.raises(ValueError):
        app_module.resolve_uploaded_image({'path': 'stripes.png', **adjustment})


def test_framing_source_normalizes_exif_and_bounds_size(image_store):
    source = Image.new('RGB', (1800, 900), 'red')
    exif = source.getexif()
    exif[274] = 6
    source.save(image_store / 'rotated.jpg', exif=exif)
    response = app_module.app.test_client().get('/framing_source/rotated.jpg')
    assert response.status_code == 200
    with Image.open(io.BytesIO(response.data)) as image:
        assert image.size == (800, 1600)
    assert app_module.app.test_client().get('/framing_source/missing.jpg').status_code == 404
