import * as ort from "onnxruntime-node";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import {
  FIELD_LABELS,
  FIELD_NAMES,
  FieldName,
  ModelPrediction,
  ModelRun,
  TaskPrediction,
} from "./modelComparisonFields";
import {
  VisionImage,
  prepareVisionImage,
  runGemini,
  runGpt,
} from "./modelComparisonLlm";

// ============================================================================
// Configuration
// ============================================================================

// Paths are resolved relative to the BE's project root so the comparison
// works in every environment (local, Render, etc.) without each admin needing
// model files on their machine. Drop new ONNX files into webappAdminBe/models/
// to swap them out without code changes.
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const PRODUCTION_MODEL_PATH =
  process.env.PRODUCTION_MODEL_PATH ||
  path.join(PROJECT_ROOT, "models", "model-production.onnx");
const CANDIDATE_MODEL_PATH =
  process.env.CANDIDATE_MODEL_PATH ||
  path.join(PROJECT_ROOT, "models", "model-candidate.onnx");

const MODEL_INPUT_HEIGHT = 299;
const MODEL_INPUT_WIDTH = 299;

// Temperature scaling on Bristol to counteract focal-loss overconfidence —
// matches the production analyzer behavior so the comparison reflects what
// users actually see.
const BRISTOL_SOFTMAX_TEMPERATURE = Number(
  process.env.BRISTOL_SOFTMAX_TEMPERATURE ?? 4.0,
);

// ONNX output tensor per field — the head names differ from the field names
// only for Bristol.
const onnxOutputName = (field: FieldName): string =>
  field === "bristolType" ? "bristol_type" : field;

export type ComparedModel = "production" | "candidate" | "gpt" | "gemini";

export type ComparisonResult = Record<ComparedModel, ModelRun>;

// ============================================================================
// Model loading — load both ONNX sessions once
// ============================================================================

let productionSessionPromise: Promise<ort.InferenceSession> | null = null;
let candidateSessionPromise: Promise<ort.InferenceSession> | null = null;

function loadSession(
  label: "PRODUCTION" | "CANDIDATE",
  modelPath: string,
): Promise<ort.InferenceSession> {
  if (!fs.existsSync(modelPath)) {
    throw new Error(
      `[modelComparison] ${label} model not found at ${modelPath}. ` +
        `Drop the .onnx file at that path, or set ${label}_MODEL_PATH env var.`,
    );
  }
  console.log(`[modelComparison] Loading ${label} model from ${modelPath}`);
  return ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  }).then((session) => {
    console.log(
      `[modelComparison] ✓ ${label} model loaded (outputs: ${session.outputNames.join(", ")})`,
    );
    return session;
  });
}

/**
 * Lazy load on first call. Lazy so the BE can start even if one of the
 * model files is missing — the error surfaces when the user actually hits
 * the endpoint, with a helpful message.
 */
function getProductionSession(): Promise<ort.InferenceSession> {
  if (!productionSessionPromise) {
    productionSessionPromise = loadSession("PRODUCTION", PRODUCTION_MODEL_PATH);
  }
  return productionSessionPromise;
}

function getCandidateSession(): Promise<ort.InferenceSession> {
  if (!candidateSessionPromise) {
    candidateSessionPromise = loadSession("CANDIDATE", CANDIDATE_MODEL_PATH);
  }
  return candidateSessionPromise;
}

// ============================================================================
// Image preprocessing — match analyzer-onnx.ts exactly
// ============================================================================

