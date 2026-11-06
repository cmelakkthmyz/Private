from __future__ import annotations

import os
from pathlib import Path
from importlib.util import find_spec

from PySide6.QtCore import Qt, QSize, QUrl
from PySide6.QtGui import QIcon, QPixmap, QAction, QDesktopServices
from PySide6.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QFrame, QPushButton, QLabel,
    QLineEdit, QComboBox, QListWidget, QListWidgetItem, QFileDialog, QMessageBox,
    QStackedWidget, QTableWidget, QTableWidgetItem, QHeaderView, QDialog,
    QMenu, QProgressDialog, QAbstractItemView, QFormLayout, QGroupBox, QSplitter,
    QTreeWidget, QTreeWidgetItem,
)

from .config import DB_PATH, THUMB_DIR, DATA_DIR
from .db import MediaDatabase
from .workers import ScanWorker, AIWorker, OCRWorker, SemanticSearchWorker


DARK_STYLE = """
QWidget { background: #111827; color: #e5e7eb; font-family: 'Segoe UI'; }
QMainWindow { background: #0b1220; }
QFrame#Sidebar { background: #0b1220; border-right: 1px solid #263244; }
QLabel#Brand { color: #f8fafc; font-size: 22px; font-weight: 700; padding: 8px 4px 18px 4px; }
QLabel#Subtle { color: #94a3b8; }
QLabel#PageTitle { color: #f8fafc; font-size: 22px; font-weight: 650; }
QPushButton { background: #1f2937; color: #e5e7eb; border: 1px solid #334155; border-radius: 8px; padding: 9px 13px; }
QPushButton:hover { background: #29374b; border-color: #64748b; }
QPushButton:pressed { background: #334155; }
QPushButton#Primary { background: #2563eb; border-color: #2563eb; color: white; font-weight: 600; }
QPushButton#Primary:hover { background: #1d4ed8; }
QPushButton#Nav { text-align: left; padding: 12px 14px; border: 0; background: transparent; color: #aab7c8; }
QPushButton#Nav:hover { background: #172235; color: white; }
QPushButton#Nav[active="true"] { background: #1d2d46; color: #93c5fd; border-left: 3px solid #3b82f6; }
QLineEdit, QComboBox { background: #172235; border: 1px solid #334155; border-radius: 8px; padding: 9px 11px; color: #f8fafc; selection-background-color: #2563eb; }
QComboBox QAbstractItemView { background: #172235; selection-background-color: #2563eb; }
QListWidget { background: #111827; border: 0; outline: 0; padding: 8px; }
QListWidget::item { background: #172235; border: 1px solid #29374b; border-radius: 10px; padding: 8px; margin: 7px; color: #e5e7eb; }
QListWidget::item:selected { background: #1e3a5f; border: 1px solid #3b82f6; }
QTableWidget { background: #111827; alternate-background-color: #172235; border: 1px solid #29374b; gridline-color: #29374b; selection-background-color: #1e3a5f; }
QHeaderView::section { background: #172235; color: #cbd5e1; padding: 8px; border: 0; border-bottom: 1px solid #334155; }
QProgressDialog { background: #111827; }
QDialog { background: #111827; }
QGroupBox { border: 1px solid #334155; border-radius: 10px; margin-top: 12px; padding: 12px; font-weight: 600; }
QGroupBox::title { subcontrol-origin: margin; left: 12px; padding: 0 5px; }
QStatusBar { background: #0b1220; color: #94a3b8; border-top: 1px solid #263244; }
"""


