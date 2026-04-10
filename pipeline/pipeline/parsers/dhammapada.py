"""
ftf/parsers/dhammapada.py

Parser for the Project Gutenberg Dhammapada (F. Max Müller translation).

Hierarchy:
    Chapter  depth=0  height=1
    Verse    depth=1  height=0  (leaf)

Usage:
    from ftf.parsers.dhammapada import parse_dhammapada
    parsed = parse_dhammapada("data/raw/Indic_Dharmic/Buddhist/dhammapada.txt")
"""

import re

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

_CHAPTER_RE = re.compile(r"^Chapter\s+([IVXLC]+)[:\.]?\s+(.+)$", re.MULTILINE)
_VERSE_RE   = re.compile(r"^\d+\.", re.MULTILINE)
_ROMAN      = {"I":1,"V":5,"X":10,"L":50,"C":100}


def _roman_to_int(s: str) -> int:
    val, prev = 0, 0
    for ch in reversed(s.upper()):
        v = _ROMAN.get(ch, 0)
        val += v if v >= prev else -v
        prev = v
    return val


def parse_dhammapada(txt_path: str) -> ParsedCorpus:
    with open(txt_path, encoding="utf-8") as f:
        raw = f.read()

    # Strip Gutenberg header/footer
    start = raw.find("*** START OF THE PROJECT GUTENBERG")
    end   = raw.find("*** END OF THE PROJECT GUTENBERG")
    if start != -1:
        raw = raw[raw.find("\n", start) + 1:]
    if end != -1:
        raw = raw[:end]

    chapter_splits = list(_CHAPTER_RE.finditer(raw))
    units: list[ParsedUnit] = []

    for i, ch in enumerate(chapter_splits):
        chapter_num   = _roman_to_int(ch.group(1))
        chapter_title = ch.group(2).strip()
        chapter_key   = f"Chapter {chapter_num}"

        block_start = ch.end()
        block_end   = chapter_splits[i + 1].start() if i + 1 < len(chapter_splits) else len(raw)
        block       = raw[block_start:block_end]

        verse_starts = [m.start() for m in _VERSE_RE.finditer(block)]
        if not verse_starts:
            continue

        units.append(ParsedUnit(
            key=chapter_key,
            parent_key=None,
            depth=0,
            reference_label=f"Chapter {chapter_num}: {chapter_title}",
        ))

        for j, vs in enumerate(verse_starts):
            ve    = verse_starts[j + 1] if j + 1 < len(verse_starts) else len(block)
            chunk = block[vs:ve].strip()
            dot   = chunk.index(".")
            try:
                verse_num = int(chunk[:dot].strip())
            except ValueError:
                continue
            text = re.sub(r"\s*\n\s*", " ", chunk[dot + 1:]).strip()
            if not text:
                continue

            units.append(ParsedUnit(
                key=f"{chapter_num}.{verse_num}",
                parent_key=chapter_key,
                depth=1,
                reference_label=f"{chapter_num}.{verse_num}",
                text=text,
            ))

    return ParsedCorpus(
        name="Dhammapada",
        description="A collection of verses from the Pali Canon",
        language_of_origin="Pali",
        translation_name="F. Max Müller Translation",
        translator="F. Max Müller",
        language="en",
        source=txt_path,
        levels=[
            ParsedLevel(height=1, name="Chapter"),
            ParsedLevel(height=0, name="Verse"),
        ],
        units=units,
        taxonomy_hints=["Buddhism"],
    )
