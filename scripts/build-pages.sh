#!/usr/bin/env bash
# Cloudflare Pages build: Pages has no ignore file, so copy only the public site into dist/.
# Leaves out everything .vercelignore lists (camera originals, supabase/, .claude/, ...), plus
# dotfiles, Vercel-only files, and functions/ (Pages reads that from the repo root itself).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist
mkdir dist
tar -cf - \
  --exclude-vcs --exclude='./.*' --exclude=./dist --exclude=./functions \
  --exclude=./vercel.json --exclude=./middleware.js \
  --exclude-from=.vercelignore \
  . | tar -xf - -C dist
echo "dist: $(find dist -type f | wc -l) files, $(du -sh dist | cut -f1)"
