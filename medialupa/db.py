from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any


class MediaDatabase:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS roots (
                    path TEXT PRIMARY KEY,
                    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS media (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    path TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    extension TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    mtime REAL NOT NULL,
                    width INTEGER,
                    height INTEGER,
                    duration REAL,
                    sha256 TEXT,
                    phash TEXT,
                    thumbnail TEXT,
                    ai_caption TEXT DEFAULT '',
                    ocr_text TEXT DEFAULT '',
                    embedding BLOB,
                    indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_media_kind ON media(kind);
                CREATE INDEX IF NOT EXISTS idx_media_sha256 ON media(sha256);
                CREATE INDEX IF NOT EXISTS idx_media_name ON media(name COLLATE NOCASE);
                CREATE TABLE IF NOT EXISTS tags (
                    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
                    tag TEXT NOT NULL,
                    PRIMARY KEY(media_id, tag)
                );
                CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag COLLATE NOCASE);
                """
            )
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def add_root(self, path: str) -> None:
        normalized = str(Path(path).expanduser().resolve())
        with self._lock:
            self._conn.execute("INSERT OR IGNORE INTO roots(path) VALUES (?)", (normalized,))
            self._conn.commit()

    def remove_root(self, path: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM roots WHERE path = ?", (str(Path(path).resolve()),))
            self._conn.commit()

    def roots(self) -> list[str]:
        with self._lock:
            rows = self._conn.execute("SELECT path FROM roots ORDER BY path COLLATE NOCASE").fetchall()
        return [r["path"] for r in rows]

    def existing_file(self, path: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT size, mtime, thumbnail FROM media WHERE path = ?", (path,)
            ).fetchone()
        return dict(row) if row else None

    def upsert_media(self, item: dict[str, Any]) -> None:
        fields = (
            "path", "name", "extension", "kind", "size", "mtime", "width", "height",
            "duration", "sha256", "phash", "thumbnail"
        )
        values = [item.get(k) for k in fields]
        with self._lock:
            self._conn.execute(
                """INSERT INTO media(path,name,extension,kind,size,mtime,width,height,duration,sha256,phash,thumbnail)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(path) DO UPDATE SET
                   name=excluded.name, extension=excluded.extension, kind=excluded.kind,
                   size=excluded.size, mtime=excluded.mtime, width=excluded.width,
                   height=excluded.height, duration=excluded.duration, sha256=excluded.sha256,
                   phash=excluded.phash, thumbnail=excluded.thumbnail,
                   ai_caption='', ocr_text='', embedding=NULL,
                   indexed_at=CURRENT_TIMESTAMP""",
                values,
            )
            self._conn.execute(
                "DELETE FROM tags WHERE media_id=(SELECT id FROM media WHERE path=?)",
                (item.get("path"),),
            )
            self._conn.commit()

    def list_media(self, query: str = "", kind: str = "all", limit: int = 50000) -> list[dict[str, Any]]:
        sql = """SELECT m.*, GROUP_CONCAT(t.tag, ', ') AS tags
                 FROM media m LEFT JOIN tags t ON t.media_id=m.id"""
        where: list[str] = []
        args: list[Any] = []
        if kind in ("image", "video"):
            where.append("m.kind = ?")
            args.append(kind)
        if query.strip():
            needle = f"%{query.strip()}%"
            where.append("(m.name LIKE ? OR m.path LIKE ? OR m.ai_caption LIKE ? OR m.ocr_text LIKE ? OR EXISTS (SELECT 1 FROM tags tx WHERE tx.media_id=m.id AND tx.tag LIKE ?))")
            args.extend([needle] * 5)
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " GROUP BY m.id ORDER BY m.mtime DESC LIMIT ?"
        args.append(limit)
        with self._lock:
            rows = self._conn.execute(sql, args).fetchall()
        return [dict(r) for r in rows]

    def media_by_ids(self, ids: list[int]) -> list[dict[str, Any]]:
        if not ids:
            return []
        marks = ",".join("?" for _ in ids)
        with self._lock:
            rows = self._conn.execute(f"SELECT * FROM media WHERE id IN ({marks})", ids).fetchall()
        return [dict(r) for r in rows]

    def update_ai(self, media_id: int, caption: str, tags: list[str], embedding: bytes) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE media SET ai_caption=?, embedding=?, indexed_at=CURRENT_TIMESTAMP WHERE id=?",
                (caption, embedding, media_id),
            )
            self._conn.execute("DELETE FROM tags WHERE media_id=?", (media_id,))
            self._conn.executemany(
                "INSERT OR IGNORE INTO tags(media_id,tag) VALUES(?,?)",
                [(media_id, tag.strip().lower()) for tag in tags if tag.strip()],
            )
            self._conn.commit()

    def update_ocr(self, media_id: int, text: str) -> None:
        with self._lock:
            self._conn.execute("UPDATE media SET ocr_text=? WHERE id=?", (text, media_id))
            self._conn.commit()

    def embeddings(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id,path,name,kind,embedding FROM media WHERE embedding IS NOT NULL"
            ).fetchall()
        return [dict(r) for r in rows]

    def exact_duplicates(self) -> list[list[dict[str, Any]]]:
        with self._lock:
            groups = self._conn.execute(
                "SELECT sha256, COUNT(*) AS n FROM media WHERE sha256 IS NOT NULL GROUP BY sha256 HAVING n > 1"
            ).fetchall()
            result = []
            for group in groups:
                rows = self._conn.execute(
                    "SELECT id,path,name,size,kind,thumbnail FROM media WHERE sha256=? ORDER BY path",
                    (group["sha256"],),
                ).fetchall()
                result.append([dict(r) for r in rows])
        return result

    def similar_duplicates(self, max_distance: int = 6) -> list[list[dict[str, Any]]]:
        """Find visually similar media using 64-bit average-hash Hamming distance.

        Exact copies are excluded; returned groups are connected components, so
        every member is linked to at least one other member within the threshold.
        """
        with self._lock:
            rows = self._conn.execute(
                "SELECT id,path,name,size,kind,thumbnail,sha256,phash FROM media "
                "WHERE phash IS NOT NULL AND LENGTH(phash)=16 ORDER BY id"
            ).fetchall()
        items = [dict(row) for row in rows]
        unique_items: list[dict[str, Any]] = []
        seen_sha: set[str] = set()
        for item in items:
            digest = item.get("sha256")
            if digest and digest in seen_sha:
                continue
            if digest:
                seen_sha.add(digest)
            unique_items.append(item)
        items = unique_items
        hashes = []
        for item in items:
            try:
                hashes.append(int(item["phash"], 16))
            except (TypeError, ValueError):
                hashes.append(None)
        parent = list(range(len(items)))

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a: int, b: int) -> None:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[rb] = ra

        if max_distance < 0:
            raise ValueError("max_distance must be non-negative")

        tree: dict | None = None

        def query(node: dict, value: int, radius: int, matches: list[int]) -> None:
            distance = (value ^ node["hash"]).bit_count()
            if distance <= radius:
                matches.append(node["index"])
            low, high = distance - radius, distance + radius
            for edge, child in node["children"].items():
                if low <= edge <= high:
                    query(child, value, radius, matches)

        def insert(node: dict, value: int, index: int) -> None:
            distance = (value ^ node["hash"]).bit_count()
            child = node["children"].get(distance)
            if child is None:
                node["children"][distance] = {"hash": value, "index": index, "children": {}}
            else:
                insert(child, value, index)

        for index, value in enumerate(hashes):
            if value is None:
                continue
            if tree is None:
                tree = {"hash": value, "index": index, "children": {}}
                continue
            matches: list[int] = []
            query(tree, value, max_distance, matches)
            for other_index in matches:
                left_sha = items[index].get("sha256")
                right_sha = items[other_index].get("sha256")
                if left_sha and left_sha == right_sha:
                    continue
                union(index, other_index)
            insert(tree, value, index)
        groups: dict[int, list[dict[str, Any]]] = {}
        for i, item in enumerate(items):
            root = find(i)
            groups.setdefault(root, []).append({k: item[k] for k in
                ("id", "path", "name", "size", "kind", "thumbnail")})
        return [group for group in groups.values() if len(group) > 1]

    def stats(self) -> dict[str, int]:
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) AS total, SUM(CASE WHEN kind='image' THEN 1 ELSE 0 END) AS images, "
                "SUM(CASE WHEN kind='video' THEN 1 ELSE 0 END) AS videos, "
                "SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS ai_done FROM media"
            ).fetchone()
        return {k: int(row[k] or 0) for k in row.keys()}

    def delete_media(self, media_id: int) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM media WHERE id=?", (media_id,))
            self._conn.commit()
