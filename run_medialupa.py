"""PyInstaller entry point for the MediaLupa desktop application."""

from medialupa.app import main


if __name__ == "__main__":
    raise SystemExit(main())
