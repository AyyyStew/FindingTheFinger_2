"""Compatibility shim for importing source catalog as `pipeline.sources`.

This allows both import layouts:
- repo root on sys.path (`pipeline.pipeline.sources` real package)
- `pipeline/` dir on sys.path (`pipeline.sources` real package)
"""

from .catalog import SourceCatalogEntry, get_source_entry

__all__ = ["SourceCatalogEntry", "get_source_entry"]
