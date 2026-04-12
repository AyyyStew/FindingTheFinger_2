"""Parser for Enuma Elish HTML source."""

from __future__ import annotations

import re

from bs4 import BeautifulSoup, Tag

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit


_TABLET_HEADING_RE = re.compile(r"^Tablet\s+([IVXLC]+)$", re.IGNORECASE)
_LINE_RE = re.compile(r"^(\d+)\s+(.+)$")
_ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}


def _roman_to_int(s: str) -> int:
    total, prev = 0, 0
    for ch in reversed(s.upper()):
        v = _ROMAN.get(ch, 0)
        total += v if v >= prev else -v
        prev = v
    return total


def _split_p_lines(tag: Tag) -> list[str]:
    parts = [p.strip() for p in tag.get_text("\n").split("\n")]
    return [p for p in parts if p]


def parse_enuma_elish(html_path: str) -> ParsedCorpus:
    html = open(html_path, encoding="utf-8", errors="ignore").read()
    soup = BeautifulSoup(html, "html.parser")

    # Anchor to canonical text section only.
    start_h3 = None
    for h3 in soup.find_all("h3"):
        if "The Text of Enuma Elish" in h3.get_text(" ", strip=True):
            start_h3 = h3
            break

    units: list[ParsedUnit] = []
    if start_h3 is None:
        return ParsedCorpus(
            name="Enuma Elish",
            description="Babylonian creation epic in seven tablets",
            language_of_origin="Akkadian",
            translation_name="W.G. Lambert Translation",
            translator="W.G. Lambert",
            language="en",
            source=html_path,
            levels=[ParsedLevel(height=1, name="Tablet"), ParsedLevel(height=0, name="Line")],
            units=[],
            taxonomy_hints=["Mesopotamian"],
        )

    current_tablet_key: str | None = None
    current_tablet_num: int | None = None

    for node in start_h3.next_elements:
        if isinstance(node, Tag) and node.name == "h3" and node is not start_h3:
            # End at next high-level section.
            break

        if not isinstance(node, Tag) or node.name != "p":
            continue

        text = node.get_text(" ", strip=True)
        m_tab = _TABLET_HEADING_RE.match(text)
        if m_tab:
            current_tablet_num = _roman_to_int(m_tab.group(1))
            current_tablet_key = f"Tablet {current_tablet_num}"
            units.append(
                ParsedUnit(
                    key=current_tablet_key,
                    parent_key=None,
                    depth=0,
                    reference_label=current_tablet_key,
                )
            )
            continue

        if current_tablet_key is None:
            continue

        for line in _split_p_lines(node):
            m_line = _LINE_RE.match(line)
            if not m_line:
                continue
            ln = int(m_line.group(1))
            body = m_line.group(2).strip()
            if not body:
                continue

            units.append(
                ParsedUnit(
                    key=f"{current_tablet_key}:{ln}",
                    parent_key=current_tablet_key,
                    depth=1,
                    reference_label=f"{current_tablet_num}.{ln}",
                    text=body,
                )
            )

    return ParsedCorpus(
        name="Enuma Elish",
        description="Babylonian creation epic in seven tablets",
        language_of_origin="Akkadian",
        translation_name="W.G. Lambert Translation",
        translator="W.G. Lambert",
        language="en",
        source=html_path,
        levels=[
            ParsedLevel(height=1, name="Tablet"),
            ParsedLevel(height=0, name="Line"),
        ],
        units=units,
        taxonomy_hints=["Mesopotamian"],
    )
