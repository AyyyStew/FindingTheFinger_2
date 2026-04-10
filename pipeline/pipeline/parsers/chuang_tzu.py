"""
ftf/parsers/chuang_tzu.py

Parser for the Project Gutenberg Chuang Tzu (Herbert Allen Giles translation).
Chapters are the leaf units — no natural sub-verse structure exists in this text.
Ported from v2/add_chuang_tzu_giles.py.

Hierarchy:
    Chapter  depth=0  height=0  (leaf)

Usage:
    from ftf.parsers.chuang_tzu import parse_chuang_tzu
    parsed = parse_chuang_tzu("data/raw/East Asian/Taoism/chuang_tzu.txt")
"""

import re

from pipeline.parsers.base import ParsedCorpus, ParsedLevel, ParsedUnit

_CHAPTER_RE = re.compile(r"^CHAPTER\s+(I{1,3}|IV|VI{0,3}|IX|X{1,3}I{0,3}|X{1,3}(?:IX|IV|V?I{0,3})|XXXIII?)\.$", re.MULTILINE)

_ROMAN: dict[str, int] = {
    "I":1,"II":2,"III":3,"IV":4,"V":5,"VI":6,"VII":7,"VIII":8,"IX":9,"X":10,
    "XI":11,"XII":12,"XIII":13,"XIV":14,"XV":15,"XVI":16,"XVII":17,"XVIII":18,
    "XIX":19,"XX":20,"XXI":21,"XXII":22,"XXIII":23,"XXIV":24,"XXV":25,
    "XXVI":26,"XXVII":27,"XXVIII":28,"XXIX":29,"XXX":30,"XXXI":31,"XXXII":32,"XXXIII":33,
}


def parse_chuang_tzu(txt_path: str) -> ParsedCorpus:
    with open(txt_path, encoding="utf-8") as f:
        lines = f.readlines()

    units: list[ParsedUnit] = []
    n = len(lines)
    i = 0

    while i < n:
        line = lines[i].rstrip()
        m = _CHAPTER_RE.match(line)
        if m:
            roman  = m.group(1)
            ch_num = _ROMAN.get(roman)
            if ch_num is None:
                i += 1
                continue

            # Next non-blank line = chapter title
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            title = lines[j].strip().rstrip(".") if j < n else ""
            label = f"{roman} — {title}"

            # Collect body until next chapter or end of main text
            body_lines: list[str] = []
            k = j + 1
            in_argument = False
            while k < n:
                l = lines[k].rstrip()
                if _CHAPTER_RE.match(l) or l.startswith("*** END OF THE PROJECT GUTENBERG"):
                    break
                stripped = l.lstrip()
                if stripped.startswith("_Argument_"):
                    in_argument = True
                    k += 1
                    continue
                if in_argument:
                    if not stripped:
                        in_argument = False
                    k += 1
                    continue
                # Skip indented notes (4+ spaces)
                if stripped and l.startswith("    "):
                    k += 1
                    continue
                body_lines.append(l)
                k += 1

            body = "\n".join(body_lines).strip()
            body = re.sub(r"\n{3,}", "\n\n", body)
            body = re.sub(r"\[\d+\]", "", body)        # footnote markers
            body = re.sub(r"_([^_]+)_", r"\1", body)   # _italic_ markers
            body = body.strip()

            if body:
                units.append(ParsedUnit(
                    key=f"Chapter {roman}",
                    parent_key=None,
                    depth=0,
                    reference_label=label,
                    text=body,
                ))
            i = k
        else:
            i += 1

    # Sort by chapter number in case of out-of-order matches
    units.sort(key=lambda u: _ROMAN.get(u.key.split()[-1], 0))

    return ParsedCorpus(
        name="Chuang Tzu",
        description="Taoist classic attributed to Zhuangzi, exploring spontaneity and the nature of things",
        language_of_origin="Classical Chinese",
        translation_name="Herbert Allen Giles Translation",
        translator="Herbert Allen Giles",
        language="en",
        source=txt_path,
        levels=[
            ParsedLevel(height=0, name="Chapter"),
        ],
        units=units,
        taxonomy_hints=["Taoism"],
    )
