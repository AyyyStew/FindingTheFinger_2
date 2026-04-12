"""
Common EPUB parsing utilities for Sutta Pitaka Nikaya parsers.
"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from pathlib import Path

from bs4 import BeautifulSoup

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit


_SKIP_BASENAMES = {
    "titlepage_main.html",
    "titlepage.html",
    "introduction.html",
    "acknowledgements.html",
    "acknowledgments.html",
    "copyright.html",
    "cover.html",
    "abbreviations.html",
    "quotation.html",
    "glossary.html",
    "bibliography.html",
    "foreword.html",
    "preface.html",
    "nav.xhtml",
}


@dataclass(frozen=True)
class NikayaSpec:
    code: str
    corpus_name: str
    description: str


_DNUM_RE = re.compile(r"\d+")


def _natural_sort_key(path: str) -> tuple:
    parts = re.split(r"(\d+)", path)
    out: list[str | int] = []
    for p in parts:
        if p.isdigit():
            out.append(int(p))
        else:
            out.append(p.lower())
    return tuple(out)


def _clean_text(s: str) -> str:
    s = s.replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def _extract_heading(soup: BeautifulSoup) -> str | None:
    for selector in ("h2.h1", "h3.h1", "h1", "h2", "h3"):
        tag = soup.select_one(selector)
        if tag:
            t = _clean_text(tag.get_text(" ", strip=True))
            if t:
                return t
    return None


def _extract_paragraphs_from_sutta(soup: BeautifulSoup) -> list[str]:
    container = soup.find("div", id="sutta") or soup.find("div", id="content") or soup
    if container is None:
        return []

    paragraphs: list[str] = []
    for p in container.find_all("p"):
        cls = {c.lower() for c in (p.get("class") or [])}
        if cls.intersection({"notetitle", "seealso", "translations"}):
            continue

        # Remove inline footnote markers.
        for fn in p.find_all(class_=re.compile(r"\bfn\b", re.I)):
            fn.decompose()

        text = _clean_text(p.get_text(" ", strip=True))
        if not text:
            continue

        # Drop boilerplate page furniture.
        low = text.lower()
        if low in {"note", "notes", "see also:"}:
            continue

        paragraphs.append(text)

    return paragraphs


def _load_html_from_epub(zf: zipfile.ZipFile, path: str) -> BeautifulSoup:
    raw = zf.read(path)
    return BeautifulSoup(raw, "html.parser")


def _candidate_html_paths(zf: zipfile.ZipFile, prefix: str) -> list[str]:
    out: list[str] = []
    for name in zf.namelist():
        if not name.startswith(prefix):
            continue
        if not name.lower().endswith(".html"):
            continue

        base = Path(name).name.lower()
        if base in _SKIP_BASENAMES:
            continue
        if base.startswith("app"):
            continue

        out.append(name)

    out.sort(key=_natural_sort_key)
    return out


def _section_ref_label(path: str, heading: str | None) -> str:
    stem = Path(path).stem
    if heading:
        return heading

    m = _DNUM_RE.search(stem)
    if m:
        return f"Section {m.group(0)}"
    return stem


def parse_standard_nikaya(epub_path: str, spec: NikayaSpec) -> ParsedCorpus:
    units: list[ParsedUnit] = []
    nikaya_key = spec.corpus_name
    units.append(
        ParsedUnit(
            key=nikaya_key,
            parent_key=None,
            depth=0,
            reference_label=spec.corpus_name,
        )
    )

    with zipfile.ZipFile(epub_path, "r") as zf:
        paths = _candidate_html_paths(zf, f"{spec.code}/")

        section_idx = 0
        for path in paths:
            soup = _load_html_from_epub(zf, path)
            heading = _extract_heading(soup)
            paragraphs = _extract_paragraphs_from_sutta(soup)
            if not paragraphs:
                continue

            section_idx += 1
            section_key = f"{spec.code}:{Path(path).stem}"
            section_label = _section_ref_label(path, heading)

            units.append(
                ParsedUnit(
                    key=section_key,
                    parent_key=nikaya_key,
                    depth=1,
                    reference_label=section_label,
                    extra_metadata={
                        "source_file": path,
                        "section_index": section_idx,
                    },
                )
            )

            for i, para in enumerate(paragraphs, start=1):
                units.append(
                    ParsedUnit(
                        key=f"{section_key}:p{i}",
                        parent_key=section_key,
                        depth=2,
                        reference_label=f"{section_label} ¶{i}",
                        text=para,
                    )
                )

    return ParsedCorpus(
        name=spec.corpus_name,
        description=spec.description,
        language_of_origin="Pali",
        translation_name="Thanissaro Bhikkhu Translation (Handful of Leaves)",
        translator="Thanissaro Bhikkhu",
        language="en",
        source=epub_path,
        levels=[
            ParsedLevel(height=2, name="Nikaya"),
            ParsedLevel(height=1, name="Sutta"),
            ParsedLevel(height=0, name="Paragraph"),
        ],
        units=units,
        taxonomy_hints=["Buddhism"],
    )


def _khuddaka_subbook_name(code: str) -> str:
    return {
        "Khp": "Khuddakapatha",
        "Dhp": "Dhammapada",
        "Ud": "Udana",
        "Iti": "Itivuttaka",
        "StNp": "Sutta Nipata",
        "Thag": "Theragatha",
        "Thig": "Therigatha",
    }.get(code, code)


def parse_khuddaka_nikaya(epub_path: str) -> ParsedCorpus:
    units: list[ParsedUnit] = []

    with zipfile.ZipFile(epub_path, "r") as zf:
        # Build grouped candidate files first.
        grouped: dict[str, list[str]] = {}
        for name in zf.namelist():
            if not name.startswith("KN/") or not name.lower().endswith(".html"):
                continue

            parts = name.split("/")
            if len(parts) < 3:
                continue
            sub = parts[1]
            base = Path(name).name.lower()
            if base in _SKIP_BASENAMES:
                continue
            if base.startswith("app"):
                continue

            grouped.setdefault(sub, []).append(name)

        # Preserve explicit sub-book order requested.
        subbook_order = ["Khp", "Dhp", "Ud", "Iti", "StNp", "Thag", "Thig"]

        for sub in subbook_order:
            paths = grouped.get(sub, [])
            if not paths:
                continue
            paths.sort(key=_natural_sort_key)

            subbook_name = _khuddaka_subbook_name(sub)
            sub_key = f"KN:{sub}"
            units.append(
                ParsedUnit(
                    key=sub_key,
                    parent_key=None,
                    depth=0,
                    reference_label=subbook_name,
                    extra_metadata={"subbook_code": sub},
                )
            )

            for section_index, path in enumerate(paths, start=1):
                soup = _load_html_from_epub(zf, path)
                heading = _extract_heading(soup)
                paragraphs = _extract_paragraphs_from_sutta(soup)
                if not paragraphs:
                    continue

                stem = Path(path).stem
                sec_key = f"{sub_key}:{stem}"
                sec_label = _section_ref_label(path, heading)

                sec_meta = {
                    "source_file": path,
                    "section_index": section_index,
                }

                # Dhammapada chapter emphasis.
                if sub == "Dhp":
                    chapter_match = re.search(r"ch\s*0*(\d+)", stem, flags=re.I)
                    if chapter_match:
                        chap_num = int(chapter_match.group(1))
                        sec_meta["chapter_number"] = chap_num
                        sec_label = f"Chapter {chap_num}: {sec_label}"

                units.append(
                    ParsedUnit(
                        key=sec_key,
                        parent_key=sub_key,
                        depth=1,
                        reference_label=sec_label,
                        extra_metadata=sec_meta,
                    )
                )

                for i, para in enumerate(paragraphs, start=1):
                    units.append(
                        ParsedUnit(
                            key=f"{sec_key}:p{i}",
                            parent_key=sec_key,
                            depth=2,
                            reference_label=f"{sec_label} ¶{i}",
                            text=para,
                        )
                    )

    return ParsedCorpus(
        name="Khuddaka Nikaya",
        description="Khuddaka Nikaya from Handful of Leaves EPUB, grouped by sub-book",
        language_of_origin="Pali",
        translation_name="Thanissaro Bhikkhu Translation (Handful of Leaves)",
        translator="Thanissaro Bhikkhu",
        language="en",
        source=epub_path,
        levels=[
            ParsedLevel(height=2, name="Sub-book"),
            ParsedLevel(height=1, name="Section"),
            ParsedLevel(height=0, name="Paragraph"),
        ],
        units=units,
        taxonomy_hints=["Buddhism"],
    )
