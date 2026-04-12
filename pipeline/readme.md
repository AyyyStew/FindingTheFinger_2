Run

1. scripts/download_sggs.sh
   Downloads the Sri Guru Granth Sahib database form sourceforege. It is too large to store in this repo

1. scripts/mysql_tosqlite.py
   converts the mysql file to sqlite so parser can work with it

1. scripts/ingest_all.py
   Sees the corpus into the database

1. scripts/pipeline.py
   Ordered pipeline runner. Keeps `ingest_all` as canonical first step and
   runs additional reproducible steps (currently source verification).

Examples:

```bash
./venv/bin/python pipeline/scripts/pipeline.py
./venv/bin/python pipeline/scripts/pipeline.py --list
./venv/bin/python pipeline/scripts/pipeline.py --dry-run
./venv/bin/python pipeline/scripts/pipeline.py --only ingest_all
```
