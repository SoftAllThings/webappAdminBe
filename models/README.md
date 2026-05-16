# Model files for /api/model-comparison

Two ONNX files live here, both required by the Model Comparison admin page:

| File | What it is |
|---|---|
| `model-production.onnx` | The model currently serving real users (mirror of `softai-backend/models/model.onnx`). Update this when a new model goes live in production. |
| `model-candidate.onnx` | The model you're evaluating before deploying. Update this whenever you finish a new training run. |

Both are loaded at the first `/api/model-comparison/compare` request (lazy, so the BE can boot even if one file is missing — the error surfaces at request time with a helpful message).

## Swap in a new candidate after training

1. Re-export your latest checkpoint to ONNX:
   ```bash
   cd "/Users/fab/Desktop/AI project/deployment/ml"
   python3 export_onnx.py
   ```
2. Copy the freshly exported file in:
   ```bash
   cp "/Users/fab/Desktop/AI project/deployment/ml/model.onnx" \
      "/Users/fab/Desktop/softallthings/webappAdminBe/models/model-candidate.onnx"
   ```
3. Restart the BE (`npm run dev`) — it'll re-load on the next request.

A convenience script `scripts/deploy-candidate.sh` does steps 2-3 in one go.

## Override paths at runtime

If you ever need to point at files outside this directory (e.g. on a Render
deploy with a mounted disk), set env vars in `.env`:

```
PRODUCTION_MODEL_PATH=/path/to/production.onnx
CANDIDATE_MODEL_PATH=/path/to/candidate.onnx
```

## Deployment note

Each file is ~55MB. If you commit them to git directly, your repo grows fast.
Options:
- **Git LFS** — track `*.onnx` (recommended).
- **Download on startup** from S3 if you already host models there.
- **Render persistent disk** — `scp` files in once, leave them mounted.

The service is lazy-load + env-var-overridable, so any of these works without
code changes.
