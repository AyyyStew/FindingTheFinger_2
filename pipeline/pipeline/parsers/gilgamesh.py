"""Parser for the Epic of Gilgamesh PDF."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit


_TABLET_RE = re.compile(r"^\s*Tablet\s+([IVXLC]+)\s*\.?\s*$", re.IGNORECASE)
_ROMAN_ONLY_RE = re.compile(r"^\s*([IVXLC]+)\s*\.?\s*$", re.IGNORECASE)
_ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}


def _roman_to_int(s: str) -> int:
    total, prev = 0, 0
    for ch in reversed(s.upper()):
        v = _ROMAN.get(ch, 0)
        total += v if v >= prev else -v
        prev = v
    return total


def _extract_pdf_text(pdf_path: str) -> str:
    # Prefer pdftotext for stable text extraction in this environment.
    out = subprocess.run(
        ["pdftotext", "-layout", pdf_path, "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    return out.stdout


def _clean_line(line: str) -> str:
    line = line.replace("\u00a0", " ")
    line = re.sub(r"[\t\r]+", " ", line)
    line = re.sub(r"\s+", " ", line)
    return line.strip()


def parse_gilgamesh(pdf_path: str) -> ParsedCorpus:
    text = _extract_pdf_text(pdf_path)
    lines = [_clean_line(l) for l in text.splitlines()]

    units: list[ParsedUnit] = []
    current_tablet_key: str | None = None
    current_tablet_num: int | None = None
    pending_tablet_heading = False
    para_buf: list[str] = []
    para_count = 0

    def flush_para() -> None:
        nonlocal para_buf, para_count
        if current_tablet_key is None or not para_buf:
            para_buf = []
            return

        # Drop pure page-number paragraphs.
        body = " ".join(para_buf).strip()
        para_buf = []
        if not body or re.fullmatch(r"\d+", body):
            return

        para_count += 1
        units.append(
            ParsedUnit(
                key=f"{current_tablet_key}:p{para_count}",
                parent_key=current_tablet_key,
                depth=1,
                reference_label=f"Tablet {current_tablet_num} ¶{para_count}",
                text=body,
            )
        )

    for raw_line in lines:
        if not raw_line:
            flush_para()
            continue

        m = _TABLET_RE.match(raw_line)
        if m:
            flush_para()
            current_tablet_num = _roman_to_int(m.group(1))
            current_tablet_key = f"Tablet {current_tablet_num}"
            units.append(
                ParsedUnit(
                    key=current_tablet_key,
                    parent_key=None,
                    depth=0,
                    reference_label=current_tablet_key,
                )
            )
            para_count = 0
            continue

        # Many lines are extracted as:
        #   Tablet
        #   I
        # so handle split headings too.
        if raw_line.lower() == "tablet":
            flush_para()
            pending_tablet_heading = True
            continue

        if pending_tablet_heading:
            clean = raw_line.strip("[]()")
            m_roman = _ROMAN_ONLY_RE.match(clean)
            if m_roman:
                current_tablet_num = _roman_to_int(m_roman.group(1))
                current_tablet_key = f"Tablet {current_tablet_num}"
                units.append(
                    ParsedUnit(
                        key=current_tablet_key,
                        parent_key=None,
                        depth=0,
                        reference_label=current_tablet_key,
                    )
                )
                para_count = 0
                pending_tablet_heading = False
                continue
            pending_tablet_heading = False

        # Ignore front matter before first tablet.
        if current_tablet_key is None:
            continue

        # Strip obvious standalone page counters.
        if re.fullmatch(r"\d+", raw_line):
            continue

        para_buf.append(raw_line)

    flush_para()

    return ParsedCorpus(
        name="Epic of Gilgamesh",
        description="Ancient Mesopotamian epic poem in tablet form",
        language_of_origin="Akkadian",
        translation_name="Maureen Gallery Kovacs Translation",
        translator="Maureen Gallery Kovacs",
        language="en",
        source=pdf_path,
        levels=[
            ParsedLevel(height=1, name="Tablet"),
            ParsedLevel(height=0, name="Paragraph"),
        ],
        units=units,
        taxonomy_hints=["Mesopotamian"],
    )
