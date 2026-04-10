"""
ftf/parsers/yasna.py

Parser for the Yasna (Mills translation) from the sacred-texts.com HTML file.
Chapters are delimited by <H2 id="yN"> tags. Verses are <p> paragraphs
starting with "N. " within each chapter block. Chapter y0 (Introduction) is
skipped per v2 convention.

Hierarchy:
    Chapter  depth=0  height=1  — Yasna 1 … Yasna 72
    Verse    depth=1  height=0  (leaf)

Usage:
    from ftf.parsers.yasna import parse_yasna
    parsed = parse_yasna("data/raw/Historical_Ancient/Persian/AVESTA_ YASNA_ (English).html")
"""

import re

from bs4 import BeautifulSoup, Tag

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

# Chapters that are Gatha hymns
_GATHA_CHAPTERS = frozenset(range(28, 35)) | frozenset(range(43, 52)) | {53}

_VERSE_RE = re.compile(r"^(\d+)\.\s+(.+)", re.DOTALL)
_CHAP_ID  = re.compile(r"^y(\d+)$")


def _chapter_title(h2: Tag) -> str | None:
    """Extract optional title from heading like '12. The Zoroastrian Creed.'"""
    text = h2.get_text(" ", strip=True)
    m = re.match(r"^\d+\.\s+(.+)", text)
    return m.group(1).strip() if m else None


def _extract_verses(soup_chunk: list[Tag]) -> list[tuple[int, str]]:
    """
    From a flat list of tags between two chapter headings, extract
    (verse_num, text) pairs from <p> elements that start with 'N. '.
    """
    verses: list[tuple[int, str]] = []
    for tag in soup_chunk:
        if tag.name != "p":
            continue
        # Strip footnote links and sup tags
        for s in tag.find_all(["sup", "a"]):
            href = s.get("href", "")
            if s.name == "sup" or (s.name == "a" and ("#fn" in href or "foot" in href.lower())):
                s.decompose()
        text = re.sub(r"\s+", " ", tag.get_text()).strip()
        m = _VERSE_RE.match(text)
        if m:
            verses.append((int(m.group(1)), m.group(2).strip()))
    return verses


def parse_yasna(html_path: str) -> ParsedCorpus:
    with open(html_path, encoding="latin-1") as f:
        html = f.read()

    soup = BeautifulSoup(html, "html.parser")

    # Collect all top-level tags in body order
    body = soup.find("body") or soup
    all_tags = list(body.find_all(True, recursive=False)) or list(body.children)

    # Find positions of chapter <H2 id="yN"> headings
    chapter_positions: list[tuple[int, int]] = []  # (tag_index, chapter_num)
    flat = list(soup.find_all(True))
    for idx, tag in enumerate(flat):
        if tag.name and tag.name.lower() == "h2":
            cid = tag.get("id", "")
            m   = _CHAP_ID.match(str(cid))
            if m:
                ch_num = int(m.group(1))
                if ch_num > 0:  # skip y0 (Introduction)
                    chapter_positions.append((idx, ch_num))

    units: list[ParsedUnit] = []

    for i, (tag_idx, ch_num) in enumerate(chapter_positions):
        h2_tag    = flat[tag_idx]
        title     = _chapter_title(h2_tag)
        is_gatha  = ch_num in _GATHA_CHAPTERS
        ch_key    = f"Yasna {ch_num}"

        # Collect tags between this heading and the next chapter heading
        next_idx  = chapter_positions[i + 1][0] if i + 1 < len(chapter_positions) else len(flat)
        chunk     = flat[tag_idx + 1 : next_idx]
        verses    = _extract_verses(chunk)

        if not verses:
            continue

        extra: dict = {"is_gatha": is_gatha}
        if title:
            extra["title"] = title

        units.append(ParsedUnit(
            key=ch_key,
            parent_key=None,
            depth=0,
            reference_label=ch_key,
            extra_metadata=extra,
        ))

        for verse_num, verse_text in verses:
            units.append(ParsedUnit(
                key=f"{ch_key}:{verse_num}",
                parent_key=ch_key,
                depth=1,
                reference_label=f"Yasna {ch_num}:{verse_num}",
                text=verse_text,
                extra_metadata={"is_gatha": is_gatha},
            ))

    return ParsedCorpus(
        name="Yasna",
        description="Sacred liturgy of Zoroastrianism, including the Gathas/hymns of Zarathushtra",
        language_of_origin="Avestan",
        translation_name="Lawrence Mills Translation",
        translator="Lawrence Mills",
        language="en",
        source=html_path,
        levels=[
            ParsedLevel(height=1, name="Chapter"),
            ParsedLevel(height=0, name="Verse"),
        ],
        units=units,
        taxonomy_hints=["Zoroastrianism"],
    )
