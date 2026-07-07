import io
import os
import time

from PIL import Image

from app import UPLOAD_DIR, app


def clear_upload_dir():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    for name in os.listdir(UPLOAD_DIR):
        path = os.path.join(UPLOAD_DIR, name)
        if os.path.isfile(path):
            os.remove(path)


def assert_color_close(actual, expected, tolerance=14):
    assert all(abs(a - e) <= tolerance for a, e in zip(actual[:3], expected[:3])), (actual, expected)


def image_file(name, image, fmt='PNG'):
    data = io.BytesIO()
    image.save(data, format=fmt)
    data.seek(0)
    return data, name


def upload_images(client, files):
    response = client.post(
        '/upload_images',
        data={'files[]': files},
        content_type='multipart/form-data',
    )
    assert response.status_code == 200
    return response.get_json()['uploaded']


def wait_for_generation(client, job_id):
    for _ in range(80):
        progress = client.get(f'/get_generation_progress?job_id={job_id}').get_json()
        if progress['done']:
            assert progress['error'] is None
            return progress
        time.sleep(0.05)
    raise AssertionError('generation did not finish')


def generate_one(client, image1, image2, config, crop_focus1=None, crop_focus2=None):
    pair = []
    image1_data = {'path': image1} if image1 else None
    image2_data = {'path': image2} if image2 else None
    if image1_data and crop_focus1 is not None:
        image1_data['crop_focus'] = crop_focus1
    if image2_data and crop_focus2 is not None:
        image2_data['crop_focus'] = crop_focus2
    pair.append(image1_data)
    pair.append(image2_data)
    start = client.post(
        '/generate_diptychs',
        json={'pairs': [{'pair': pair, 'config': config}], 'zip': False},
    )
    assert start.status_code == 200
    job_id = start.get_json()['job_id']
    wait_for_generation(client, job_id)
    final = client.get(f'/finalize_download?job_id={job_id}').get_json()
    assert final['is_zip'] is False
    assert len(final['download_paths']) == 1
    return final['download_paths'][0]


def striped_image(size, stripes):
    width, height = size
    image = Image.new('RGB', size)
    stripe_width = width // len(stripes)
    for idx, color in enumerate(stripes):
        x0 = idx * stripe_width
        x1 = width if idx == len(stripes) - 1 else (idx + 1) * stripe_width
        for x in range(x0, x1):
            for y in range(height):
                image.putpixel((x, y), color)
    return image


def test_landscape_fill_measures_border_gap_dpi_and_cells():
    clear_upload_dir()
    with app.test_client() as client:
        upload_images(
            client,
            [
                image_file('left.png', Image.new('RGB', (80, 40), (220, 20, 20))),
                image_file('right.png', Image.new('RGB', (80, 40), (20, 40, 230))),
            ],
        )
        output = generate_one(
            client,
            'left.png',
            'right.png',
            {
                'width': 4,
                'height': 3,
                'dpi': 20,
                'orientation': 'landscape',
                'gap': 10,
                'outer_border': 5,
                'border_color': '#112233',
                'fit_mode': 'fill',
            },
        )

    with Image.open(output) as result:
        assert result.size == (80, 60)
        assert tuple(round(v) for v in result.info['dpi']) == (20, 20)
        assert_color_close(result.getpixel((2, 2)), (17, 34, 51))
        assert_color_close(result.getpixel((40, 30)), (17, 34, 51))
        assert_color_close(result.getpixel((20, 30)), (220, 20, 20))
        assert_color_close(result.getpixel((60, 30)), (20, 40, 230))


def test_portrait_fit_measures_padding_gap_and_output_size():
    clear_upload_dir()
    with app.test_client() as client:
        upload_images(
            client,
            [
                image_file('wide.png', Image.new('RGB', (120, 40), (240, 30, 40))),
                image_file('wide2.png', Image.new('RGB', (120, 40), (30, 180, 60))),
            ],
        )
        output = generate_one(
            client,
            'wide.png',
            'wide2.png',
            {
                'width': 4,
                'height': 3,
                'dpi': 20,
                'orientation': 'portrait',
                'gap': 8,
                'outer_border': 4,
                'border_color': '#f0f0f0',
                'fit_mode': 'fit',
            },
        )

    with Image.open(output) as result:
        assert result.size == (60, 80)
        assert_color_close(result.getpixel((2, 2)), (240, 240, 240))
        assert_color_close(result.getpixel((30, 40)), (240, 240, 240))
        assert_color_close(result.getpixel((30, 18)), (240, 30, 40))
        assert_color_close(result.getpixel((30, 58)), (30, 180, 60))
        assert_color_close(result.getpixel((6, 6)), (240, 240, 240))


def test_crop_focus_left_and_right_change_fill_region():
    clear_upload_dir()
    source = striped_image(
        (90, 30),
        [
            (230, 20, 20),
            (20, 200, 20),
            (20, 40, 230),
        ],
    )
    config = {
        'width': 4,
        'height': 2,
        'dpi': 20,
        'orientation': 'landscape',
        'gap': 0,
        'outer_border': 0,
        'border_color': '#ffffff',
        'fit_mode': 'fill',
    }
    with app.test_client() as client:
        upload_images(client, [image_file('stripes.png', source)])
        left_output = generate_one(
            client,
            'stripes.png',
            None,
            config,
            crop_focus1=[0, 0.5],
        )
        right_output = generate_one(
            client,
            'stripes.png',
            None,
            config,
            crop_focus1=[1, 0.5],
        )

    with Image.open(left_output) as left, Image.open(right_output) as right:
        assert left.size == (80, 40)
        assert right.size == (80, 40)
        assert_color_close(left.getpixel((20, 20)), (230, 20, 20), tolerance=22)
        assert_color_close(right.getpixel((20, 20)), (20, 40, 230), tolerance=22)


def test_single_image_remains_in_first_half_without_gap():
    clear_upload_dir()
    with app.test_client() as client:
        upload_images(client, [image_file('solo.png', Image.new('RGB', (80, 40), (210, 80, 20)))])
        output = generate_one(
            client,
            'solo.png',
            None,
            {
                'width': 4,
                'height': 2,
                'dpi': 20,
                'orientation': 'landscape',
                'gap': 20,
                'outer_border': 0,
                'border_color': '#ffffff',
                'fit_mode': 'fill',
            },
        )

    with Image.open(output) as result:
        assert result.size == (80, 40)
        assert_color_close(result.getpixel((20, 20)), (210, 80, 20))
        assert_color_close(result.getpixel((60, 20)), (255, 255, 255))


def test_transparent_fit_flattens_against_border_color():
    clear_upload_dir()
    transparent = Image.new('RGBA', (80, 40), (255, 255, 255, 0))
    for x in range(40, 80):
        for y in range(40):
            transparent.putpixel((x, y), (230, 20, 20, 255))

    with app.test_client() as client:
        upload_images(client, [image_file('transparent.png', transparent)])
        output = generate_one(
            client,
            'transparent.png',
            None,
            {
                'width': 4,
                'height': 2,
                'dpi': 20,
                'orientation': 'landscape',
                'gap': 0,
                'outer_border': 0,
                'border_color': '#ffffff',
                'fit_mode': 'fit',
            },
        )

    with Image.open(output) as result:
        assert result.size == (80, 40)
        assert_color_close(result.getpixel((10, 20)), (255, 255, 255))
        assert_color_close(result.getpixel((30, 20)), (230, 20, 20), tolerance=24)
