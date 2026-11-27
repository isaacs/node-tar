#!/usr/bin/env bash
set -e

# The core has no Node.js code. The browser platform makes the build
# fail if a Node.js module gets into it.
for format in esm commonjs; do
  esbuild \
    --minify \
    --platform=browser \
    --sourcemap \
    --bundle dist/$format/index.js \
    --outfile=dist/$format/index.min.js \
    --format=${format/commonjs/cjs}

  esbuild \
    --minify \
    --platform=node \
    --sourcemap \
    --bundle dist/$format/node/index.js \
    --outfile=dist/$format/node/index.min.js \
    --format=${format/commonjs/cjs}
done
