"""
ftf/parsers/diamond_sutra.py

Parser for the Project Gutenberg Diamond Sutra (William Gemmell translation).
Chapters are marked with [Chapter N] tags. No sub-verses exist — each chapter
is a continuous prose block and is the leaf unit.

Hierarchy:
    Chapter  depth=0  height=0  (leaf)

Usage:
    from ftf.parsers.diamond_sutra import parse_diamond_sutra
    parsed = parse_diamond_sutra("data/raw/Indic_Dharmic/Buddhist/diamond_sutra.txt")
"""

import re

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

_CHAPTER_RE  = re.compile(r"^\[Chapter\s+(.+?)\]", re.MULTILINE)
_FOOTNOTE_RE = re.compile(r"\[\d+\]")


def parse_diamond_sutra(txt_path: str) -> ParsedCorpus:
    with open(txt_path, encoding="utf-8") as f:
        raw = f.read()

    start = raw.find("*** START OF THE PROJECT GUTENBERG")
    end   = raw.find("*** END OF THE PROJECT GUTENBERG")
    if start != -1:
        raw = raw[raw.find("\n", start) + 1:]
    if end != -1:
        raw = raw[:end]

    splits = list(_CHAPTER_RE.finditer(raw))
    units: list[ParsedUnit] = []

    for i, match in enumerate(splits):
        label = match.group(1).strip()   # "1", "3 and 4", etc.

        block_start = match.end()
        block_end   = splits[i + 1].start() if i + 1 < len(splits) else len(raw)
        block       = raw[block_start:block_end]

        # Strip footnote markers and collapse whitespace
        text = _FOOTNOTE_RE.sub("", block)
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue

        units.append(ParsedUnit(
            key=f"Chapter {label}",
            parent_key=None,
            depth=0,
            reference_label=f"Chapter {label}",
            text=text,
        ))

    return ParsedCorpus(
        name="Diamond Sutra",
        description="The Diamond Sutra (Prajna-Paramita), a key Mahayana Buddhist text",
        language_of_origin="Sanskrit",
        translation_name="William Gemmell Translation",
        translator="William Gemmell",
        language="en",
        source=txt_path,
        levels=[
            ParsedLevel(height=0, name="Chapter"),
        ],
        units=units,
        taxonomy_hints=["Buddhism"],
    )
