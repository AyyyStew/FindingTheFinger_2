"""Parser for Anguttara Nikaya from Handful of Leaves EPUB."""

from pipeline.parsers.sutta_pitaka_common import NikayaSpec, parse_standard_nikaya


def parse_anguttara_nikaya(epub_path: str):
    return parse_standard_nikaya(
        epub_path,
        NikayaSpec(
            code="AN",
            corpus_name="Anguttara Nikaya",
            description="Numerical Discourses of the Buddha",
        ),
    )
