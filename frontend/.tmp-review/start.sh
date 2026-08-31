#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec ./node_modules/.bin/vite --config .tmp-review/vite.config.mts
