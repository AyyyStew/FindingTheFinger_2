"""
ftf/parsers/bhagavatam.py

Parser for the Srimad Bhagavatam CSV.

Columns: canto_number, canto_title, chapter_number, chapter_title, text, translation

Hierarchy:
    Canto    depth=0  height=2
    Chapter  depth=1  height=1
    Text     depth=2  height=0  (leaf)

Usage:
    from ftf.parsers.bhagavatam import parse_bhagavatam
    parsed = parse_bhagavatam("data/raw/Indic_Dharmic/Hindu/Srimad_Bhagavatam_Data.csv")
"""

import csv
import re

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit


def _extract_num(s: str) -> int | None:
    m = re.search(r"\d+", s)
    return int(m.group()) if m else None


def parse_bhagavatam(csv_path: str) -> ParsedCorpus:
    units: list[ParsedUnit] = []
    seen_cantos:    set[int]        = set()
    seen_chapters:  set[tuple]      = set()
    verse_counters: dict[tuple, int] = {}

    with open(csv_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            canto_str   = row["canto_number"].strip()    # "Canto 1"
            canto_title = row["canto_title"].strip()
            ch_str      = row["chapter_number"].strip()  # "Chapter 1"
            ch_title    = row["chapter_title"].strip()
            translation = row["translation"].strip()

            if not translation:
                continue

            canto_num = _extract_num(canto_str)
            ch_num    = _extract_num(ch_str)
            if canto_num is None or ch_num is None:
                continue

            canto_key   = f"Canto {canto_num}"
            chapter_key = f"Canto {canto_num} Chapter {ch_num}"
            ch_pair     = (canto_num, ch_num)

            if canto_num not in seen_cantos:
                units.append(ParsedUnit(
                    key=canto_key,
                    parent_key=None,
                    depth=0,
                    reference_label=f"Canto {canto_num}: {canto_title}",
                ))
                seen_cantos.add(canto_num)

            if ch_pair not in seen_chapters:
                units.append(ParsedUnit(
                    key=chapter_key,
                    parent_key=canto_key,
                    depth=1,
                    reference_label=f"{canto_num}.{ch_num}: {ch_title}",
                ))
                seen_chapters.add(ch_pair)
                verse_counters[ch_pair] = 0

            verse_counters[ch_pair] += 1
            verse_num = verse_counters[ch_pair]
            verse_key = f"{chapter_key} Text {verse_num}"

            units.append(ParsedUnit(
                key=verse_key,
                parent_key=chapter_key,
                depth=2,
                reference_label=f"{canto_num}.{ch_num}.{verse_num}",
                text=translation,
            ))

    return ParsedCorpus(
        name="Srimad Bhagavatam",
        description="The Srimad Bhagavatam (Bhagavata Purana)",
        language_of_origin="Sanskrit",
        translation_name="Prabhupada Translation",
        translator="A.C. Bhaktivedanta Swami Prabhupada",
        language="en",
        source=csv_path,
        levels=[
            ParsedLevel(height=2, name="Canto"),
            ParsedLevel(height=1, name="Chapter"),
            ParsedLevel(height=0, name="Text"),
        ],
        units=units,
        taxonomy_hints=["Hinduism"],
    )
