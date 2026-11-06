from pathlib import Path

from medialupa.db import MediaDatabase


def test_roots_and_media_roundtrip(tmp_path: Path):
    db = MediaDatabase(tmp_path / "test.sqlite3")
    root = tmp_path / "photos"
    root.mkdir()
    db.add_root(str(root))
    assert db.roots() == [str(root.resolve())]
    db.upsert_media({
        "path": str(root / "one.jpg"), "name": "one.jpg", "extension": ".jpg",
        "kind": "image", "size": 123, "mtime": 1.0, "width": 10, "height": 20,
        "duration": None, "sha256": "abc", "phash": "ff", "thumbnail": None,
    })
    rows = db.list_media("one")
    assert len(rows) == 1
    assert rows[0]["name"] == "one.jpg"
    db.update_ai(1, "dog", ["dog", "pet"], b"embedding")
    assert db.list_media("pet")[0]["ai_caption"] == "dog"
    db.close()


def test_changed_file_invalidates_old_ai_tags(tmp_path: Path):
    db = MediaDatabase(tmp_path / "test.sqlite3")
    item = {
        "path": str(tmp_path / "same.jpg"), "name": "same.jpg", "extension": ".jpg",
        "kind": "image", "size": 10, "mtime": 1.0, "width": 10, "height": 10,
        "duration": None, "sha256": "abc", "phash": "ff", "thumbnail": None,
    }
    db.upsert_media(item)
    db.update_ai(1, "dog", ["dog"], b"vector")
    item["size"] = 20
    item["mtime"] = 2.0
    item["sha256"] = "def"
    db.upsert_media(item)
    row = db.list_media()[0]
    assert row["embedding"] is None
    assert row["ai_caption"] == ""
    assert row["tags"] is None
    db.close()


def test_exact_duplicate_group(tmp_path: Path):
    db = MediaDatabase(tmp_path / "test.sqlite3")
    for name in ("a.jpg", "b.jpg"):
        db.upsert_media({
            "path": str(tmp_path / name), "name": name, "extension": ".jpg",
            "kind": "image", "size": 42, "mtime": 1.0, "width": 10, "height": 10,
            "duration": None, "sha256": "same-content", "phash": "ff", "thumbnail": None,
        })
    groups = db.exact_duplicates()
    assert len(groups) == 1
    assert len(groups[0]) == 2
    db.close()


def test_similar_duplicates_uses_phash_and_excludes_exact_copies(tmp_path):
    db = MediaDatabase(tmp_path / "index.sqlite3")
    base = {
        "extension": ".jpg", "kind": "image", "size": 100, "mtime": 1.0,
        "width": 64, "height": 64, "duration": None, "thumbnail": None,
    }
    db.upsert_media({**base, "path": "a.jpg", "name": "a.jpg", "sha256": "same", "phash": "0000000000000000"})
    db.upsert_media({**base, "path": "b.jpg", "name": "b.jpg", "sha256": "same", "phash": "0000000000000000"})
    db.upsert_media({**base, "path": "c.jpg", "name": "c.jpg", "sha256": "other", "phash": "0000000000000003"})
    groups = db.similar_duplicates(max_distance=3)
    assert len(groups) == 1
    assert {item["path"] for item in groups[0]} == {"a.jpg", "c.jpg"}
    db.close()


def test_similar_duplicates_handles_bk_tree_distance_and_invalid_threshold(tmp_path):
    db = MediaDatabase(tmp_path / "index.sqlite3")
    base = {
        "extension": ".jpg", "kind": "image", "size": 100, "mtime": 1.0,
        "width": 64, "height": 64, "duration": None, "thumbnail": None,
    }
    values = [
        ("a.jpg", "0000000000000000"),
        ("b.jpg", "0000000000000001"),
        ("c.jpg", "0000000000000003"),
        ("far.jpg", "ffffffffffffffff"),
    ]
    for name, phash in values:
        db.upsert_media({**base, "path": name, "name": name, "sha256": name, "phash": phash})
    groups = db.similar_duplicates(max_distance=2)
    assert len(groups) == 1
    assert {item["path"] for item in groups[0]} == {"a.jpg", "b.jpg", "c.jpg"}
    try:
        db.similar_duplicates(max_distance=-1)
    except ValueError:
        pass
    else:
        raise AssertionError("negative Hamming threshold must be rejected")
    db.close()
