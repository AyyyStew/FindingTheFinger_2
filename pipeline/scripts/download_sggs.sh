#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
cd ../data/raw/Indic_Dharmic/Sikhism/sggs/

ZIP_FILE="gurbanidb_v2.mysql.sql.zip"
URL="https://sourceforge.net/projects/sikher/files/latest/download"

download_zip() {
    echo "Downloading zip..."
    curl -L "$URL" -o "$ZIP_FILE"
}

if [ ! -f "$ZIP_FILE" ]; then
    download_zip
fi

if ! unzip -t "$ZIP_FILE" >/dev/null 2>&1; then
    echo "Invalid zip detected, re-downloading..."
    rm -f "$ZIP_FILE"
    download_zip
fi

unzip -n "$ZIP_FILE"