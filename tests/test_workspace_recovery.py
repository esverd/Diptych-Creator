import os
import pytest
from PIL import Image
import app as server


def test_saved_photo_validation_and_thumbnail_regeneration(tmp_path, monkeypatch):
    uploads = tmp_path / 'uploads'
    thumbs = tmp_path / 'thumbs'
    uploads.mkdir()
    thumbs.mkdir()
    monkeypatch.setattr(server, 'UPLOAD_DIR', str(uploads))
    monkeypatch.setattr(server, 'THUMB_CACHE_DIR', str(thumbs))
    Image.new('RGB', (40, 30), 'red').save(uploads / 'retained.png')
    (uploads / 'broken.jpg').write_bytes(b'not an image')
    client = server.app.test_client()
    result = client.post('/workspace_images', json={'files':['retained.png','missing.png','broken.jpg']})
    assert result.status_code == 200
    assert result.json == {'available':['retained.png']}
    for files in [['../outside.png'], [''], [1], ['x'] * 2001]:
        assert client.post('/workspace_images', json={'files':files}).status_code == 400
    assert client.post('/workspace_images', json=[]).status_code == 400
    assert client.get('/thumbnail/retained.png').status_code == 200
    assert (thumbs / 'retained.png.jpg').exists()


def test_cleanup_retains_originals_and_expires_thumbnails(tmp_path, monkeypatch):
    uploads = tmp_path / 'uploads'
    thumbs = tmp_path / 'thumbs'
    uploads.mkdir()
    thumbs.mkdir()
    monkeypatch.setattr(server, 'UPLOAD_DIR', str(uploads))
    monkeypatch.setattr(server, 'THUMB_CACHE_DIR', str(thumbs))
    source = uploads / 'retained.png'
    thumbnail = thumbs / 'retained.png.jpg'
    source.write_bytes(b'original')
    thumbnail.write_bytes(b'thumbnail')
    os.utime(source, (1, 1))
    os.utime(thumbnail, (1, 1))
    monkeypatch.setattr(server.time, 'time', lambda: server.MAX_FILE_AGE_SECONDS + 100)
    def stop(_):
        raise SystemExit
    monkeypatch.setattr(server.time, 'sleep', stop)
    with pytest.raises(SystemExit):
        server.cleanup_task()
    assert source.exists()
    assert not thumbnail.exists()
