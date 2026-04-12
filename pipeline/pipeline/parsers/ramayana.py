"""Parser for Ramayana JSON dataset."""

from __future__ import annotations

import json
from pathlib import Path

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit


_KANDA_ORDER = [
    "BalaKanda",
    "AyodhyaKanda",
    "AranyaKanda",
    "KishkindhaKanda",
    "SundaraKanda",
    "YuddhaKanda",
]


def _clean(s: str | None) -> str:
    if not s:
        return ""
    return " ".join(s.replace("\xa0", " ").split())


def parse_ramayana(ramayana_dir: str) -> ParsedCorpus:
    base = Path(ramayana_dir)
    data_dir = base / "data"

    units: list[ParsedUnit] = []

    for kanda in _KANDA_ORDER:
        path = data_dir / f"{kanda}.json"
        if not path.exists():
            continue

        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            continue

        k_key = f"{kanda}"
        units.append(
            ParsedUnit(
                key=k_key,
                parent_key=None,
                depth=0,
                reference_label=kanda,
            )
        )

        seen_chapters: set[str] = set()

        for item in raw:
            if not isinstance(item, dict):
                continue

            chapter = _clean(str(item.get("chapter", "")))
            verse = _clean(str(item.get("verse", "")))
            text = _clean(item.get("translation"))
            word_dict = _clean(item.get("wordDictionary"))
            if not chapter or not verse or not text:
                continue

            ch_key = f"{k_key}:ch{chapter}"
            if ch_key not in seen_chapters:
                units.append(
                    ParsedUnit(
                        key=ch_key,
                        parent_key=k_key,
                        depth=1,
                        reference_label=f"{kanda} Chapter {chapter}",
                    )
                )
                seen_chapters.add(ch_key)

            units.append(
                ParsedUnit(
                    key=f"{ch_key}:v{verse}",
                    parent_key=ch_key,
                    depth=2,
                    reference_label=f"{chapter}.{verse}",
                    text=text,
                    extra_metadata={"word_dictionary": word_dict} if word_dict else {},
                )
            )

    return ParsedCorpus(
        name="Ramayana",
        description="Valmiki Ramayana in English translation",
        language_of_origin="Sanskrit",
        translation_name="Valmiki Ramayana Project Translation",
        translator="ValmikiRamayan.net",
        language="en",
        source=str(base),
        levels=[
            ParsedLevel(height=2, name="Kanda"),
            ParsedLevel(height=1, name="Chapter"),
            ParsedLevel(height=0, name="Verse"),
        ],
        units=units,
        taxonomy_hints=["Hinduism"],
    )
