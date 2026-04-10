"""
ftf/parsers/quran.py

Parser for "The Quran Dataset" CSV.

Columns used:
    surah_no, surah_name_en, surah_name_roman, ayah_no_surah, ayah_ar, ayah_en

Hierarchy:
    Surah   depth=0  height=1
    Ayah    depth=1  height=0  (leaf)

Usage:
    from ftf.parsers.quran import parse_quran
    parsed = parse_quran("data/raw/Abrahamic/Islamic/The Quran Dataset.csv")
"""

import csv

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit


def parse_quran(csv_path: str) -> ParsedCorpus:
    units: list[ParsedUnit] = []
    seen_surahs: set[int] = set()

    with open(csv_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            surah_no   = int(row["surah_no"])
            surah_en   = row["surah_name_en"].strip()
            surah_roman = row["surah_name_roman"].strip()
            ayah_no    = int(row["ayah_no_surah"])
            ayah_ar    = row["ayah_ar"].strip()
            ayah_en    = row["ayah_en"].strip()

            if not ayah_en:
                continue

            surah_key = f"Surah {surah_no}"
            ayah_key  = f"Surah {surah_no}:{ayah_no}"

            if surah_no not in seen_surahs:
                units.append(ParsedUnit(
                    key=surah_key,
                    parent_key=None,
                    depth=0,
                    reference_label=f"{surah_no}. {surah_en} ({surah_roman})",
                ))
                seen_surahs.add(surah_no)

            units.append(ParsedUnit(
                key=ayah_key,
                parent_key=surah_key,
                depth=1,
                reference_label=f"{surah_no}:{ayah_no}",
                text=ayah_en,
                uncleaned_text=ayah_ar,
            ))

    return ParsedCorpus(
        name="Quran",
        description="The Holy Quran",
        language_of_origin="Arabic",
        translation_name="Clear Quran",
        translator="Dr. Mustafa Khattab",
        language="en",
        source=csv_path,
        levels=[
            ParsedLevel(height=1, name="Surah"),
            ParsedLevel(height=0, name="Ayah"),
        ],
        units=units,
        taxonomy_hints=["Islam"],
    )
