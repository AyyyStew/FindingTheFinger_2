"""
ftf/parsers/upanishads.py

Parser for the Project Gutenberg Upanishads (Swami Paramananda translation).
Contains 3 Upanishads: Isa, Katha, Kena. Mantras are marked by standalone
Roman numeral lines (I, II, III...) within each Upanishad's body.

Hierarchy:
    Upanishad  depth=0  height=1   (Isa, Katha, Kena)
    Mantra     depth=1  height=0   (leaf)

Usage:
    from ftf.parsers.upanishads import parse_upanishads
    parsed = parse_upanishads("data/raw/Indic_Dharmic/Hindu/upanishads.txt")
"""

import re

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

_UPANISHAD_RE = re.compile(
    r"^\s{5,}(Isa-Upanishad|Katha-Upanishad|Kena-Upanishad)\s*$",
    re.MULTILINE,
)
_MANTRA_RE = re.compile(r"^\s*(I{1,3}|IV|VI{0,3}|IX|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX{0,3})\s*$", re.MULTILINE)

_DISPLAY = {
    "Isa-Upanishad":   "Isa Upanishad",
    "Katha-Upanishad": "Katha Upanishad",
    "Kena-Upanishad":  "Kena Upanishad",
}

_ROMAN = {"I":1,"V":5,"X":10,"L":50,"C":100}


def _roman_to_int(s: str) -> int:
    val, prev = 0, 0
    for ch in reversed(s.strip().upper()):
        v = _ROMAN.get(ch, 0)
        val += v if v >= prev else -v
        prev = v
    return val


def parse_upanishads(txt_path: str) -> ParsedCorpus:
    with open(txt_path, encoding="utf-8") as f:
        raw = f.read().replace("\r\n", "\n").replace("\r", "\n")

    start = raw.find("*** START OF THE PROJECT GUTENBERG")
    end   = raw.find("*** END OF THE PROJECT GUTENBERG")
    if start != -1:
        raw = raw[raw.find("\n", start) + 1:]
    if end != -1:
        raw = raw[:end]

    # Take only the first occurrence of each Upanishad header
    all_matches = list(_UPANISHAD_RE.finditer(raw))
    seen, splits = set(), []
    for m in all_matches:
        key = m.group(1)
        if key not in seen:
            seen.add(key)
            splits.append(m)

    units: list[ParsedUnit] = []

    for i, match in enumerate(splits):
        key  = match.group(1)
        name = _DISPLAY[key]
        upanishad_key = name

        block_start = match.end()
        block_end   = splits[i + 1].start() if i + 1 < len(splits) else len(raw)
        block       = raw[block_start:block_end]

        units.append(ParsedUnit(
            key=upanishad_key,
            parent_key=None,
            depth=0,
            reference_label=name,
        ))

        # Find mantra boundaries by Roman numeral lines
        mantra_splits = list(_MANTRA_RE.finditer(block))
        for j, mm in enumerate(mantra_splits):
            mantra_num = _roman_to_int(mm.group(1))
            text_start = mm.end()
            text_end   = mantra_splits[j + 1].start() if j + 1 < len(mantra_splits) else len(block)
            text       = re.sub(r"\s+", " ", block[text_start:text_end]).strip()

            # Skip very short blocks (headers, peace chants, etc.)
            if len(text) < 20:
                continue

            units.append(ParsedUnit(
                key=f"{upanishad_key} {mantra_num}",
                parent_key=upanishad_key,
                depth=1,
                reference_label=f"{name} {mantra_num}",
                text=text,
            ))

    return ParsedCorpus(
        name="Upanishads",
        description="Three principal Upanishads: Isa, Katha, and Kena",
        language_of_origin="Sanskrit",
        translation_name="Swami Paramananda Translation",
        translator="Swami Paramananda",
        language="en",
        source=txt_path,
        levels=[
            ParsedLevel(height=1, name="Upanishad"),
            ParsedLevel(height=0, name="Mantra"),
        ],
        units=units,
        taxonomy_hints=["Hinduism"],
    )
