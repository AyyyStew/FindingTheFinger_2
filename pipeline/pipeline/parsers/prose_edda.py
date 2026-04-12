"""Parser for Prose Edda (Younger Edda) Gutenberg text."""

from __future__ import annotations

import re

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit


_PART_RE = re.compile(r"^(THE FOOLING OF GYLFE\.|BRAGE\u2019S TALK\.|EXTRACTS FROM THE POETICAL DICTION\.)$", re.IGNORECASE)
_CHAPTER_RE = re.compile(r"^CHAPTER\s+([IVXLC]+)\.?$", re.IGNORECASE)


def _clean(s: str) -> str:
    return " ".join(s.replace("\xa0", " ").split())


def parse_prose_edda(txt_path: str) -> ParsedCorpus:
    text = open(txt_path, encoding="utf-8-sig", errors="ignore").read()
    lines = text.splitlines()

    # Start at the narrative section, not the table of contents.
    start = 0
    for i, line in enumerate(lines):
        if line.strip().upper() == "THE FOOLING OF GYLFE." and i > 500:
            start = i
            break

    units: list[ParsedUnit] = []

    current_part_key: str | None = None
    current_chapter_key: str | None = None
    pending_chapter_num: str | None = None

    para_buf: list[str] = []
    para_count = 0

    def flush_para() -> None:
        nonlocal para_buf, para_count
        if current_chapter_key is None or not para_buf:
            para_buf = []
            return
        body = _clean(" ".join(para_buf))
        para_buf = []
        if not body:
            return
        para_count += 1
        units.append(
            ParsedUnit(
                key=f"{current_chapter_key}:p{para_count}",
                parent_key=current_chapter_key,
                depth=2,
                reference_label=f"¶{para_count}",
                text=body,
            )
        )

    i = start
    while i < len(lines):
        line = lines[i].strip()

        # Stop before note index at back matter.
        if line.upper() == "NOTES." and i > start + 100:
            flush_para()
            break

        m_part = _PART_RE.match(line)
        if m_part:
            flush_para()
            title = m_part.group(1).rstrip(".").title()
            current_part_key = title
            units.append(
                ParsedUnit(
                    key=current_part_key,
                    parent_key=None,
                    depth=0,
                    reference_label=title,
                )
            )
            current_chapter_key = None
            pending_chapter_num = None
            para_count = 0
            i += 1
            continue

        m_ch = _CHAPTER_RE.match(line)
        if m_ch and current_part_key:
            flush_para()
            pending_chapter_num = m_ch.group(1)
            current_chapter_key = None
            para_count = 0
            i += 1
            continue

        # The line after CHAPTER N is usually chapter title.
        if pending_chapter_num and line and current_part_key:
            chap_title = _clean(line.title())
            current_chapter_key = f"{current_part_key}:Chapter {pending_chapter_num}"
            units.append(
                ParsedUnit(
                    key=current_chapter_key,
                    parent_key=current_part_key,
                    depth=1,
                    reference_label=f"Chapter {pending_chapter_num}: {chap_title}",
                )
            )
            pending_chapter_num = None
            i += 1
            continue

        if line:
            if current_chapter_key:
                para_buf.append(line)
        else:
            flush_para()

        i += 1

    flush_para()

    return ParsedCorpus(
        name="Prose Edda",
        description="The Younger Edda (Prose Edda) attributed to Snorri Sturluson",
        language_of_origin="Old Norse",
        translation_name="Rasmus B. Anderson Translation",
        translator="Rasmus B. Anderson",
        language="en",
        source=txt_path,
        levels=[
            ParsedLevel(height=2, name="Part"),
            ParsedLevel(height=1, name="Chapter"),
            ParsedLevel(height=0, name="Paragraph"),
        ],
        units=units,
        taxonomy_hints=["Norse / Germanic"],
    )
