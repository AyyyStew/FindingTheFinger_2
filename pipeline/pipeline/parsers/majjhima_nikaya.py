"""Parser for Majjhima Nikaya from Handful of Leaves EPUB."""

from pipeline.parsers.sutta_pitaka_common import NikayaSpec, parse_standard_nikaya


def parse_majjhima_nikaya(epub_path: str):
    return parse_standard_nikaya(
        epub_path,
        NikayaSpec(
            code="MN",
            corpus_name="Majjhima Nikaya",
            description="Middle Length Discourses of the Buddha",
        ),
    )
