"""
ftf/parsers/analects.py

Parser for the Project Gutenberg Analects of Confucius (James Legge translation).
20 Books; within each book, individual chapters (CHAP. / CHAPTER headings) are
the leaf units. Parsing logic ported from v1/db/ingest.py (ingest_analects),
replacing sentence chunking with natural chapter units.

Hierarchy:
    Book     depth=0  height=1  — Book I … Book XX
    Chapter  depth=1  height=0  (leaf)

Usage:
    from ftf.parsers.analects import parse_analects
    parsed = parse_analects("data/raw/East Asian/Confucianism/analects_confucian.txt")
"""

import re

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

_BOOK_RE  = re.compile(r"^BOOK\s+([IVXLC]+)\.\s+(.+)$", re.MULTILINE)
_CHAP_RE  = re.compile(r"CHAP(?:TER)?\.\s+([IVXLC]+)\.")

_ROMAN: dict[str, int] = {
    "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5,
    "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10,
    "XI": 11, "XII": 12, "XIII": 13, "XIV": 14, "XV": 15,
    "XVI": 16, "XVII": 17, "XVIII": 18, "XIX": 19, "XX": 20,
    "XXI": 21, "XXII": 22, "XXIII": 23, "XXIV": 24, "XXV": 25,
    "XXVI": 26, "XXVII": 27, "XXVIII": 28, "XXIX": 29, "XXX": 30,
}


def parse_analects(txt_path: str) -> ParsedCorpus:
    with open(txt_path, encoding="utf-8-sig") as f:
        raw = f.read()

    start = raw.find("*** START OF THE PROJECT GUTENBERG")
    end   = raw.find("*** END OF THE PROJECT GUTENBERG")
    if start != -1:
        raw = raw[raw.find("\n", start) + 1:]
    if end != -1:
        raw = raw[:end]

    book_matches = list(_BOOK_RE.finditer(raw))
    units: list[ParsedUnit] = []

    for i, bm in enumerate(book_matches):
        book_roman = bm.group(1)
        book_title = bm.group(2).strip().rstrip(".")
        book_key   = f"Book {book_roman}"

        block_start = bm.end()
        block_end   = book_matches[i + 1].start() if i + 1 < len(book_matches) else len(raw)
        block       = raw[block_start:block_end]

        chap_matches = list(_CHAP_RE.finditer(block))
        if not chap_matches:
            continue

        units.append(ParsedUnit(
            key=book_key,
            parent_key=None,
            depth=0,
            reference_label=book_key,
            extra_metadata={"title": book_title},
        ))

        for j, cm in enumerate(chap_matches):
            chap_roman = cm.group(1)
            chap_num   = _ROMAN.get(chap_roman, j + 1)

            text_start = cm.end()
            text_end   = chap_matches[j + 1].start() if j + 1 < len(chap_matches) else len(block)
            text       = re.sub(r"\s+", " ", block[text_start:text_end]).strip()

            if not text:
                continue

            units.append(ParsedUnit(
                key=f"{book_key}.{chap_roman}",
                parent_key=book_key,
                depth=1,
                reference_label=f"{_ROMAN.get(book_roman, i+1)}.{chap_num}",
                text=text,
            ))

    return ParsedCorpus(
        name="Analects of Confucius",
        description="Collection of sayings and ideas attributed to Confucius and his disciples",
        language_of_origin="Classical Chinese",
        translation_name="James Legge Translation",
        translator="James Legge",
        language="en",
        source=txt_path,
        levels=[
            ParsedLevel(height=1, name="Book"),
            ParsedLevel(height=0, name="Chapter"),
        ],
        units=units,
        taxonomy_hints=["Confucianism"],
    )
