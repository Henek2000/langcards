#!/bin/bash
# assemble a Pages-like site exactly as .github/workflows/pages.yml does: assemble.sh <src> <dest>
set -e; rm -rf "$2"; mkdir -p "$2"
cd "$1" && cp -r index.html manifest.webmanifest sw.js .nojekyll css js data icons fonts LICENSE "$2"/
