"""
ftf/parsers/vendidad.py

Parser for the Vendidad / Videvdad (Darmesteter translation) from epub.
Each epub content item (content0004–content0025) is one Fargard. Verses are
<p> elements whose text starts with "N. " (verse number + period).

Hierarchy:
    Fargard  depth=0  height=1  — Vendidad 1 … Vendidad 22
    Verse    depth=1  height=0  (leaf)

Usage:
    from ftf.parsers.vendidad import parse_vendidad
    parsed = parse_vendidad("data/raw/Historical_Ancient/Persian/vendidad.epub")
"""

import re

import ebooklib
from bs4 import BeautifulSoup
from ebooklib import epub

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

_FARGARD_HDR = re.compile(r"^FARGARD\s+(\d+)\.", re.IGNORECASE)
_TITLE_RE    = re.compile(r"^FARGARD\s+\d+\.\s*([^.]+(?:\.[^A-Z][^.]+)*)\.", re.IGNORECASE)
_VERSE_RE    = re.compile(r"^(\d+)\.\s+(.+)", re.DOTALL)


def _extract_fargard(item) -> dict | None:
    soup = BeautifulSoup(item.get_content(), "html.parser")

    # Strip footnote sups
    for sup in soup.find_all("sup"):
        sup.decompose()

    full_text = soup.get_text(" ", strip=True)
    m = _FARGARD_HDR.match(full_text)
    if not m:
        return None

    fargard_num = int(m.group(1))

    # Title: text between "FARGARD N. " and the first sentence-ending period
    # before "Introduction", "Synopsis", or a long elaboration
    title_m = re.match(
        r"^FARGARD\s+\d+\.\s*(.+?)(?:\s+(?:Introduction|Synopsis)\b|\n)",
        full_text, re.IGNORECASE,
    )
    if title_m:
        title: str | None = title_m.group(1).strip().rstrip(".,") or None
    else:
        # Fallback: grab up to first period
        after = full_text[m.end():].lstrip()
        title = after.split(".")[0].strip() or None

    verses: list[tuple[int, str]] = []
    for p in soup.find_all("p"):
        text = re.sub(r"\s+", " ", p.get_text()).strip()
        vm   = _VERSE_RE.match(text)
        if vm:
            verses.append((int(vm.group(1)), vm.group(2).strip()))

    return {"fargard_num": fargard_num, "title": title, "verses": verses}


def parse_vendidad(epub_path: str) -> ParsedCorpus:
    book  = epub.read_epub(epub_path)
    items = list(book.get_items_of_type(ebooklib.ITEM_DOCUMENT))

    fargards: list[dict] = []
    for item in items:
        if not item.get_name().startswith("text/content"):
            continue
        result = _extract_fargard(item)
        if result and result["verses"]:
            fargards.append(result)

    fargards.sort(key=lambda f: f["fargard_num"])

    units: list[ParsedUnit] = []

    for fg in fargards:
        fg_num = fg["fargard_num"]
        fg_key = f"Vendidad {fg_num}"

        extra: dict = {}
        if fg["title"]:
            extra["title"] = fg["title"]

        units.append(ParsedUnit(
            key=fg_key,
            parent_key=None,
            depth=0,
            reference_label=fg_key,
            extra_metadata=extra,
        ))

        for verse_num, verse_text in fg["verses"]:
            units.append(ParsedUnit(
                key=f"{fg_key}:{verse_num}",
                parent_key=fg_key,
                depth=1,
                reference_label=f"Vendidad {fg_num}:{verse_num}",
                text=verse_text,
            ))

    return ParsedCorpus(
        name="Vendidad",
        description="Zoroastrian law code — myths, purity laws, and rituals against evil",
        language_of_origin="Avestan",
        translation_name="James Darmesteter Translation",
        translator="James Darmesteter",
        language="en",
        source=epub_path,
        levels=[
            ParsedLevel(height=1, name="Fargard"),
            ParsedLevel(height=0, name="Verse"),
        ],
        units=units,
        taxonomy_hints=["Zoroastrianism"],
    )