class PreviewDialog(QDialog):
    def __init__(self, row: dict, parent=None):
        super().__init__(parent)
        self.row = row
        self.setWindowTitle(row.get("name", "Náhled"))
        self.resize(900, 680)
        layout = QVBoxLayout(self)
        image_label = QLabel()
        image_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        image_label.setMinimumHeight(420)
        thumb = row.get("thumbnail")
        if thumb and Path(thumb).exists():
            pix = QPixmap(thumb)
            image_label.setPixmap(pix.scaled(840, 480, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        else:
            image_label.setText("Náhled není k dispozici")
        layout.addWidget(image_label, 1)
        details = QLabel(
            f"{row.get('name','')}\n{row.get('path','')}\n"
            f"{row.get('width') or '?'} × {row.get('height') or '?'} px  |  "
            f"{row.get('size', 0) / (1024 * 1024):.2f} MB  |  {row.get('kind','')}\n"
            f"AI: {row.get('ai_caption') or 'zatím neanalyzováno'}  |  Štítky: {row.get('tags') or '—'}"
        )
        details.setWordWrap(True)
        details.setStyleSheet("color:#cbd5e1; padding:8px;")
        layout.addWidget(details)
        buttons = QHBoxLayout()
        buttons.addStretch(1)
        open_button = QPushButton("Otevřít v systému")
        open_button.clicked.connect(lambda: QDesktopServices.openUrl(QUrl.fromLocalFile(row["path"])))
        close_button = QPushButton("Zavřít")
        close_button.clicked.connect(self.accept)
        buttons.addWidget(open_button)
        buttons.addWidget(close_button)
        layout.addLayout(buttons)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("MediaLupa – Windows")
        self.resize(1440, 900)
        self.setMinimumSize(1024, 680)
        self.setStyleSheet(DARK_STYLE)
        self.db = MediaDatabase(DB_PATH)
        self.rows: list[dict] = []
        self.rows_by_id: dict[int, dict] = {}
        self.semantic_ids: list[int] | None = None
        self.current_folder: str | None = None
        self.worker = None
        self.busy = False
        self.progress_dialog = None
        self.nav_buttons: dict[str, QPushButton] = {}
        self._build_ui()
        self._refresh_roots()
        self.refresh_media()

    def _build_ui(self):
        root = QWidget()
        root_layout = QHBoxLayout(root)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        sidebar = QFrame()
        sidebar.setObjectName("Sidebar")
        sidebar.setFixedWidth(228)
        side_layout = QVBoxLayout(sidebar)
        side_layout.setContentsMargins(16, 20, 14, 16)
        side_layout.setSpacing(7)
        brand = QLabel("◈ MediaLupa")
        brand.setObjectName("Brand")
        side_layout.addWidget(brand)
        side_layout.addWidget(self._nav_button("Knihovna", "library"))
        side_layout.addWidget(self._nav_button("Složky a zdroje", "folders"))
        side_layout.addWidget(self._nav_button("Duplicity", "duplicates"))
        side_layout.addWidget(self._nav_button("Nastavení", "settings"))
        side_layout.addStretch(1)
        privacy = QLabel("LOKÁLNÍ KNIHOVNA\nSoubory zůstávají u tebe")
        privacy.setObjectName("Subtle")
        privacy.setStyleSheet("font-size:10px; padding:8px 4px;")
        side_layout.addWidget(privacy)

        main = QWidget()
        main_layout = QVBoxLayout(main)
        main_layout.setContentsMargins(24, 20, 24, 14)
        main_layout.setSpacing(14)

        header = QHBoxLayout()
        self.page_title = QLabel("Knihovna médií")
        self.page_title.setObjectName("PageTitle")
        header.addWidget(self.page_title)
        header.addStretch(1)
        self.stats_label = QLabel("")
        self.stats_label.setObjectName("Subtle")
        header.addWidget(self.stats_label)
        main_layout.addLayout(header)

        toolbar = QHBoxLayout()
        self.add_folder_button = QPushButton("＋ Přidat složku")
        self.add_folder_button.clicked.connect(self.add_folder)
        self.scan_button = QPushButton("↻ Skenovat")
        self.scan_button.setObjectName("Primary")
        self.scan_button.clicked.connect(self.start_scan)
        self.search_edit = QLineEdit()
        self.search_edit.setPlaceholderText("Hledat název, cestu, štítek nebo text…")
        self.search_edit.returnPressed.connect(self.run_search)
        self.search_mode = QComboBox()
        self.search_mode.addItems(["Textové hledání", "Vizuální AI"])
        self.search_mode.setMinimumWidth(145)
        self.search_button = QPushButton("Hledat")
        self.search_button.clicked.connect(self.run_search)
        self.kind_filter = QComboBox()
        self.kind_filter.addItems(["Vše", "Fotografie", "Videa"])
        self.kind_filter.currentIndexChanged.connect(self.refresh_media)
        self.ai_button = QPushButton("✦ Analyzovat AI")
        self.ai_button.clicked.connect(self.start_ai)
        self.ocr_button = QPushButton("OCR")
        self.ocr_button.clicked.connect(self.start_ocr)
        for widget in (self.add_folder_button, self.scan_button):
            toolbar.addWidget(widget)
        toolbar.addWidget(self.search_edit, 1)
        toolbar.addWidget(self.search_mode)
        toolbar.addWidget(self.search_button)
        toolbar.addWidget(self.kind_filter)
        toolbar.addWidget(self.ai_button)
        toolbar.addWidget(self.ocr_button)
        main_layout.addLayout(toolbar)

        self.stack = QStackedWidget()
        self.library_page = QWidget()
        library_layout = QHBoxLayout(self.library_page)
        library_layout.setContentsMargins(0, 0, 0, 0)
        library_layout.setSpacing(10)
        library_splitter = QSplitter(Qt.Orientation.Horizontal)
        self.folder_tree = QTreeWidget()
        self.folder_tree.setHeaderHidden(True)
        self.folder_tree.setMinimumWidth(190)
        self.folder_tree.setMaximumWidth(310)
        self.folder_tree.itemClicked.connect(self._folder_selected)
        self.library_view = QListWidget()
        self.library_view.setViewMode(QListWidget.ViewMode.IconMode)
        self.library_view.setIconSize(QSize(176, 126))
        self.library_view.setGridSize(QSize(210, 190))
        self.library_view.setResizeMode(QListWidget.ResizeMode.Adjust)
        self.library_view.setMovement(QListWidget.Movement.Static)
        self.library_view.setWordWrap(True)
        self.library_view.setSpacing(4)
        self.library_view.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.library_view.itemDoubleClicked.connect(self.open_item)
        self.library_view.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.library_view.customContextMenuRequested.connect(self.show_item_menu)
        library_splitter.addWidget(self.folder_tree)
        library_splitter.addWidget(self.library_view)
        library_splitter.setStretchFactor(0, 0)
        library_splitter.setStretchFactor(1, 1)
        library_layout.addWidget(library_splitter)
        self.stack.addWidget(self.library_page)

        self.folders_page = QWidget()
        folders_layout = QVBoxLayout(self.folders_page)
        folders_layout.addWidget(QLabel("Indexované složky – včetně synchronizovaných složek OneDrive, Google Drive a Dropboxu."))
        self.roots_list = QListWidget()
        folders_layout.addWidget(self.roots_list, 1)
        roots_buttons = QHBoxLayout()
        add_root = QPushButton("Přidat složku")
        add_root.clicked.connect(self.add_folder)
        remove_root = QPushButton("Odebrat ze seznamu")
        remove_root.clicked.connect(self.remove_root)
        roots_buttons.addWidget(add_root)
        roots_buttons.addWidget(remove_root)
        roots_buttons.addStretch(1)
        folders_layout.addLayout(roots_buttons)
        self.stack.addWidget(self.folders_page)

        self.duplicates_page = QWidget()
        dup_layout = QVBoxLayout(self.duplicates_page)
        dup_layout.addWidget(QLabel("Přesné duplicity podle kontrolního součtu SHA-256. Originály se nemažou."))
        self.duplicates_table = QTableWidget(0, 4)
        self.duplicates_table.setHorizontalHeaderLabels(["Název", "Cesta", "Typ", "Velikost"])
        self.duplicates_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self.duplicates_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.duplicates_table.setAlternatingRowColors(True)
        self.duplicates_table.cellDoubleClicked.connect(self.open_duplicate)
        dup_layout.addWidget(self.duplicates_table, 1)
        dup_buttons = QHBoxLayout()
        refresh_dup = QPushButton("Vyhledat přesné duplicity")
        refresh_dup.clicked.connect(self.refresh_duplicates)
        similar_dup = QPushButton("Najít podobné snímky")
        similar_dup.clicked.connect(self.refresh_similar_duplicates)
        dup_buttons.addWidget(refresh_dup)
        dup_buttons.addWidget(similar_dup)
        dup_buttons.addStretch(1)
        dup_layout.addLayout(dup_buttons)
        self.stack.addWidget(self.duplicates_page)

        self.settings_page = self._make_settings_page()
        self.stack.addWidget(self.settings_page)
        main_layout.addWidget(self.stack, 1)

        root_layout.addWidget(sidebar)
        root_layout.addWidget(main, 1)
        self.setCentralWidget(root)
        self.statusBar().showMessage("Připraveno")
        self._activate_nav("library")

    def _nav_button(self, title: str, key: str) -> QPushButton:
        button = QPushButton(title)
        button.setObjectName("Nav")
        button.setProperty("active", False)
        button.clicked.connect(lambda: self.show_page(key))
        self.nav_buttons[key] = button
        return button

    def _make_settings_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setAlignment(Qt.AlignmentFlag.AlignTop)
        intro = QLabel("MediaLupa ukládá index a náhledy lokálně. Původní fotografie ani videa nepřesouvá.")
        intro.setWordWrap(True)
        layout.addWidget(intro)
        group = QGroupBox("Stav modulů")
        form = QFormLayout(group)
        form.addRow("Databáze:", QLabel(str(DB_PATH)))
        form.addRow("Lokální CLIP AI:", QLabel("Dostupné po instalaci volitelného AI modulu" if not find_spec("sentence_transformers") else "Nainstalováno – model se stáhne při prvním použití"))
        form.addRow("OCR:", QLabel("Dostupné po instalaci pytesseract a Tesseract OCR" if not find_spec("pytesseract") else "Python modul nainstalován – ověř Tesseract OCR"))
        form.addRow("Náhledy:", QLabel(str(THUMB_DIR)))
        layout.addWidget(group)
        notes = QLabel(
            "Cloud: vyber synchronizovanou složku OneDrive, Google Drive pro počítače nebo Dropbox. "
            "MediaLupa indexuje soubory, které jsou dostupné v Průzkumníku Windows; nepřebírá hesla ani přihlašovací tokeny.\n\n"
            "AI: CLIP běží lokálně na CPU. Při prvním použití stáhne model (přibližně 700 MB až 1 GB); po stažení lze analýzu a vyhledávání provádět offline.\n\n"
            "OCR: pro češtinu nainstaluj Tesseract OCR s jazykem Czech a poté spusť INSTALL_OCR.bat."
        )
        notes.setWordWrap(True)
        notes.setStyleSheet("color:#94a3b8; padding:8px;")
        layout.addWidget(notes)
        open_data = QPushButton("Otevřít datovou složku")
        open_data.clicked.connect(lambda: QDesktopServices.openUrl(QUrl.fromLocalFile(str(DATA_DIR))))
        layout.addWidget(open_data, 0, Qt.AlignmentFlag.AlignLeft)
        return page

    def show_page(self, key: str):
        indexes = {"library": 0, "folders": 1, "duplicates": 2, "settings": 3}
        self.stack.setCurrentIndex(indexes[key])
        titles = {"library": "Knihovna médií", "folders": "Složky a zdroje", "duplicates": "Duplicity", "settings": "Nastavení"}
        self.page_title.setText(titles[key])
        self._activate_nav(key)
        if key == "duplicates":
            self.refresh_duplicates()

    def _activate_nav(self, active: str):
        for key, button in self.nav_buttons.items():
            button.setProperty("active", key == active)
            button.style().unpolish(button)
            button.style().polish(button)

    def _set_busy(self, busy: bool):
        self.busy = busy
        for button in (self.scan_button, self.search_button, self.ai_button, self.ocr_button):
            button.setEnabled(not busy)

    def add_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Vyber složku s fotografiemi nebo videi")
        if folder:
            self.db.add_root(folder)
            self._refresh_roots()
            self.statusBar().showMessage(f"Přidána složka: {folder}", 5000)

    def remove_root(self):
        item = self.roots_list.currentItem()
        if not item:
            return
        path = item.text()
        answer = QMessageBox.question(self, "Odebrat složku", f"Odebrat zdroj ze seznamu?\n{path}\n\nIndexované záznamy zůstanou zachované.")
        if answer == QMessageBox.StandardButton.Yes:
            self.db.remove_root(path)
            if self.current_folder == path or (self.current_folder and Path(self.current_folder).is_relative_to(Path(path))):
                self.current_folder = None
            self._refresh_roots()
            self.refresh_media()

    def _refresh_roots(self):
        self.roots_list.clear()
        for path in self.db.roots():
            self.roots_list.addItem(path)
        self._refresh_folder_tree()

    def _refresh_folder_tree(self):
        if not hasattr(self, "folder_tree"):
            return
        selected = self.current_folder
        self.folder_tree.blockSignals(True)
        self.folder_tree.clear()
        all_item = QTreeWidgetItem(["Všechny složky"])
        all_item.setData(0, Qt.ItemDataRole.UserRole, None)
        self.folder_tree.addTopLevelItem(all_item)
        rows = self.db.list_media(limit=100000)
        for root in self.db.roots():
            root_path = Path(root)
            root_item = QTreeWidgetItem([root_path.name or root])
            root_item.setToolTip(0, root)
            root_item.setData(0, Qt.ItemDataRole.UserRole, root)
            self.folder_tree.addTopLevelItem(root_item)
            nodes = {str(root_path): root_item}
            folders: set[str] = set()
            for row in rows:
                media_path = Path(row["path"])
                try:
                    relative = media_path.parent.relative_to(root_path)
                except ValueError:
                    continue
                current = root_path
                for part in relative.parts:
                    current = current / part
                    key = str(current)
                    if key not in folders:
                        folders.add(key)
                        parent = nodes.get(str(current.parent), root_item)
                        child = QTreeWidgetItem([part])
                        child.setToolTip(0, key)
                        child.setData(0, Qt.ItemDataRole.UserRole, key)
                        parent.addChild(child)
                        nodes[key] = child
            root_item.setExpanded(True)
        self.folder_tree.sortItems(0, Qt.SortOrder.AscendingOrder)
        if selected:
            matches = self.folder_tree.findItems(selected, Qt.MatchFlag.MatchRecursive | Qt.MatchFlag.MatchExactly, 0)
            for match in matches:
                if match.data(0, Qt.ItemDataRole.UserRole) == selected:
                    self.folder_tree.setCurrentItem(match)
                    break
        else:
            self.folder_tree.setCurrentItem(all_item)
        self.folder_tree.blockSignals(False)

    def _folder_selected(self, item: QTreeWidgetItem, column: int):
        self.current_folder = item.data(0, Qt.ItemDataRole.UserRole)
        self.refresh_media()

    def start_scan(self):
        if self.busy:
            return
        roots = self.db.roots()
        if not roots:
            QMessageBox.information(self, "Nejdřív přidej složku", "Vyber složku, kterou má MediaLupa prohledat.")
            self.add_folder()
            roots = self.db.roots()
        if not roots:
            return
        self._set_busy(True)
        self.progress_dialog = QProgressDialog("Připravuji skenování…", "Skrýt", 0, 100, self)
        self.progress_dialog.setWindowTitle("Skenování médií")
        self.progress_dialog.setMinimumDuration(0)
        self.worker = ScanWorker(self.db, roots)
        self.worker.progress.connect(self._scan_progress)
        self.worker.finished_scan.connect(self._scan_finished)
        self.worker.failed.connect(self._worker_failed)
        self.worker.start()

    def _scan_progress(self, name: str, current: int, total: int):
        if self.progress_dialog:
            self.progress_dialog.setMaximum(max(total, 1))
            self.progress_dialog.setValue(current)
            self.progress_dialog.setLabelText(f"Zpracovávám: {name}\n{current} / {total}")
        self.statusBar().showMessage(f"Skenování: {name} ({current}/{total})")

    def _scan_finished(self, processed: int, errors: int):
        self._set_busy(False)
        if self.progress_dialog:
            self.progress_dialog.close()
        self._refresh_folder_tree()
        self.refresh_media()
        QMessageBox.information(self, "Skenování dokončeno", f"Zpracováno souborů: {processed}\nChyby nebo nepodporované soubory: {errors}")
        self.statusBar().showMessage("Skenování dokončeno", 5000)

    def _worker_failed(self, message: str):
        self._set_busy(False)
        if self.progress_dialog:
            self.progress_dialog.close()
        QMessageBox.critical(self, "Chyba", message)

    def refresh_media(self):
        if not hasattr(self, "library_view"):
            return
        query = self.search_edit.text().strip() if hasattr(self, "search_edit") else ""
        kind_index = self.kind_filter.currentIndex() if hasattr(self, "kind_filter") else 0
        kind = {0: "all", 1: "image", 2: "video"}.get(kind_index, "all")
        rows = self.db.list_media(query, kind)
        if self.semantic_ids is not None:
            by_id = {r["id"]: r for r in self.db.list_media("", kind)}
            rows = [by_id[i] for i in self.semantic_ids if i in by_id]
        if self.current_folder:
            folder = Path(self.current_folder)
            rows = [row for row in rows if Path(row["path"]).is_relative_to(folder)]
        self.rows = rows
        self.rows_by_id = {int(row["id"]): row for row in rows}
        self.library_view.clear()
        for row in rows:
            thumb = row.get("thumbnail")
            icon = QIcon(thumb) if thumb and Path(thumb).exists() else QIcon()
            tags = row.get("tags") or ""
            caption = row.get("ai_caption") or ""
            line2 = caption if caption else ("VIDEO" if row.get("kind") == "video" else "FOTO")
            text = f"{row['name']}\n{line2}" + (f"\n{tags}" if tags else "")
            item = QListWidgetItem(icon, text)
            item.setData(Qt.ItemDataRole.UserRole, int(row["id"]))
            item.setToolTip(f"{row['path']}\n{row.get('width') or '?'} × {row.get('height') or '?'} px\n{tags}")
            self.library_view.addItem(item)
        stats = self.db.stats()
        self.stats_label.setText(f"{stats['total']:,} souborů  ·  {stats['images']:,} fotek  ·  {stats['videos']:,} videí  ·  {stats['ai_done']:,} AI")
        if not rows:
            self.statusBar().showMessage("Knihovna je prázdná. Přidej složku a spusť skenování.")

    def run_search(self):
        if self.busy:
            return
        query = self.search_edit.text().strip()
        if not query:
            self.semantic_ids = None
            self.refresh_media()
            return
        if self.search_mode.currentIndex() == 0:
            self.semantic_ids = None
            self.refresh_media()
            self.statusBar().showMessage(f"Textové hledání: {query}", 4000)
            return
        self._set_busy(True)
        self.statusBar().showMessage("Vyhledávám podle vizuálního obsahu…")
        self.worker = SemanticSearchWorker(self.db, query)
        self.worker.finished_search.connect(self._semantic_finished)
        self.worker.failed.connect(self._semantic_failed)
        self.worker.start()

    def _semantic_finished(self, ids: list):
        self._set_busy(False)
        self.semantic_ids = [int(i) for i in ids]
        self.refresh_media()
        self.statusBar().showMessage(f"Vizuální AI našla {len(ids)} odpovídajících položek.", 6000)

    def _semantic_failed(self, message: str):
        self._set_busy(False)
        QMessageBox.warning(self, "Vizuální AI", message)

    def _selected_rows(self) -> list[dict]:
        ids = [int(item.data(Qt.ItemDataRole.UserRole)) for item in self.library_view.selectedItems()]
        if ids:
            return self.db.media_by_ids(ids)
        return self.rows

    def start_ai(self):
        if self.busy:
            return
        rows = self._selected_rows()
        rows = [row for row in rows if not row.get("embedding")]
        if not rows:
            QMessageBox.information(self, "AI analýza", "Nejdřív vyber fotografie nebo videa bez AI indexu, případně spusť skenování.")
            return
        answer = QMessageBox.question(
            self, "Lokální AI analýza",
            f"Analyzovat {len(rows)} položek lokálním modelem CLIP?\nPři prvním spuštění se stáhne model (přibližně 700 MB až 1 GB). Další analýza poběží lokálně.",
        )
        if answer != QMessageBox.StandardButton.Yes:
            return
        self._set_busy(True)
        self.progress_dialog = QProgressDialog("Spouštím lokální AI…", "Skrýt", 0, len(rows), self)
        self.progress_dialog.setWindowTitle("AI analýza")
        self.progress_dialog.setMinimumDuration(0)
        self.worker = AIWorker(self.db, rows)
        self.worker.progress.connect(self._ai_progress)
        self.worker.failed.connect(self._ai_failed)
        self.worker.start()

    def _ai_progress(self, name: str, current: int, total: int):
        if self.progress_dialog:
            self.progress_dialog.setMaximum(max(total, 1))
            self.progress_dialog.setValue(current)
            self.progress_dialog.setLabelText(f"AI: {name}\n{current} / {total}")

    def _ai_finished(self, success: int, errors: int):
        self._set_busy(False)
        if self.progress_dialog:
            self.progress_dialog.close()
        self.refresh_media()
        QMessageBox.information(self, "AI analýza dokončena", f"Analyzováno: {success}\nChyby: {errors}")

    def _ai_failed(self, message: str):
        self._set_busy(False)
        if self.progress_dialog:
            self.progress_dialog.close()
        QMessageBox.warning(self, "AI modul", message)

    def start_ocr(self):
        if self.busy:
            return
        rows = [row for row in self._selected_rows() if row.get("kind") == "image"]
        if not rows:
            QMessageBox.information(self, "OCR", "Vyber jednu nebo více fotografií, případně nejprve přidej a naskenuj složku.")
            return
        self._set_busy(True)
        self.progress_dialog = QProgressDialog("Spouštím OCR…", "Skrýt", 0, len(rows), self)
        self.progress_dialog.setWindowTitle("OCR – rozpoznávání textu")
        self.progress_dialog.setMinimumDuration(0)
        self.worker = OCRWorker(self.db, rows)
        self.worker.progress.connect(self._ocr_progress)
        self.worker.finished_ocr.connect(self._ocr_finished)
        self.worker.failed.connect(self._worker_failed)
        self.worker.start()

    def _ocr_progress(self, name: str, current: int, total: int):
        if self.progress_dialog:
            self.progress_dialog.setMaximum(max(total, 1))
            self.progress_dialog.setValue(current)
            self.progress_dialog.setLabelText(f"OCR: {name}\n{current} / {total}")

    def _ocr_finished(self, success: int, errors: int):
        self._set_busy(False)
        if self.progress_dialog:
            self.progress_dialog.close()
        self.refresh_media()
        QMessageBox.information(self, "OCR dokončeno", f"Zpracováno: {success}\nChyby: {errors}")

    def open_item(self, item: QListWidgetItem):
        media_id = int(item.data(Qt.ItemDataRole.UserRole))
        row = self.rows_by_id.get(media_id)
        if not row:
            return
        if row.get("kind") == "video":
            QDesktopServices.openUrl(QUrl.fromLocalFile(row["path"]))
        else:
            PreviewDialog(row, self).exec()

    def show_item_menu(self, position):
        item = self.library_view.itemAt(position)
        if not item:
            return
        media_id = int(item.data(Qt.ItemDataRole.UserRole))
        row = self.rows_by_id.get(media_id)
        if not row:
            return
        menu = QMenu(self)
        open_action = menu.addAction("Otevřít")
        folder_action = menu.addAction("Otevřít umístění")
        copy_action = menu.addAction("Kopírovat cestu")
        remove_action = menu.addAction("Odebrat pouze z indexu")
        chosen = menu.exec(self.library_view.mapToGlobal(position))
        if chosen == open_action:
            self.open_item(item)
        elif chosen == folder_action:
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(Path(row["path"]).parent)))
        elif chosen == copy_action:
            from PySide6.QtWidgets import QApplication
            QApplication.clipboard().setText(row["path"])
        elif chosen == remove_action:
            self.db.delete_media(media_id)
            self.refresh_media()

    def refresh_duplicates(self):
        groups = self.db.exact_duplicates()
        self.duplicates_table.setRowCount(0)
        for group in groups:
            for row in group:
                index = self.duplicates_table.rowCount()
                self.duplicates_table.insertRow(index)
                values = [row.get("name", ""), row.get("path", ""), row.get("kind", ""), f"{row.get('size', 0) / (1024 * 1024):.2f} MB"]
                for col, value in enumerate(values):
                    cell = QTableWidgetItem(str(value))
                    cell.setData(Qt.ItemDataRole.UserRole, row.get("path"))
                    self.duplicates_table.setItem(index, col, cell)
        self.statusBar().showMessage(f"Nalezeno skupin přesných duplicit: {len(groups)}", 5000)

    def refresh_similar_duplicates(self):
        groups = self.db.similar_duplicates(max_distance=6)
        self.duplicates_table.setRowCount(0)
        for group_index, group in enumerate(groups, start=1):
            for row in group:
                index = self.duplicates_table.rowCount()
                self.duplicates_table.insertRow(index)
                values = [row.get("name", ""), row.get("path", ""),
                          f"Podobný snímek · skupina {group_index}",
                          f"{row.get('size', 0) / (1024 * 1024):.2f} MB"]
                for col, value in enumerate(values):
                    cell = QTableWidgetItem(str(value))
                    cell.setData(Qt.ItemDataRole.UserRole, row.get("path"))
                    self.duplicates_table.setItem(index, col, cell)
        self.statusBar().showMessage(
            f"Nalezeno skupin podobných snímků: {len(groups)} (přísnost: 6/64 bitů)", 7000
        )

    def open_duplicate(self, row_index: int, column: int):
        cell = self.duplicates_table.item(row_index, 1)
        if cell:
            path = cell.text()
            if Path(path).exists():
                QDesktopServices.openUrl(QUrl.fromLocalFile(path))

    def closeEvent(self, event):
        try:
            if self.worker and self.worker.isRunning():
                if hasattr(self.worker, "cancel"):
                    self.worker.cancel()
                self.worker.wait()
            self.db.close()
        except Exception:
            pass
        event.accept()
