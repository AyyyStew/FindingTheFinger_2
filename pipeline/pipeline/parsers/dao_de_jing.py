"""
ftf/parsers/dao_de_jing.py

Parser for the Project Gutenberg Dao De Jing (Bruce Linnell translation).
Source is an HTML file with chapters laid out in 4-column tables. Each table
row 1 has: (left) Chinese characters, (right) English translation.
The second <td> in the first <tr> of each chapter table is extracted.

Hierarchy:
    Book   depth=0  height=1  — "Tao Ching" (ch. 1-37), "Te Ching" (ch. 38-81)
    Zhang  depth=1  height=0  (leaf) — DDJ 1 … DDJ 81

Usage:
    from ftf.parsers.dao_de_jing import parse_dao_de_jing
    parsed = parse_dao_de_jing("data/raw/East Asian/Taoism/dao_de_ching.html")
"""

import re

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

_CHAPTER_HDR = re.compile(r'font-size:14\.0pt\">Chapter ([A-Za-z\-\s]+?)<')

# Ordinal word → integer
_ORDINALS: dict[str, int] = {
    "One": 1, "Two": 2, "Three": 3, "Four": 4, "Five": 5,
    "Six": 6, "Seven": 7, "Eight": 8, "Nine": 9, "Ten": 10,
    "Eleven": 11, "Twelve": 12, "Thirteen": 13, "Fourteen": 14, "Fifteen": 15,
    "Sixteen": 16, "Seventeen": 17, "Eighteen": 18, "Nineteen": 19, "Twenty": 20,
    "Twenty One": 21, "Twenty Two": 22, "Twenty Three": 23, "Twenty Four": 24,
    "Twenty Five": 25, "Twenty Six": 26, "Twenty Seven": 27, "Twenty Eight": 28,
    "Twenty Nine": 29, "Thirty": 30, "Thirty One": 31, "Thirty Two": 32,
    "Thirty Three": 33, "Thirty Four": 34, "Thirty Five": 35, "Thirty Six": 36,
    "Thirty Seven": 37, "Thirty Eight": 38, "Thirty Nine": 39, "Forty": 40,
    "Forty One": 41, "Forty Two": 42, "Forty Three": 43, "Forty Four": 44,
    "Forty Five": 45, "Forty Six": 46, "Forty Seven": 47, "Forty Eight": 48,
    "Forty Nine": 49, "Fifty": 50, "Fifty One": 51, "Fifty Two": 52,
    "Fifty Three": 53, "Fifty Four": 54, "Fifty Five": 55, "Fifty Six": 56,
    "Fifty Seven": 57, "Fifty Eight": 58, "Fifty Nine": 59, "Sixty": 60,
    "Sixty One": 61, "Sixty Two": 62, "Sixty Three": 63, "Sixty Four": 64,
    "Sixty Five": 65, "Sixty Six": 66, "Sixty Seven": 67, "Sixty Eight": 68,
    "Sixty Nine": 69, "Seventy": 70, "Seventy One": 71, "Seventy Two": 72,
    "Seventy Three": 73, "Seventy Four": 74, "Seventy Five": 75, "Seventy Six": 76,
    "Seventy Seven": 77, "Seventy Eight": 78, "Seventy Nine": 79, "Eighty": 80,
    "Eighty One": 81,
}

_TAG_RE = re.compile(r"<[^>]+>")


def _extract_second_td(block: str) -> str:
    """Return cleaned text from the second <td> in the block (English translation column)."""
    tds = [m.start() for m in re.finditer(r"<td\s", block)]
    if len(tds) < 2:
        return ""
    start = tds[1]
    # Find the closing </td> for the second cell
    end = block.find("</td>", start)
    if end == -1:
        end = len(block)
    raw = block[start:end]
    text = _TAG_RE.sub("", raw)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _book_for(ch_num: int) -> str:
    return "Tao Ching" if ch_num <= 37 else "Te Ching"


def parse_dao_de_jing(html_path: str) -> ParsedCorpus:
    with open(html_path, encoding="utf-8") as f:
        html = f.read()

    matches = list(_CHAPTER_HDR.finditer(html))

    book_seen: set[str] = set()
    units: list[ParsedUnit] = []

    for i, m in enumerate(matches):
        ordinal = m.group(1).strip()
        ch_num  = _ORDINALS.get(ordinal)
        if ch_num is None:
            continue

        block_start = m.start()
        block_end   = matches[i + 1].start() if i + 1 < len(matches) else len(html)
        block       = html[block_start:block_end]

        text = _extract_second_td(block)
        if not text:
            continue

        book_name = _book_for(ch_num)
        if book_name not in book_seen:
            book_seen.add(book_name)
            units.append(ParsedUnit(
                key=book_name,
                parent_key=None,
                depth=0,
                reference_label=book_name,
            ))

        units.append(ParsedUnit(
            key=f"DDJ {ch_num}",
            parent_key=book_name,
            depth=1,
            reference_label=f"DDJ {ch_num}",
            text=text,
        ))

    return ParsedCorpus(
        name="Dao De Jing",
        description="Classic Taoist text attributed to Laozi, exploring the nature of the Dao and Te",
        language_of_origin="Classical Chinese",
        translation_name="Bruce Linnell Translation",
        translator="Bruce Linnell",
        language="en",
        source=html_path,
        levels=[
            ParsedLevel(height=1, name="Book"),
            ParsedLevel(height=0, name="Zhang"),
        ],
        units=units,
        taxonomy_hints=["Taoism"],
    )
