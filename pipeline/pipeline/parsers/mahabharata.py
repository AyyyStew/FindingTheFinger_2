"""Parser for Mahabharata plain-text corpus."""

from __future__ import annotations

import re

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit


_BOOK_RE = re.compile(r"^BOOK\s+([0-9IVXLC]+)\s*$", re.IGNORECASE)
_SECTION_RE = re.compile(r"^SECTION\s+([A-Z0-9]+)\s*$", re.IGNORECASE)


def _clean(s: str) -> str:
    return " ".join(s.replace("\xa0", " ").split())


def parse_mahabharata(txt_path: str) -> ParsedCorpus:
    raw = open(txt_path, encoding="utf-8", errors="ignore").read()
    lines = raw.splitlines()

    # Start at canonical narrative block.
    start_idx = 0
    for i, line in enumerate(lines):
        if line.strip().upper() == "THE MAHABHARATA":
            start_idx = i
            break

    units: list[ParsedUnit] = []

    current_book_key: str | None = None
    current_parva_key: str | None = None
    current_section_key: str | None = None

    para_buf: list[str] = []
    para_count = 0

    def flush_para() -> None:
        nonlocal para_buf, para_count
        if not para_buf or current_section_key is None:
            para_buf = []
            return
        text = _clean(" ".join(para_buf))
        para_buf = []
        if not text:
            return
        para_count += 1
        units.append(
            ParsedUnit(
                key=f"{current_section_key}:p{para_count}",
                parent_key=current_section_key,
                depth=3,
                reference_label=f"§{para_count}",
                text=text,
            )
        )

    i = start_idx
    while i < len(lines):
        line = lines[i].strip()

        # Skip marker lines; do not terminate parsing.
        if line.upper().startswith("FOOTNOTES"):
            flush_para()
            i += 1
            continue

        m_book = _BOOK_RE.match(line)
        if m_book:
            flush_para()
            book_num = m_book.group(1)
            current_book_key = f"Book {book_num}"
            units.append(
                ParsedUnit(
                    key=current_book_key,
                    parent_key=None,
                    depth=0,
                    reference_label=current_book_key,
                )
            )

            # Optional next non-empty line as parva title.
            j = i + 1
            parva = None
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines):
                cand = lines[j].strip()
                if cand and "PARVA" in cand.upper():
                    parva = cand
                    i = j
            if parva:
                current_parva_key = f"{current_book_key}:{parva.title()}"
                units.append(
                    ParsedUnit(
                        key=current_parva_key,
                        parent_key=current_book_key,
                        depth=1,
                        reference_label=parva.title(),
                    )
                )
            else:
                current_parva_key = f"{current_book_key}:Parva"
                units.append(
                    ParsedUnit(
                        key=current_parva_key,
                        parent_key=current_book_key,
                        depth=1,
                        reference_label="Parva",
                    )
                )

            current_section_key = None
            para_count = 0
            i += 1
            continue

        m_sec = _SECTION_RE.match(line)
        if m_sec and current_parva_key:
            flush_para()
            sec_num = m_sec.group(1)
            current_section_key = f"{current_parva_key}:Section {sec_num}"
            units.append(
                ParsedUnit(
                    key=current_section_key,
                    parent_key=current_parva_key,
                    depth=2,
                    reference_label=f"Section {sec_num}",
                )
            )
            para_count = 0
            i += 1
            continue

        # Paragraph text accumulation.
        if line:
            para_buf.append(line)
        else:
            flush_para()

        i += 1

    flush_para()

    return ParsedCorpus(
        name="Mahabharata",
        description="The Mahabharata in English translation",
        language_of_origin="Sanskrit",
        translation_name="Kisari Mohan Ganguli Translation",
        translator="Kisari Mohan Ganguli",
        language="en",
        source=txt_path,
        levels=[
            ParsedLevel(height=3, name="Book"),
            ParsedLevel(height=2, name="Parva"),
            ParsedLevel(height=1, name="Section"),
            ParsedLevel(height=0, name="Paragraph"),
        ],
        units=units,
        taxonomy_hints=["Hinduism"],
    )
