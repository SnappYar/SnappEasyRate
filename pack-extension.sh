#!/usr/bin/env bash
# پک افزونهٔ کروم در یک zip — با رعایت .gitignore و .gitattributes (export-ignore)
# استفاده: ./pack-extension.sh [پوشهٔ خروجی]

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OUT_DIR="${1:-.}"
VERSION="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' manifest.json 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "packed")"
ZIP_NAME="SnappEasyRate-${VERSION}.zip"
mkdir -p "$OUT_DIR"
ZIP_PATH="$(cd "$OUT_DIR" && pwd)/${ZIP_NAME}"

# فهرست مسیرهایی که نباید داخل zip پک باشند (مطابق .gitignore + موارد مضر برای پک)
EXCLUDE_IN_ZIP=(
    ".gitignore"
    ".gitattributes"
    "README.md"
    "installation-user"
    "installation-server"
    "pack-extension.sh"
    "*.zip"
)

echo "در حال ساخت zip افزونه: $ZIP_PATH"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    TMP_DIR=$(mktemp -d)
    trap "rm -rf '$TMP_DIR'" EXIT
    git archive --format=zip --output="$ZIP_PATH" HEAD
    ( cd "$TMP_DIR" && unzip -q -o "$ZIP_PATH" )
    for one in "${EXCLUDE_IN_ZIP[@]}"; do
        rm -rf "$TMP_DIR/$one"
    done
    rm -f "$ZIP_PATH"
    ( cd "$TMP_DIR" && zip -r -q "$ZIP_PATH" . )
else
    # خارج از git: zip با exclude دستی (هم‌خوان با .gitignore)
    zip -r -q "$ZIP_PATH" . \
        -x ".git/*" \
        -x "node_modules/*" \
        -x ".pnp*" \
        -x "coverage/*" \
        -x "build/*" \
        -x "logs/*" \
        -x ".env*" \
        -x ".DS_Store" \
        -x "*.log" \
        -x "installation-user/*" \
        -x "installation-server/*" \
        -x "*.zip" \
        -x "pack-extension.sh"
fi

echo "تمام. خروجی: $ZIP_PATH"
