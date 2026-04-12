"""
pipeline/sources/catalog.py

Loader for canonical source mappings in data/sources.json.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

CatalogKey = tuple[str, str | None]


@dataclass(frozen=True)
class SourceCatalogEntry:
    corpus: str
    translation: str | None
    source_key: str
    url: str
    provider: str | None = None
    label: str | None = None


def _catalog_path() -> Path:
    # /repo/pipeline/pipeline/sources/catalog.py -> /repo/data/sources.json
    return Path(__file__).resolve().parents[3] / "data" / "sources.json"


def _normalize(v: str | None) -> str | None:
    if v is None:
        return None
    s = v.strip()
    return s if s else None


def _default_source_key(corpus: str, translation: str | None) -> str:
    base = corpus if translation is None else f"{corpus}-{translation}"
    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in base)
    slug = "-".join(part for part in slug.split("-") if part)
    return slug or "source"


@lru_cache(maxsize=1)
def _catalog_map() -> dict[CatalogKey, SourceCatalogEntry]:
    path = _catalog_path()
    if not path.exists():
        raise RuntimeError(
            f"Canonical source catalog not found: {path}. "
            "Create data/sources.json before ingesting."
        )

    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise RuntimeError("data/sources.json must be a JSON array")

    out: dict[CatalogKey, SourceCatalogEntry] = {}
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise RuntimeError(f"data/sources.json item #{i} must be an object")

        corpus = _normalize(item.get("corpus"))
        translation = _normalize(item.get("translation"))
        url = _normalize(item.get("url"))
        source_key = _normalize(item.get("source_key")) or _default_source_key(corpus or "", translation)

        if not corpus:
            raise RuntimeError(f"data/sources.json item #{i} missing 'corpus'")
        if not url:
            raise RuntimeError(f"data/sources.json item #{i} missing 'url'")

        key = (corpus, translation)
        if key in out:
            raise RuntimeError(f"Duplicate source mapping for corpus/translation key: {key}")

        out[key] = SourceCatalogEntry(
            corpus=corpus,
            translation=translation,
            source_key=source_key,
            url=url,
            provider=_normalize(item.get("provider")),
            label=_normalize(item.get("label")),
        )
    return out


def get_source_entry(corpus: str, translation: str | None) -> SourceCatalogEntry:
    key = (_normalize(corpus) or "", _normalize(translation))
    entry = _catalog_map().get(key)
    if entry is None:
        raise KeyError(
            f"No source mapping for corpus={key[0]!r}, translation={key[1]!r} "
            "in data/sources.json"
        )
    return entry
