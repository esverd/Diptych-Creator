import io
import os
import time

from PIL import Image

from app import (
    OUTPUT_DIR_BASE,
    THUMB_CACHE_DIR,
    UPLOAD_DIR,
    app,
    create_single_thumbnail,
    is_safe_output_path,
    thumbnail_cache_name,
)


def clear_dir(path):
    os.makedirs(path, exist_ok=True)
    for name in os.listdir(path):
        full_path = os.path.join(path, name)
        if os.path.isfile(full_path):
            os.remove(full_path)


def create_image(path, size=(24, 24), color='white', mode='RGB'):
    Image.new(mode, size, color).save(path)


def test_thumbnail_handles_alpha_png():
    clear_dir(UPLOAD_DIR)
    clear_dir(THUMB_CACHE_DIR)
    source = os.path.join(UPLOAD_DIR, 'alpha.png')
    image = Image.new('RGBA', (24, 24), (255, 0, 0, 255))
    for x in range(12):
        for y in range(24):
            image.putpixel((x, y), (255, 0, 0, 0))
    image.save(source)

    create_single_thumbnail(source)

    thumb_path = os.path.join(THUMB_CACHE_DIR, thumbnail_cache_name('alpha.png'))
    assert os.path.exists(thumb_path)
    with Image.open(thumb_path) as thumb:
        assert thumb.format == 'JPEG'
        assert thumb.mode == 'RGB'
        assert thumb.getpixel((2, 12))[0] > 235
        assert thumb.getpixel((2, 12))[1] > 235
        assert thumb.getpixel((2, 12))[2] > 235


def test_preview_rejects_invalid_dimensions():
    clear_dir(UPLOAD_DIR)
    image_path = os.path.join(UPLOAD_DIR, 'tiny.jpg')
    create_image(image_path)
    diptych = {
        'image1': {'path': image_path},
        'config': {
            'width': 1,
            'height': 1,
            'dpi': 10,
            'outer_border': 20,
        },
    }

    with app.test_client() as client:
        response = client.post('/get_wysiwyg_preview', json={'diptych': diptych})

    assert response.status_code == 400
    assert 'Outer border' in response.get_json()['error']


def test_generate_supports_single_image_job():
    clear_dir(UPLOAD_DIR)
    source = os.path.join(UPLOAD_DIR, 'single.jpg')
    create_image(source, color='cyan')
    payload = {
        'pairs': [
            {
                'pair': [{'path': source}, None],
                'config': {'width': 4, 'height': 3, 'dpi': 10, 'fit_mode': 'fill'},
            }
        ],
        'zip': False,
    }

    with app.test_client() as client:
        start = client.post('/generate_diptychs', json=payload)
        assert start.status_code == 200
        job_id = start.get_json()['job_id']
        while True:
            progress = client.get(f'/get_generation_progress?job_id={job_id}').get_json()
            if progress['done']:
                break
            time.sleep(0.05)
        assert progress['error'] is None
        final = client.get(f'/finalize_download?job_id={job_id}').get_json()

    assert final['is_zip'] is False
    assert len(final['download_paths']) == 1
    assert len(final['download_ids']) == 1
    assert os.path.exists(final['download_paths'][0])


def test_generate_preserves_portrait_dimensions():
    clear_dir(UPLOAD_DIR)
    left = os.path.join(UPLOAD_DIR, 'portrait_left.jpg')
    right = os.path.join(UPLOAD_DIR, 'portrait_right.jpg')
    create_image(left, color='red')
    create_image(right, color='blue')
    payload = {
        'pairs': [
            {
                'pair': [{'path': left}, {'path': right}],
                'config': {
                    'width': 4,
                    'height': 3,
                    'dpi': 10,
                    'orientation': 'portrait',
                    'fit_mode': 'fill',
                },
            }
        ],
        'zip': False,
    }

    with app.test_client() as client:
        start = client.post('/generate_diptychs', json=payload)
        assert start.status_code == 200
        job_id = start.get_json()['job_id']
        while True:
            progress = client.get(f'/get_generation_progress?job_id={job_id}').get_json()
            if progress['done']:
                break
            time.sleep(0.05)
        final = client.get(f'/finalize_download?job_id={job_id}').get_json()

    with Image.open(final['download_paths'][0]) as result:
        assert result.size == (30, 40)


def test_upload_accepts_webp_and_rejects_fake_image():
    clear_dir(UPLOAD_DIR)
    valid = io.BytesIO()
    Image.new('RGB', (10, 10), 'blue').save(valid, format='WEBP')
    valid.seek(0)
    invalid = io.BytesIO(b'not really an image')

    with app.test_client() as client:
        response = client.post(
            '/upload_images',
            data={
                'files[]': [
                    (valid, 'sample.webp'),
                    (invalid, 'fake.jpg'),
                ]
            },
            content_type='multipart/form-data',
        )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['uploaded'] == ['sample.webp']
    assert payload['invalid'] == ['fake.jpg']


def test_download_path_guard_uses_commonpath():
    safe_path = os.path.join(OUTPUT_DIR_BASE, 'DiptychMaster_test', 'out.jpg')
    unsafe_prefix_match = os.path.abspath(OUTPUT_DIR_BASE) + '_else\\out.jpg'

    assert is_safe_output_path(safe_path)
    assert not is_safe_output_path(unsafe_prefix_match)