async function preprocessImage(imageBuffer: Buffer): Promise<Float32Array> {
  const processed = await sharp(imageBuffer, { failOn: "none" })
    .rotate()
    .resize(MODEL_INPUT_WIDTH, MODEL_INPUT_HEIGHT, { fit: "cover" })
    .toFormat("raw")
    .toBuffer({ resolveWithObject: true });

  const { data } = processed;
  const pixelCount = MODEL_INPUT_HEIGHT * MODEL_INPUT_WIDTH;
  const out = new Float32Array(3 * pixelCount);

  // HWC interleaved -> CHW planar, normalized to [0, 1].
  // (Normalization to ImageNet mean/std is baked into the ONNX wrapper.)
  for (let i = 0; i < pixelCount; i++) {
    const p = i * 3;
    out[i] = (data[p] || 0) / 255.0;
    out[pixelCount + i] = (data[p + 1] || 0) / 255.0;
    out[pixelCount * 2 + i] = (data[p + 2] || 0) / 255.0;
  }
  return out;
}

// ============================================================================
// Softmax + argmax helpers
// ============================================================================

function softmax(logits: Float32Array, temperature = 1.0): number[] {
  const scaled =
    temperature !== 1.0 ? Array.from(logits).map((x) => x / temperature) : Array.from(logits);
  const maxLogit = Math.max(...scaled);
  const exps = scaled.map((x) => Math.exp(x - maxLogit));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((x) => x / sum);
}

function argmax(arr: number[]): number {
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i]! > arr[best]!) best = i;
  }
  return best;
}

function buildTaskPrediction(
  logits: Float32Array,
  labels: readonly string[],
  temperature = 1.0,
): TaskPrediction {
  const probs = softmax(logits, temperature);
  const idx = argmax(probs);
  return {
    probs,
    labels: [...labels],
    argmax: idx,
    argmaxLabel: labels[idx] || "Unknown",
    confidence: probs[idx] || 0,
  };
}

// ============================================================================
// Single ONNX model inference
// ============================================================================

/** Never rejects — a missing model file or bad output becomes that model's error. */
async function runOnnx(
  source: string,
  getSession: () => Promise<ort.InferenceSession>,
  inputTensor: ort.Tensor,
): Promise<ModelRun> {
  let inferenceMs = 0;
  try {
    const session = await getSession();
    const t0 = Date.now();
    const results = await session.run({ input: inputTensor });
    inferenceMs = Date.now() - t0;

    const fields = {} as Record<FieldName, TaskPrediction | null>;
    for (const name of FIELD_NAMES) {
      const out = results[onnxOutputName(name)]?.data;
      if (!out) throw new Error(`Model output '${onnxOutputName(name)}' missing`);
      fields[name] = buildTaskPrediction(
        out as Float32Array,
        FIELD_LABELS[name],
        name === "bristolType" ? BRISTOL_SOFTMAX_TEMPERATURE : 1.0,
      );
    }
    const prediction: ModelPrediction = { fields, gate: null };
    return { ok: true, source, inferenceMs, prediction };
  } catch (err) {
    return {
      ok: false,
      source,
      inferenceMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================================
// Public API: score one image with all four models
// ============================================================================

/** The upload couldn't be decoded as an image — a client error, not a model one. */
export class ImageDecodeError extends Error {}

export async function compareModels(
  imageBuffer: Buffer,
): Promise<ComparisonResult> {
  // Preprocess once per input format: both ONNX models take the same 299x299
  // tensor, both LLMs take the same downscaled JPEG (as in production).
  let inputData: Float32Array;
  let visionImage: VisionImage;
  try {
    [inputData, visionImage] = await Promise.all([
      preprocessImage(imageBuffer),
      prepareVisionImage(imageBuffer),
    ]);
  } catch (err) {
    throw new ImageDecodeError(
      `Could not decode the image: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const inputTensor = new ort.Tensor("float32", inputData, [
    1,
    3,
    MODEL_INPUT_HEIGHT,
    MODEL_INPUT_WIDTH,
  ]);

  // All four in parallel; each one fails on its own without failing the rest.
  const [production, candidate, gpt, gemini] = await Promise.all([
    runOnnx(PRODUCTION_MODEL_PATH, getProductionSession, inputTensor),
    runOnnx(CANDIDATE_MODEL_PATH, getCandidateSession, inputTensor),
    runGpt(visionImage),
    runGemini(visionImage),
  ]);

  return { production, candidate, gpt, gemini };
}
