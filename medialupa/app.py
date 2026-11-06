from __future__ import annotations

import sys
from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QFont

from .ui import MainWindow


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("MediaLupa")
    app.setOrganizationName("MediaLupa")
    app.setFont(QFont("Segoe UI", 10))
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
