from pathlib import Path
from platformdirs import user_data_dir

APP_NAME = "MediaLupa"
APP_AUTHOR = "MediaLupa"
DATA_DIR = Path(user_data_dir(APP_NAME, APP_AUTHOR))
DB_PATH = DATA_DIR / "medialupa.sqlite3"
THUMB_DIR = DATA_DIR / "thumbnails"
LOG_DIR = DATA_DIR / "logs"

for _path in (DATA_DIR, THUMB_DIR, LOG_DIR):
    _path.mkdir(parents=True, exist_ok=True)

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".heic", ".heif"
}
VIDEO_EXTENSIONS = {
    ".mp4", ".mkv", ".mov", ".avi", ".wmv", ".webm", ".m4v", ".3gp", ".mts", ".m2ts"
}
SUPPORTED_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
