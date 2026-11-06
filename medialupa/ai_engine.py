from __future__ import annotations

import numpy as np
from PIL import Image, ImageOps

# The image encoder is the original CLIP model; the multilingual text encoder
# is distilled into the same vector space and supports Czech and 50+ languages.
IMAGE_MODEL_ID = "sentence-transformers/clip-ViT-B-32"
TEXT_MODEL_ID = "sentence-transformers/clip-ViT-B-32-multilingual-v1"
LABELS = [
    "people", "family", "child", "baby", "dog", "cat", "horse", "bird", "fish",
    "wild animal", "car", "motorcycle", "bicycle", "airplane", "train", "boat",
    "mountain", "forest", "beach", "sea", "lake", "river", "sunset", "city",
    "building", "interior", "food", "drink", "flower", "garden", "snow", "sport",
    "concert", "wedding", "birthday party", "holiday", "travel", "document", "screenshot",
    "painting", "night sky", "street", "architecture", "computer", "phone", "selfie",
]


class AIUnavailable(RuntimeError):
    pass


class ClipEngine:
    """Offline CLIP retrieval: original image encoder + multilingual text encoder."""

    def __init__(self):
        self.image_model = None
        self.text_model = None

    def load(self, progress=None):
        if self.image_model is not None and self.text_model is not None:
            return
        try:
            from sentence_transformers import SentenceTransformer
        except Exception as exc:
            raise AIUnavailable(
                "AI modul není nainstalovaný. Ve složce aplikace spusť INSTALL_AI.bat."
            ) from exc
        if progress:
            progress("Načítám CLIP a český vícejazyčný textový model (při prvním spuštění se stáhnou)...")
        self.image_model = SentenceTransformer(IMAGE_MODEL_ID, device="cpu")
        self.text_model = SentenceTransformer(TEXT_MODEL_ID, device="cpu")

    def _encode_image(self, image: Image.Image) -> np.ndarray:
        self.load()
        vector = self.image_model.encode(
            [image], convert_to_numpy=True, normalize_embeddings=True,
            show_progress_bar=False,
        )[0]
        return np.asarray(vector, dtype=np.float32).reshape(-1)

    def _encode_texts(self, texts: list[str]) -> np.ndarray:
        self.load()
        vectors = self.text_model.encode(
            texts, convert_to_numpy=True, normalize_embeddings=True,
            show_progress_bar=False,
        )
        return np.asarray(vectors, dtype=np.float32)

    def image_embedding(self, image_path: str) -> np.ndarray:
        image = Image.open(image_path)
        image = ImageOps.exif_transpose(image).convert("RGB")
        return self._encode_image(image)

    def text_embedding(self, query: str) -> np.ndarray:
        return self._encode_texts([query])[0]

    def analyze(self, image_path: str, progress=None) -> tuple[str, list[str], bytes]:
        embedding = self.image_embedding(image_path)
        prompts = [f"a photo of {label}" for label in LABELS]
        text_vectors = self._encode_texts(prompts)
        scores = text_vectors @ embedding
        best = np.argsort(scores)[::-1][:4]
        tags = [LABELS[int(i)] for i in best if float(scores[int(i)]) > 0.19]
        caption = tags[0] if tags else "unclassified"
        return caption, tags, embedding.astype(np.float32).tobytes()

    def search(self, query: str, rows: list[dict], top_k: int = 500) -> list[int]:
        query_vector = self.text_embedding(query)
        scored: list[tuple[float, int]] = []
        for row in rows:
            raw = row.get("embedding")
            if not raw:
                continue
            vector = np.frombuffer(raw, dtype=np.float32)
            if vector.size != query_vector.size:
                continue
            scored.append((float(np.dot(query_vector, vector)), int(row["id"])))
        scored.sort(reverse=True)
        return [media_id for _, media_id in scored[:top_k]]
