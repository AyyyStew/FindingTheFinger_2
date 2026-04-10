"""
ftf/parsers/poetic_edda.py

Parser for the Project Gutenberg Poetic Edda (Henry Adams Bellows translation).
Stanzas are identified by numbered blocks whose first line contains '|'
(Bellows' caesura marker). Norse names and English titles ported from v2.

Hierarchy:
    Poem    depth=0  height=1
    Stanza  depth=1  height=0  (leaf)

Usage:
    from ftf.parsers.poetic_edda import parse_poetic_edda
    parsed = parse_poetic_edda("data/raw/Historical_Ancient/Germanic/poetic_eda.txt")
"""

import re

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

# Maps exact heading in file → (Norse name, English subtitle)
POEMS: dict[str, tuple[str, str]] = {
    "VOLUSPO":                                     ("Völuspá",                    "The Wise-Woman's Prophecy"),
    "HOVAMOL":                                     ("Hávamál",                    "Sayings of the High One"),
    "VAFTHRUTHNISMOL":                             ("Vafþrúðnismál",              "The Ballad of Vafthruthnir"),
    "GRIMNISMOL":                                  ("Grímnismál",                 "The Ballad of Grimnir"),
    "SKIRNISMOL":                                  ("Skírnismál",                 "The Ballad of Skirnir"),
    "HARBARTHSLJOTH":                              ("Hárbarðsljóð",               "The Poem of Harbarth"),
    "HYMISKVITHA":                                 ("Hymiskviða",                 "The Lay of Hymir"),
    "LOKASENNA":                                   ("Lokasenna",                  "Loki's Wrangling"),
    "THRYMSKVITHA":                                ("Þrymskviða",                 "The Lay of Thrym"),
    "ALVISSMOL":                                   ("Álvíssmál",                  "The Ballad of Alvis"),
    "RIGSTHULA":                                   ("Rígsþula",                   "The Song of Rig"),
    "HYNDLULJOTH":                                 ("Hyndluljóð",                 "The Poem of Hyndla"),
    "FRAGMENT OF \u201cTHE SHORT VOLUSPO\u201d":  ("Grógaldr",                   "The Spell of Groa"),
    "II. FJOLSVINNSMOL":                           ("Fjölsvinnsmál",              "The Lay of Fjolsvith"),
    "VÖLUNDARKVITHA":                              ("Völundarkviða",              "The Lay of Völund"),
    "HELGAKVITHA HJORVARTHSSONAR":                ("Helgakviða Hjörvarðssonar",  "The Lay of Helgi Hjorvarthsson"),
    "HELGAKVITHA HUNDINGSBANA I":                 ("Helgakviða Hundingsbana I",  "The First Lay of Helgi Hundingsbane"),
    "HELGAKVITHA HUNDINGSBANA II":                ("Helgakviða Hundingsbana II", "The Second Lay of Helgi Hundingsbane"),
    "REGINSMOL":                                   ("Reginsmál",                  "The Ballad of Regin"),
    "FAFNISMOL":                                   ("Fáfnismál",                  "The Ballad of Fafnir"),
    "SIGRDRIFUMOL":                                ("Sigrdrífumál",               "The Ballad of the Victory-Bringer"),
    "BROT AF SIGURTHARKVITHU":                     ("Brot af Sigurðarkviðu",      "Fragment of a Sigurd Lay"),
    "GUTHRUNARKVITHA I":                           ("Guðrúnarkviða I",            "The First Lay of Guthrun"),
    "SIGURTHARKVITHA EN SKAMMA":                   ("Sigurðarkviða in skamma",    "The Short Lay of Sigurd"),
    "GUTHRUNARKVITHA II, EN FORNA":                ("Guðrúnarkviða II",           "The Second Lay of Guthrun"),
    "GUTHRUNARKVITHA III":                         ("Guðrúnarkviða III",          "The Third Lay of Guthrun"),
    "ODDRUNARGRATR":                               ("Oddrúnargrátr",              "The Lament of Oddrun"),
    "ATLAKVITHA EN GRÖNLENZKA":                    ("Atlakviða",                  "The Greenland Lay of Atli"),
    "ATLAMOL EN GRÖNLENZKU":                       ("Atlamál",                    "The Greenland Ballad of Atli"),
    "HAMTHESMOL":                                  ("Hamðismál",                  "The Ballad of Hamther"),
}

_STANZA_START = re.compile(r"^(\d+)\.\s+\S")
_CAESURA      = re.compile(r"\s+\|\s+")


def _clean_line(line: str) -> str:
    return _CAESURA.sub(" ", line).strip()


def _parse_stanzas(lines: list[str]) -> list[tuple[int, str]]:
    stanzas: list[tuple[int, str]] = []
    current_num:   int | None  = None
    current_lines: list[str]   = []

    def flush() -> None:
        if current_num is not None and current_lines and "|" in current_lines[0]:
            body = "\n".join(_clean_line(l) for l in current_lines if l.strip())
            stanzas.append((current_num, body))

    for line in lines:
        m = _STANZA_START.match(line)
        if m:
            flush()
            current_num   = int(m.group(1))
            current_lines = [re.sub(r"^\d+\.\s+", "", line).rstrip()]
        elif current_num is not None:
            stripped = line.strip()
            if stripped:
                current_lines.append(stripped)
            else:
                flush()
                current_num   = None
                current_lines = []

    flush()
    return stanzas


def parse_poetic_edda(txt_path: str) -> ParsedCorpus:
    with open(txt_path, encoding="utf-8") as f:
        lines = f.readlines()

    # Find poem start positions by exact heading match
    poem_starts: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        if line.strip() in POEMS:
            poem_starts.append((i, line.strip()))

    units: list[ParsedUnit] = []

    for idx, (start_i, key) in enumerate(poem_starts):
        end_i         = poem_starts[idx + 1][0] if idx + 1 < len(poem_starts) else len(lines)
        norse, english = POEMS[key]
        stanzas       = _parse_stanzas(lines[start_i:end_i])

        if not stanzas:
            continue

        units.append(ParsedUnit(
            key=norse,
            parent_key=None,
            depth=0,
            reference_label=norse,
            extra_metadata={"english_title": english},
        ))

        for stanza_num, body in stanzas:
            units.append(ParsedUnit(
                key=f"{norse} {stanza_num}",
                parent_key=norse,
                depth=1,
                reference_label=f"{norse} {stanza_num}",
                text=body,
            ))

    return ParsedCorpus(
        name="Poetic Edda",
        description="Collection of Old Norse poems from the Icelandic medieval manuscript Codex Regius",
        language_of_origin="Old Norse",
        translation_name="Henry Adams Bellows Translation",
        translator="Henry Adams Bellows",
        language="en",
        source=txt_path,
        levels=[
            ParsedLevel(height=1, name="Poem"),
            ParsedLevel(height=0, name="Stanza"),
        ],
        units=units,
        taxonomy_hints=["Norse / Germanic"],
    )
