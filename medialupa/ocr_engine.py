from pathlib import Path


def read_text(image_path: str) -> str:
    try:
        import pytesseract
        from PIL import Image, ImageOps
    except Exception as exc:
        raise RuntimeError("OCR modul není nainstalovaný. Spusť INSTALL_OCR.bat a nainstaluj Tesseract OCR.") from exc
    image = ImageOps.exif_transpose(Image.open(Path(image_path))).convert("RGB")
    return pytesseract.image_to_string(image, lang="ces+eng").strip()
