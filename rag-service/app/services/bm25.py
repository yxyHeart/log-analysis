import os
import pickle
import re

import jieba
from rank_bm25 import BM25Okapi


def _tokenize(text: str) -> list[str]:
    """Mixed tokenization: jieba for Chinese, whitespace for English."""
    tokens = []
    # Split into Chinese and non-Chinese segments
    segments = re.split(r"([一-鿿]+)", text)
    for seg in segments:
        if re.match(r"[一-鿿]", seg):
            tokens.extend(jieba.lcut(seg))
        else:
            tokens.extend(seg.lower().split())
    return [t.strip() for t in tokens if t.strip()]


class BM25Service:
    def __init__(self, storage_path: str = "./chroma_data/bm25_index.pkl"):
        self.storage_path = storage_path
        self.chunks: list[str] = []
        self.metadatas: list[dict] = []
        self.ids: list[str] = []
        self.index: BM25Okapi | None = None
        self._load_index()

    def _load_index(self):
        if os.path.exists(self.storage_path):
            with open(self.storage_path, "rb") as f:
                data = pickle.load(f)
                self.chunks = data.get("chunks", [])
                self.metadatas = data.get("metadatas", [])
                self.ids = data.get("ids", [])
            if self.chunks:
                self._rebuild_index()

    def _rebuild_index(self):
        tokenized_corpus = [_tokenize(c) for c in self.chunks]
        self.index = BM25Okapi(tokenized_corpus)

    def _save_index(self):
        os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)
        data = {
            "chunks": self.chunks,
            "metadatas": self.metadatas,
            "ids": self.ids,
        }
        with open(self.storage_path, "wb") as f:
            pickle.dump(data, f)

    def add_chunks(self, texts: list[str], metadatas: list[dict], ids: list[str]):
        self.chunks.extend(texts)
        self.metadatas.extend(metadatas)
        self.ids.extend(ids)
        self._rebuild_index()
        self._save_index()

    def remove_chunks(self, chunk_ids: list[str]):
        id_set = set(chunk_ids)
        keep = [(i, cid) for i, cid in enumerate(self.ids) if cid not in id_set]
        self.chunks = [self.chunks[i] for i, _ in keep]
        self.metadatas = [self.metadatas[i] for i, _ in keep]
        self.ids = [cid for _, cid in keep]
        if self.chunks:
            self._rebuild_index()
        else:
            self.index = None
        self._save_index()

    def rebuild_from_collection(self, collection):
        """Rebuild BM25 index from an existing ChromaDB collection."""
        if collection.count() == 0:
            return
        all_data = collection.get(include=["documents", "metadatas"])
        self.chunks = all_data["documents"] or []
        self.metadatas = all_data["metadatas"] or []
        self.ids = all_data["ids"] or []
        if self.chunks:
            self._rebuild_index()
        self._save_index()

    def search(self, query: str, top_k: int = 50) -> list[dict]:
        if not self.index or not self.chunks:
            return []
        tokenized_query = _tokenize(query)
        scores = self.index.get_scores(tokenized_query)
        results = []
        for i, score in enumerate(scores):
            results.append({
                "id": self.ids[i],
                "chunk_text": self.chunks[i],
                "metadata": self.metadatas[i],
                "score": float(score),
                "retriever": "bm25",
            })
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]
