#!/bin/bash

# Usage: ./build.sh TEMPLATE PLACEHOLDER1 SOURCE1 PLACEHOLDER2 SOURCE2 ... > OUT

# Check for correct number of arguments
if [ "$#" -lt 3 ] || [ $(($# % 2)) -ne 1 ]; then
    echo "Usage: $0 TEMPLATE PLACEHOLDER1 SOURCE1 [PLACEHOLDER2 SOURCE2 ...] > OUT"
    exit 1
fi

TARGET_FILE=$1
shift 1

# Create a temporary file for the current output state
TMP_OUT=$(mktemp)
cp "$TARGET_FILE" "$TMP_OUT"

# Loop through the placeholder/source pairs
while [ "$#" -gt 0 ]; do
    PLACEHOLDER_TEXT=$1
    REPLACE_SOURCE=$2
    shift 2

    python3 -c "import sys; sys.stdout.write(open(sys.argv[2]).read().replace(sys.argv[3], open(sys.argv[1]).read()))" "$REPLACE_SOURCE" "$TMP_OUT" "$PLACEHOLDER_TEXT" >"${TMP_OUT}.new"

    mv "${TMP_OUT}.new" "$TMP_OUT"

done

cat "$TMP_OUT"

rm -f "$TMP_OUT"
