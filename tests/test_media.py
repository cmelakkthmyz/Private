from pathlib import Path
from PIL import Image

from medialupa.db import MediaDatabase
from medialupa.media import MediaScanner, average_hash


def test_scan_one_image(tmp_path: Path, monkeypatch):
    import medialupa.media as media_module
    monkeypatch.setattr(media_module, "THUMB_DIR", tmp_path / "thumbs")
    media_module.THUMB_DIR.mkdir()
    root = tmp_path / "photos"
    root.mkdir()
    Image.new("RGB", (120, 80), "navy").save(root / "test.jpg")
    db = MediaDatabase(tmp_path / "index.sqlite3")
    done, errors = MediaScanner(db).scan([str(root)])
    assert done == 1
    assert errors == 0
    rows = db.list_media()
    assert len(rows) == 1
    assert rows[0]["kind"] == "image"
    assert Path(rows[0]["thumbnail"]).exists()
    db.close()


def test_average_hash_is_stable():
    image = Image.new("RGB", (64, 64), "white")
    assert average_hash(image) == average_hash(image)
