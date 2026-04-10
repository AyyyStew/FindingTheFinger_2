"""
ftf/parsers/yoga_sutras.py

Parser for the Project Gutenberg Yoga Sutras of Patanjali (Charles Johnston translation).
Sutras are numbered lines within 4 books. Commentary paragraphs are discarded.

Hierarchy:
    Book   depth=0  height=1
    Sutra  depth=1  height=0  (leaf)

Usage:
    from ftf.parsers.yoga_sutras import parse_yoga_sutras
    parsed = parse_yoga_sutras("data/raw/Indic_Dharmic/Hindu/yoga_sutras_of_patanjali.txt")
"""

import re

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

_BOOK_RE  = re.compile(r"^BOOK\s+(I{1,3}V?|IV)$", re.MULTILINE)
_SUTRA_RE = re.compile(r"^(\d+)\.\s+(.+?)(?=\n\n|\n\d+\.)", re.MULTILINE | re.DOTALL)
_ROMAN    = {"I": 1, "II": 2, "III": 3, "IV": 4}


def parse_yoga_sutras(txt_path: str) -> ParsedCorpus:
    with open(txt_path, encoding="utf-8") as f:
        raw = f.read()

    start = raw.find("*** START OF THE PROJECT GUTENBERG")
    end   = raw.find("*** END OF THE PROJECT GUTENBERG")
    if start != -1:
        raw = raw[raw.find("\n", start) + 1:]
    if end != -1:
        raw = raw[:end]

    book_splits = list(_BOOK_RE.finditer(raw))
    units: list[ParsedUnit] = []

    for i, book_match in enumerate(book_splits):
        book_roman = book_match.group(1).strip()
        book_num   = _ROMAN.get(book_roman, i + 1)
        book_key   = f"Book {book_roman}"

        block_start = book_match.end()
        block_end   = book_splits[i + 1].start() if i + 1 < len(book_splits) else len(raw)
        block       = raw[block_start:block_end]

        sutras = list(_SUTRA_RE.finditer(block))
        if not sutras:
            continue

        units.append(ParsedUnit(
            key=book_key,
            parent_key=None,
            depth=0,
            reference_label=f"Book {book_roman}",
        ))

        for m in sutras:
            sutra_num  = int(m.group(1))
            full_chunk = m.group(2).strip()
            # First paragraph = sutra text; rest = commentary (discarded)
            sutra_text = re.sub(r"\s+", " ", full_chunk.split("\n\n")[0]).strip()
            if not sutra_text:
                continue

            units.append(ParsedUnit(
                key=f"{book_roman}.{sutra_num}",
                parent_key=book_key,
                depth=1,
                reference_label=f"{book_num}.{sutra_num}",
                text=sutra_text,
            ))

    return ParsedCorpus(
        name="Yoga Sutras of Patanjali",
        description="Classical Hindu text on the theory and practice of yoga",
        language_of_origin="Sanskrit",
        translation_name="Charles Johnston Translation",
        translator="Charles Johnston",
        language="en",
        source=txt_path,
        levels=[
            ParsedLevel(height=1, name="Book"),
            ParsedLevel(height=0, name="Sutra"),
        ],
        units=units,
        taxonomy_hints=["Hinduism"],
    )
