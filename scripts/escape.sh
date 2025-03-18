#!/usr/bin/env bash

# This script exists to escape characters using `\`

sed 's/'"$1"'/\\&/g'
