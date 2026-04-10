"""
ftf/parsers/sggs.py

Parser for the Guru Granth Sahib Ji (SGGS) from gurbanidb.sqlite.
Source: GurbaniDB SQLite export.

Hierarchy:
    Raag    depth=0  height=3  — musical mode / liturgical section
    Section depth=1  height=2  — sub-section within raag (Ki Vaar, Sukhmani, Main, …)
    Shabad  depth=2  height=1  — a complete hymn (grouped by `hymn` column)
    Stanza  depth=3  height=0  (leaf) — tuks up to a ॥N॥ pause marker

Raag and Section are derived from the `section` field:
    "Aasaa - Aasaa Ki Vaar"  → Raag="Aasaa",  Section="Aasaa Ki Vaar"
    "Aasaa"                  → Raag="Aasaa",  Section="Main"
    "Jap Ji Sahib (Song Of The Soul)" → Raag="Jap Ji Sahib (Song Of The Soul)", Section="Main"

Stanza text is the concatenated English translations (language_id=13) of all
tuks in the stanza, joined by newlines. Gurmukhi original tuks are stored in
uncleaned_text on the stanza unit. Format-header tuks (ਪਉੜੀ ॥, ਛੰਤੁ ॥, etc.)
are stripped from content but their type is stored in stanza extra_metadata.

Usage:
    from ftf.parsers.sggs import parse_sggs
    parsed = parse_sggs("data/raw/Indic_Dharmic/Sikhism/sggs/gurbanidb.sqlite")
"""

import re
import sqlite3

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

# English translation language_id in gurbanidb
_EN_LANG_ID = 13

# Matches a stanza-end tuk: contains ॥[Gurmukhi digit(s)]॥
# Gurmukhi digits: ੦-੯  (U+0A66–U+0A6F)
_STANZA_END_RE = re.compile(r"॥[੦-੯]+॥")

# Matches a shabad header tuk (raag/mehla declaration line)
# e.g. "ਸਿਰੀਰਾਗੁ ਮਹਲਾ ੩ ॥" — ends with bare ॥ but has no stanza number
_HEADER_RE = re.compile(r"॥\s*$")

# Format-type header tuks that appear mid-shabad (Pauree, Chhant, Shalok, etc.)
# These announce a sub-format but carry no poetic content themselves.
_FORMAT_HEADER_RE = re.compile(
    r"^(ਪਉੜੀ|ਛੰਤੁ|ਸਲੋਕੁ|ਸਲੋਕ|ਭਗਤ|ਸਵਯੇ|ਦੁਤੁਕੇ)\s*॥\s*$"
)
# English translation equivalents for format detection
_FORMAT_EN_RE = re.compile(
    r"^(Pauree|Chhant|Shalok|Salok|Swaiyas?|Couplet):\s*$", re.IGNORECASE
)

_FORMAT_NAMES = {
    "ਪਉੜੀ": "Pauree",
    "ਛੰਤੁ": "Chhant",
    "ਸਲੋਕੁ": "Shalok",
    "ਸਲੋਕ": "Shalok",
    "ਭਗਤ": "Bhagat",
    "ਸਵਯੇ": "Savaiye",
    "ਦੁਤੁਕੇ": "Dutuke",
}


def _parse_section(section: str) -> tuple[str, str]:
    """
    Split 'Raag - Sub Section Name' into (raag, sub_section).
    If no ' - ', section_name = 'Main'.
    """
    if " - " in section:
        raag, _, sub = section.partition(" - ")
        return raag.strip(), sub.strip()
    return section.strip(), "Main"


def _is_header_tuk(text: str) -> bool:
    """True if this tuk is a raag/mehla header line (no stanza number)."""
    return bool(_HEADER_RE.search(text)) and not bool(_STANZA_END_RE.search(text))


def _group_stanzas(
    tuks: list[tuple[str, str | None]],
) -> list[tuple[list[str], list[str], str | None]]:
    """
    Group (gurmukhi, translation) tuk pairs into stanzas.
    A stanza ends when a tuk contains a ॥N॥ marker.
    Format-header tuks (ਪਉੜੀ ॥, ਛੰਤੁ ॥, etc.) are stripped from content
    but the current format type is tracked and attached to the next stanza.

    Returns list of (gurmukhi_lines, translation_lines, format_type | None).
    """
    stanzas: list[tuple[list[str], list[str], str | None]] = []
    cur_g: list[str] = []
    cur_t: list[str] = []
    cur_format: str | None = None

    for gur, trans in tuks:
        # Detect format-header tuk (e.g. ਪਉੜੀ ॥) — strip, record type
        fmt_m = _FORMAT_HEADER_RE.match(gur.strip())
        if fmt_m:
            cur_format = _FORMAT_NAMES.get(fmt_m.group(1), fmt_m.group(1))
            continue

        cur_g.append(gur)
        if trans:
            t = trans.strip()
            # Also drop pure format-label translations ("Pauree:", "Chhant:", …)
            if not _FORMAT_EN_RE.match(t):
                # Strip trailing structural markers: "||3||", "||1||Pause||",
                # "||Pause||", "||1||Second Pause||4||7||", etc.
                t = re.sub(r"\s*\|\|.*$", "", t).strip()
                if t:
                    cur_t.append(t)

        if _STANZA_END_RE.search(gur):
            stanzas.append((cur_g[:], cur_t[:], cur_format))
            cur_g = []
            cur_t = []
            # format carries forward within a shabad (Pauree label applies to
            # all following stanzas until a new format header appears)

    # Trailing tuks that never hit a stanza marker (rare edge case)
    if cur_g:
        stanzas.append((cur_g, cur_t, cur_format))

    return stanzas


