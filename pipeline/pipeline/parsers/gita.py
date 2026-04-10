"""
ftf/parsers/gita.py

Parser for the Bhagavad Gita CSV.

Columns: chapter_number, chapter_title, chapter_verse, translation

Hierarchy:
    Chapter  depth=0  height=1
    Verse    depth=1  height=0  (leaf)

Usage:
    from ftf.parsers.gita import parse_gita
    parsed = parse_gita("data/raw/Indic_Dharmic/Hindu/bhagavad_gita_verses.csv")
"""

import csv
import re

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit


def parse_gita(csv_path: str) -> ParsedCorpus:
    units: list[ParsedUnit] = []
    seen_chapters: set[int] = set()

    with open(csv_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            chapter_str   = row["chapter_number"].strip()   # "Chapter 1"
            chapter_title = row["chapter_title"].strip()
            verse_label   = row["chapter_verse"].strip()     # "1.1" or "1.4 – 1.6"
            text          = row["translation"].strip()

            if not text:
                continue

            # Extract chapter number from "Chapter 1"
            m = re.search(r"\d+", chapter_str)
            if not m:
                continue
            chapter_num = int(m.group())

            chapter_key = f"Chapter {chapter_num}"
            verse_key   = f"{chapter_num}.{verse_label.split('.')[-1].split('–')[0].strip()}"

            if chapter_num not in seen_chapters:
                units.append(ParsedUnit(
                    key=chapter_key,
                    parent_key=None,
                    depth=0,
                    reference_label=f"Chapter {chapter_num}: {chapter_title}",
                ))
                seen_chapters.add(chapter_num)

            units.append(ParsedUnit(
                key=verse_key,
                parent_key=chapter_key,
                depth=1,
                reference_label=verse_label,
                text=text,
            ))

    return ParsedCorpus(
        name="Bhagavad Gita",
        description="The Bhagavad Gita — dialogue between Arjuna and Krishna",
        language_of_origin="Sanskrit",
        translation_name="Swami Mukundananda Translation",
        translator="Swami Mukundananda",
        language="en",
        source=csv_path,
        levels=[
            ParsedLevel(height=1, name="Chapter"),
            ParsedLevel(height=0, name="Verse"),
        ],
        units=units,
        taxonomy_hints=["Hinduism"],
    )
