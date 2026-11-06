from __future__ import annotations

from PySide6.QtCore import QThread, Signal

from .ai_engine import ClipEngine
from .db import MediaDatabase
from .media import MediaScanner
from .ocr_engine import read_text


class ScanWorker(QThread):
    progress = Signal(str, int, int)
    finished_scan = Signal(int, int)
    failed = Signal(str)

    def __init__(self, database: MediaDatabase, roots: list[str]):
        super().__init__()
        self.database = database
        self.roots = roots
        self._cancel = False

    def cancel(self):
        self._cancel = True

    def run(self):
        try:
            scanner = MediaScanner(self.database)
            done, errors = scanner.scan(
                self.roots,
                progress=lambda name, current, total: self.progress.emit(name, current, total),
                cancelled=lambda: self._cancel,
            )
            self.finished_scan.emit(done, errors)
        except Exception as exc:
            self.failed.emit(str(exc))


class AIWorker(QThread):
    progress = Signal(str, int, int)
    finished_ai = Signal(int, int)
    failed = Signal(str)

    def __init__(self, database: MediaDatabase, rows: list[dict]):
        super().__init__()
        self.database = database
        self.rows = rows

    def run(self):
        engine = ClipEngine()
        success = errors = 0
        try:
            engine.load(lambda message: self.progress.emit(message, 0, len(self.rows)))
            for index, row in enumerate(self.rows, start=1):
                try:
                    path = row["path"]
                    thumb = row.get("thumbnail")
                    # Video previews are analyzed using the generated frame thumbnail.
                    target = thumb if row.get("kind") == "video" and thumb else path
                    caption, tags, embedding = engine.analyze(target)
                    self.database.update_ai(int(row["id"]), caption, tags, embedding)
                    success += 1
                except Exception:
                    errors += 1
                self.progress.emit(row.get("name", "Analyzuji"), index, len(self.rows))
            self.finished_ai.emit(success, errors)
        except Exception as exc:
            self.failed.emit(str(exc))


class OCRWorker(QThread):
    progress = Signal(str, int, int)
    finished_ocr = Signal(int, int)
    failed = Signal(str)

    def __init__(self, database: MediaDatabase, rows: list[dict]):
        super().__init__()
        self.database = database
        self.rows = rows

    def run(self):
        success = errors = 0
        for index, row in enumerate(self.rows, start=1):
            if row.get("kind") != "image":
                continue
            try:
                text = read_text(row["path"])
                self.database.update_ocr(int(row["id"]), text)
                success += 1
            except Exception:
                errors += 1
            self.progress.emit(row.get("name", "OCR"), index, len(self.rows))
        self.finished_ocr.emit(success, errors)


class SemanticSearchWorker(QThread):
    finished_search = Signal(list)
    failed = Signal(str)

    def __init__(self, database: MediaDatabase, query: str):
        super().__init__()
        self.database = database
        self.query = query

    def run(self):
        try:
            rows = self.database.embeddings()
            if not rows:
                raise RuntimeError("V knihovně zatím nejsou AI indexované soubory. Nejprve vyber média a klikni na Analyzovat AI.")
            engine = ClipEngine()
            ids = engine.search(self.query, rows)
            self.finished_search.emit(ids)
        except Exception as exc:
            self.failed.emit(str(exc))