def parse_sggs(db_path: str) -> ParsedCorpus:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    # Load authors
    authors: dict[int, str] = {}
    for row in con.execute("SELECT id, author FROM authors"):
        if row["author"] and row["author"].strip().lower() != "none":
            authors[row["id"]] = row["author"]

    # Load all scripture rows with their English translations
    # One row per tuk, ordered by scripture id (document order)
    rows = con.execute(
        """
        SELECT
            s.id,
            s.hymn,
            s.text        AS gurmukhi,
            s.section,
            s.author_id,
            s.page,
            t.text        AS translation
        FROM scriptures s
        LEFT JOIN translations t
            ON t.scripture_id = s.id AND t.language_id = ?
        ORDER BY s.id
        """,
        (_EN_LANG_ID,),
    ).fetchall()

    con.close()

    # Group tuks by hymn, preserving document order
    from collections import OrderedDict
    hymns: OrderedDict[int, list[sqlite3.Row]] = OrderedDict()
    for row in rows:
        hymns.setdefault(row["hymn"], []).append(row)

    units: list[ParsedUnit] = []

    # Track which raag/section nodes have been emitted
    seen_raags: dict[str, bool] = {}
    seen_sections: dict[str, bool] = {}  # key = "raag::section"

    for hymn_num, tuk_rows in hymns.items():
        if not tuk_rows:
            continue

        # Section / raag come from the first tuk of the hymn
        raw_section = tuk_rows[0]["section"] or ""
        raag_name, section_name = _parse_section(raw_section)

        raag_key    = raag_name
        section_key = f"{raag_name}::{section_name}"
        shabad_key  = f"Shabad {hymn_num}"

        # Emit raag node once
        if raag_key not in seen_raags:
            seen_raags[raag_key] = True
            units.append(ParsedUnit(
                key=raag_key,
                parent_key=None,
                depth=0,
                reference_label=raag_name,
            ))

        # Emit section node once
        if section_key not in seen_sections:
            seen_sections[section_key] = True
            units.append(ParsedUnit(
                key=section_key,
                parent_key=raag_key,
                depth=1,
                reference_label=section_name,
                extra_metadata={"raag": raag_name},
            ))

        # Determine shabad author (skip author_id=2 = "None"/preamble)
        author_id    = tuk_rows[0]["author_id"]
        shabad_author = authors.get(author_id) if author_id else None

        # Ang (page) range for this shabad
        pages = [r["page"] for r in tuk_rows if r["page"]]
        ang_start = pages[0] if pages else None
        ang_end   = pages[-1] if pages else None

        units.append(ParsedUnit(
            key=shabad_key,
            parent_key=section_key,
            depth=2,
            reference_label=f"Shabad {hymn_num}",
            author=shabad_author,
            extra_metadata={
                "hymn": hymn_num,
                "ang_start": ang_start,
                "ang_end": ang_end,
                "section": raw_section,
            },
        ))

        # Filter out header tuk (first tuk if it's a mehla/raag declaration)
        content_tuks = tuk_rows
        if tuk_rows and _is_header_tuk(tuk_rows[0]["gurmukhi"] or ""):
            content_tuks = tuk_rows[1:]

        if not content_tuks:
            continue

        tuk_pairs = [
            (r["gurmukhi"] or "", r["translation"])
            for r in content_tuks
        ]
        stanzas = _group_stanzas(tuk_pairs)

        for stanza_idx, (gur_lines, trans_lines, fmt_type) in enumerate(stanzas, start=1):
            # English text: one tuk per line
            en_text = "\n".join(trans_lines) if trans_lines else None
            # Gurmukhi: one tuk per line
            gur_text = "\n".join(gur_lines).strip() or None

            if not en_text and not gur_text:
                continue

            stanza_meta: dict = {}
            if fmt_type:
                stanza_meta["format"] = fmt_type

            units.append(ParsedUnit(
                key=f"{shabad_key}:{stanza_idx}",
                parent_key=shabad_key,
                depth=3,
                reference_label=f"Shabad {hymn_num}:{stanza_idx}",
                text=en_text,
                uncleaned_text=gur_text,
                extra_metadata=stanza_meta,
            ))

    return ParsedCorpus(
        name="Guru Granth Sahib Ji",
        description=(
            "The eternal living Guru of the Sikhs — 1430 angs of sacred hymns "
            "by the Sikh Gurus and saints across multiple traditions"
        ),
        language_of_origin="Punjabi (Gurmukhi)",
        translation_name="GurbaniDB English Translation",
        translator="Multiple (GurbaniDB)",
        language="en",
        source=db_path,
        levels=[
            ParsedLevel(height=3, name="Raag"),
            ParsedLevel(height=2, name="Section"),
            ParsedLevel(height=1, name="Shabad"),
            ParsedLevel(height=0, name="Stanza"),
        ],
        units=units,
        taxonomy_hints=["Sikhism"],
    )
