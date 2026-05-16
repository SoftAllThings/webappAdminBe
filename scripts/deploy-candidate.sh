#!/usr/bin/env bash
# Swap the candidate model used by /api/model-comparison.
#
# Usage:
#   ./scripts/deploy-candidate.sh                       # uses default source
#   ./scripts/deploy-candidate.sh /path/to/model.onnx   # uses given source
#
# Default source assumes the standard local layout:
#   /Users/fab/Desktop/AI project/deployment/ml/model.onnx
set -euo pipefail

DEFAULT_SRC="/Users/fab/Desktop/AI project/deployment/ml/model.onnx"
SRC="${1:-$DEFAULT_SRC}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HERE/../models/model-candidate.onnx"

if [[ ! -f "$SRC" ]]; then
  echo "Source not found: $SRC" >&2
  echo "Re-export the latest ONNX:" >&2
  echo "  cd \"/Users/fab/Desktop/AI project/deployment/ml\" && python3 export_onnx.py" >&2
  exit 1
fi

echo "Copying $SRC → $DEST"
cp "$SRC" "$DEST"
echo "Done. Restart the BE so the new candidate is picked up:"
echo "  cd \"$HERE/..\" && npm run dev"
