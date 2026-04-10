"""
ftf/parsers/bible.py

Parser for the Scrollmapper SQLite Bible format.
Handles KJV, ACV, YLT, BBE — all share the same schema:

    {TRANSLATION}_books  (id, name)
    {TRANSLATION}_verses (book_id, chapter, verse, text)

Old and New Testament are parsed as separate corpora so they can be linked
to different taxonomy nodes (OT → Judaism + Christianity; NT → Christianity).

Hierarchy produced (height 0 = leaf):
    Book     depth=0  height=2
    Chapter  depth=1  height=1
    Verse    depth=2  height=0

Usage:
    from ftf.parsers.bible import parse_old_testament, parse_new_testament
    ot = parse_old_testament("KJV", "data/raw/Abrahamic/Christian/Bibles/KJV.db")
    nt = parse_new_testament("KJV", "data/raw/Abrahamic/Christian/Bibles/KJV.db")
"""

import sqlite3

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

TRANSLATION_META: dict[str, dict] = {
    "KJV": {
        "full_name":  "King James Version",
        "translator": "Various (royal commission)",
        "year":       1611,
    },
    "ACV": {
        "full_name":  "A Conservative Version",
        "translator": "Walter L. Porter",
        "year":       2005,
    },
    "YLT": {
        "full_name":  "Young's Literal Translation",
        "translator": "Robert Young",
        "year":       1898,
    },
    "BBE": {
        "full_name":  "Bible in Basic English",
        "translator": "S. H. Hooke",
        "year":       1949,
    },
}

# Scrollmapper book IDs: 1–39 = Old Testament, 40–66 = New Testament
_OT_BOOK_IDS = set(range(1, 40))
_NT_BOOK_IDS = set(range(40, 67))


def _parse_testament(
    translation: str,
    db_path: str,
    book_ids: set[int],
    corpus_name: str,
    description: str,
    language_of_origin: str,
    taxonomy_hints: list[str],
) -> ParsedCorpus:
    meta = TRANSLATION_META.get(translation.upper(), {})
    t    = translation.upper()

    conn = sqlite3.connect(db_path)
    rows = conn.execute(f"""
        SELECT b.id, b.name, v.chapter, v.verse, v.text
        FROM {t}_verses v
        JOIN {t}_books b ON v.book_id = b.id
        WHERE b.id IN ({",".join("?" * len(book_ids))})
        ORDER BY b.id, v.chapter, v.verse
    """, sorted(book_ids)).fetchall()
    conn.close()

    units: list[ParsedUnit] = []
    seen_books:    set[str]   = set()
    seen_chapters: set[tuple] = set()

    for _book_id, book_name, chapter, verse, text in rows:
        if not text or not text.strip():
            continue

        book_key    = book_name
        chapter_key = f"{book_name} {chapter}"
        verse_key   = f"{book_name} {chapter}:{verse}"

        if book_key not in seen_books:
            units.append(ParsedUnit(
                key=book_key,
                parent_key=None,
                depth=0,
                reference_label=book_name,
            ))
            seen_books.add(book_key)

        if (book_name, chapter) not in seen_chapters:
            units.append(ParsedUnit(
                key=chapter_key,
                parent_key=book_key,
                depth=1,
                reference_label=chapter_key,
            ))
            seen_chapters.add((book_name, chapter))

        units.append(ParsedUnit(
            key=verse_key,
            parent_key=chapter_key,
            depth=2,
            reference_label=verse_key,
            text=text.strip(),
            uncleaned_text=text,
        ))

    full_name = meta.get("full_name", translation)

    return ParsedCorpus(
        name=corpus_name,
        description=description,
        language_of_origin=language_of_origin,
        translation_name=full_name,
        translator=meta.get("translator"),
        language="en",
        source=db_path,
        levels=[
            ParsedLevel(height=2, name="Book"),
            ParsedLevel(height=1, name="Chapter"),
            ParsedLevel(height=0, name="Verse"),
        ],
        units=units,
        taxonomy_hints=taxonomy_hints,
    )


def parse_old_testament(translation: str, db_path: str) -> ParsedCorpus:
    return _parse_testament(
        translation=translation,
        db_path=db_path,
        book_ids=_OT_BOOK_IDS,
        corpus_name="Old Testament",
        description=(
            "The Hebrew scriptures — Torah, Prophets, and Writings — "
            "foundational to both Judaism and Christianity"
        ),
        language_of_origin="Hebrew / Aramaic",
        taxonomy_hints=["Judaism", "Christianity"],
    )


def parse_new_testament(translation: str, db_path: str) -> ParsedCorpus:
    return _parse_testament(
        translation=translation,
        db_path=db_path,
        book_ids=_NT_BOOK_IDS,
        corpus_name="New Testament",
        description=(
            "The Greek scriptures of the Christian faith — "
            "life and teachings of Jesus Christ and the early church"
        ),
        language_of_origin="Greek (Koine)",
        taxonomy_hints=["Christianity"],
    )
