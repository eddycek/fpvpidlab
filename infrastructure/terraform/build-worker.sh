#!/bin/bash
# Build the telemetry worker into a single JS bundle for Terraform deployment.
# Run from infrastructure/terraform/ directory.
set -euo pipefail

WORKER_DIR="../telemetry-worker"

echo "Building telemetry worker..."
cd "$WORKER_DIR"
npm install --silent
npx wrangler deploy --dry-run --outdir=../terraform 2>/dev/null || true

# Wrangler dry-run outputs to index.js — rename for Terraform
if [ -f "../terraform/index.js" ]; then
  mv "../terraform/index.js" "../terraform/worker-bundle.js"
  echo "Built: infrastructure/terraform/worker-bundle.js"
else
  echo "ERROR: wrangler dry-run did not produce output. Building with esbuild fallback..."
  npx esbuild src/index.ts --bundle --format=esm --outfile=../terraform/worker-bundle.js
  echo "Built: infrastructure/terraform/worker-bundle.js (esbuild)"
fi
