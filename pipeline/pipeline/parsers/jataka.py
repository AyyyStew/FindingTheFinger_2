"""
ftf/parsers/jataka.py

Parser for the Buddhist Birth Stories / Jataka Tales, Volume 1
(Rhys Davids translation, Project Gutenberg).

Each tale is identified by an all-caps Sanskrit/Pali name line ending in
"JĀTAKA." or "JATAKA." The English title is the non-blank line immediately
before it. Tales are the leaf units — no natural grouping exists in this volume.

Hierarchy:
    Tale  depth=0  height=0  (leaf)

Usage:
    from ftf.parsers.jataka import parse_jataka
    parsed = parse_jataka("data/raw/Indic_Dharmic/Buddhist/jataka_tales.txt")
"""

import re

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

_TALE_NAME_RE = re.compile(
    r"^([A-ZĀḌḤĪḶṂṆṄÑṚŚṢṬŪ][A-ZĀḌḤĪḶṂṆṄÑṚŚṢṬŪ\-\s]+JĀTAKA|"
    r"[A-Z][A-Z\-\s]+JATAKA)\.$",
    re.MULTILINE,
)
_FAUSBOLL_RE  = re.compile(r"^\(Fausböll,\s*No\.\s*(\d+)\.?\)", re.MULTILINE)
_SEPARATOR_RE = re.compile(r"^\s*\*\s*\*\s*\*", re.MULTILINE)


def parse_jataka(txt_path: str) -> ParsedCorpus:
    with open(txt_path, encoding="utf-8-sig") as f:
        raw = f.read()

    start = raw.find("*** START OF THE PROJECT GUTENBERG")
    end   = raw.find("*** END OF THE PROJECT GUTENBERG")
    if start != -1:
        raw = raw[raw.find("\n", start) + 1:]
    if end != -1:
        raw = raw[:end]

    # Find all tale name markers
    tale_matches = list(_TALE_NAME_RE.finditer(raw))

    units: list[ParsedUnit] = []

    for i, m in enumerate(tale_matches):
        pali_name = m.group(0).strip().rstrip(".")

        # English title: last non-blank line before the Pali name
        before = raw[:m.start()].rstrip()
        lines  = [l.strip() for l in before.split("\n") if l.strip()]
        english_title = lines[-1] if lines else pali_name

        # Story body: from end of Pali name line to start of next tale (or end)
        body_start = m.end()
        body_end   = tale_matches[i + 1].start() if i + 1 < len(tale_matches) else len(raw)
        body_raw   = raw[body_start:body_end]

        # Extract Fausböll number from body if present
        fb_match    = _FAUSBOLL_RE.search(body_raw)
        fausboll_no = int(fb_match.group(1)) if fb_match else None

        # Story text: strip the Fausböll ref line and trailing separator
        story = body_raw
        if fb_match:
            story = story[fb_match.end():]
        # Cut at trailing asterisk separator (end-of-tale marker)
        sep_m = _SEPARATOR_RE.search(story)
        if sep_m:
            story = story[:sep_m.start()]

        text = re.sub(r"\s+", " ", story).strip()
        if not text:
            continue

        extra: dict = {"pali_name": pali_name}
        if fausboll_no is not None:
            extra["fausboll_no"] = fausboll_no

        units.append(ParsedUnit(
            key=pali_name,
            parent_key=None,
            depth=0,
            reference_label=english_title,
            text=text,
            extra_metadata=extra,
        ))

    return ParsedCorpus(
        name="Jataka Tales",
        description="Buddhist birth stories recounting the previous lives of the Buddha",
        language_of_origin="Pali",
        translation_name="T.W. Rhys Davids Translation (Volume 1)",
        translator="T.W. Rhys Davids",
        language="en",
        source=txt_path,
        levels=[
            ParsedLevel(height=0, name="Tale"),
        ],
        units=units,
        taxonomy_hints=["Buddhism"],
    )
