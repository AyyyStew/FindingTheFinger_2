"""
ftf/parsers/kojiki.py

Parser for the Kojiki (Basil Hall Chamberlain translation) from sacred-texts.com
HTML files. Logic ported from v2/add_kojiki.py.

Files kj008–kj187 = Sections 1–180. File number is authoritative —
heading Roman numerals contain typos. Files outside this range are skipped
if they don't match the Volume/Section pattern.

Hierarchy:
    Volume   depth=0  height=1  — 3 volumes (Age of the Gods, etc.)
    Section  depth=1  height=0  (leaf)

Usage:
    from ftf.parsers.kojiki import parse_kojiki
    parsed = parse_kojiki("data/raw/East Asian/Shinto/kojiki/")
"""

import re
from pathlib import Path

from bs4 import BeautifulSoup

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

_PAGE_ONLY  = re.compile(r"^(p\.\s*\d+\s*)+$")
_FOOTNOTE_N = re.compile(r"\[\d+\]")
_NAV_TEXT   = re.compile(r"^(Next:|Sacred Texts\s*\|)", re.I)

VOLUME_LABELS = {
    "I":   "Volume I — Age of the Gods",
    "II":  "Volume II — Age of the Early Emperors",
    "III": "Volume III — Age of the Later Emperors",
}
VOLUME_ORDER = ["I", "II", "III"]

# kj008 = section 1
FIRST_FILE = 8
LAST_FILE  = 187


def _extract_volume(title_text: str) -> str | None:
    m = re.search(r"Volume\s+(I{1,3}V?|IV|VI{0,3})", title_text, re.I)
    return m.group(1).upper() if m else None


def _extract_section_title(heading_text: str) -> str:
    s = heading_text.strip().strip("[]").strip()
    s = re.sub(r"^SECT(?:ION)?\.?\s+[IVXLCDM]+\.?\s*[—–-]+\s*", "", s, flags=re.I)
    s = re.sub(r"\s{2,}", " ", s).rstrip(".]").strip()
    return s.title() if s.isupper() else s


def _clean_para(raw: str) -> str | None:
    if _PAGE_ONLY.match(raw.strip()):
        return None
    if _NAV_TEXT.match(raw.strip()):
        return None
    text = re.sub(r"^\[paragraph continues\]\s*", "", raw)
    text = _FOOTNOTE_N.sub("", text)
    text = re.sub(r"[\xa0\s]+", " ", text).strip()
    if len(text) < 20:
        return None
    return text


def _parse_file(path: Path) -> dict | None:
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")

    title_tag  = soup.find("title")
    volume_rom = _extract_volume(title_tag.get_text() if title_tag else "")
    if not volume_rom:
        return None

    sect_tag = None
    for tag in soup.find_all(["h2", "h3", "h4"]):
        if re.search(r"SECT(?:ION)?\.?\s+[IVXLCDM]+", tag.get_text(), re.I):
            sect_tag = tag
            break
    if not sect_tag:
        return None

    for a in sect_tag.find_all("a"):
        a.decompose()
    title = _extract_section_title(sect_tag.get_text())

    frags      = []
    in_content = False
    for tag in soup.find_all(["h2", "h3", "h4", "p"]):
        if tag is sect_tag:
            in_content = True
            continue
        if not in_content:
            continue
        if tag.name in ("h2", "h3", "h4"):
            if "footnote" in tag.get_text().lower():
                break
            continue
        for a in tag.find_all("a", href=lambda h: h and "#fn_" in h):
            a.decompose()
        raw     = re.sub(r"[\xa0\s]+", " ", tag.get_text()).strip()
        cleaned = _clean_para(raw)
        if cleaned:
            frags.append(cleaned)

    body = " ".join(frags)
    if not body:
        return None

    return {"volume_rom": volume_rom, "title": title, "text": body}


def parse_kojiki(kojiki_dir: str) -> ParsedCorpus:
    base = Path(kojiki_dir)
    sections: list[dict] = []

    for file_num in range(FIRST_FILE, LAST_FILE + 1):
        path       = base / f"kj{file_num:03d}.htm"
        section_num = file_num - (FIRST_FILE - 1)
        result     = _parse_file(path)
        if result:
            result["section_num"] = section_num
            sections.append(result)

    units: list[ParsedUnit] = []

    for vol_rom in VOLUME_ORDER:
        units.append(ParsedUnit(
            key=VOLUME_LABELS[vol_rom],
            parent_key=None,
            depth=0,
            reference_label=VOLUME_LABELS[vol_rom],
            extra_metadata={"volume": vol_rom},
        ))

    for s in sections:
        units.append(ParsedUnit(
            key=f"Kojiki {s['section_num']}",
            parent_key=VOLUME_LABELS[s["volume_rom"]],
            depth=1,
            reference_label=f"Kojiki {s['section_num']}",
            text=s["text"],
            extra_metadata={"title": s["title"], "volume": s["volume_rom"]},
        ))

    return ParsedCorpus(
        name="Kojiki",
        description="Records of Ancient Matters — the oldest chronicle of Japanese mythology and history",
        language_of_origin="Old Japanese",
        translation_name="Basil Hall Chamberlain Translation",
        translator="Basil Hall Chamberlain",
        language="en",
        source=kojiki_dir,
        levels=[
            ParsedLevel(height=1, name="Volume"),
            ParsedLevel(height=0, name="Section"),
        ],
        units=units,
        taxonomy_hints=["Shinto"],
    )
