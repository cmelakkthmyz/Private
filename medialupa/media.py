from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, THUMB_DIR
from .db import MediaDatabase


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def average_hash(image: Image.Image, hash_size: int = 8) -> str:
    gray = ImageOps.grayscale(image).resize((hash_size, hash_size), Image.Resampling.LANCZOS)
    pixels = np.asarray(gray, dtype=np.float32)
    mean = float(pixels.mean())
    bits = (pixels > mean).flatten()
    value = 0
    for bit in bits:
        value = (value << 1) | int(bit)
    return f"{value:0{hash_size * hash_size // 4}x}"


def _thumbnail_path(path: Path) -> Path:
    key = hashlib.sha1(str(path).encode("utf-8", errors="replace")).hexdigest()
    return THUMB_DIR / f"{key}.jpg"


def image_metadata(path: Path) -> tuple[int, int, str, str]:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        width, height = image.size
        phash = average_hash(image)
        target = _thumbnail_path(path)
        image.thumbnail((420, 300), Image.Resampling.LANCZOS)
        image.save(target, "JPEG", quality=86, optimize=True)
    return width, height, str(target), phash


def video_metadata(path: Path) -> tuple[int | None, int | None, float | None, str | None, str | None]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        capture.release()
        return None, None, None, None, None
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0) or None
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0) or None
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    frames = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = frames / fps if fps > 0 and frames > 0 else None
    if frames > 0:
        capture.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(frames * 0.08)))
    ok, frame = capture.read()
    capture.release()
    if not ok:
        return width, height, duration, None, None
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    image = Image.fromarray(rgb)
    phash = average_hash(image)
    target = _thumbnail_path(path)
    image.thumbnail((420, 300), Image.Resampling.LANCZOS)
    image.save(target, "JPEG", quality=86, optimize=True)
    return width, height, duration, str(target), phash


class MediaScanner:
    def __init__(self, database: MediaDatabase):
        self.database = database

    def scan(
        self,
        roots: list[str],
        progress: Callable[[str, int, int], None] | None = None,
        cancelled: Callable[[], bool] | None = None,
    ) -> tuple[int, int]:
        candidates: list[Path] = []
        for root in roots:
            root_path = Path(root)
            if not root_path.exists():
                continue
            for current, dirs, files in os.walk(root_path):
                dirs[:] = [d for d in dirs if d not in {"$RECYCLE.BIN", "System Volume Information", "Windows"}]
                for filename in files:
                    path = Path(current) / filename
                    if path.suffix.lower() in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS:
                        candidates.append(path)
        total = len(candidates)
        processed = 0
        errors = 0
        for path in candidates:
            if cancelled and cancelled():
                break
            processed += 1
            try:
                stat = path.stat()
                old = self.database.existing_file(str(path.resolve()))
                if old and old["size"] == stat.st_size and old["mtime"] == stat.st_mtime:
                    thumb = old.get("thumbnail")
                    if thumb and Path(thumb).exists():
                        if progress:
                            progress(path.name, processed, total)
                        continue
                ext = path.suffix.lower()
                kind = "image" if ext in IMAGE_EXTENSIONS else "video"
                width = height = None
                duration = None
                thumbnail = phash = None
                if kind == "image":
                    width, height, thumbnail, phash = image_metadata(path)
                else:
                    width, height, duration, thumbnail, phash = video_metadata(path)
                item = {
                    "path": str(path.resolve()), "name": path.name, "extension": ext,
                    "kind": kind, "size": stat.st_size, "mtime": stat.st_mtime,
                    "width": width, "height": height, "duration": duration,
                    "sha256": sha256_file(path), "phash": phash, "thumbnail": thumbnail,
                }
                self.database.upsert_media(item)
            except (OSError, UnidentifiedImageError, ValueError, cv2.error):
                errors += 1
            except Exception:
                errors += 1
            if progress:
                progress(path.name, processed, total)
        return processed, errors
