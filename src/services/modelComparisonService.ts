import * as ort from "onnxruntime-node";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

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

// Label schemas — index order is locked by mlMapping.json and analyzer-onnx.ts.
const BRISTOL_LABELS = [
  "Type 1",
  "Type 2",
  "Type 3",
  "Type 4",
  "Type 5",
  "Type 6",
  "Type 7",
];

const SECONDARY_LABELS = {
  consistency: ["hard", "soft", "normal", "liquid"],
  shape: ["sausage", "lumpy", "flat", "blob", "liquid"],
  quantity: ["small", "normal", "large"],
  color: ["black", "white", "green", "yellow", "red", "brown", "orange"],
  health: ["healthy", "unhealthy"],
  blood: ["none", "trace", "moderate", "high"],
  mucus: ["none", "trace", "moderate", "high"],
  floating: ["sink", "float"],
} as const;

type SecondaryTaskName = keyof typeof SECONDARY_LABELS;
const SECONDARY_TASK_NAMES = Object.keys(SECONDARY_LABELS) as SecondaryTaskName[];

// ============================================================================
// Types (shared with the FE)
// ============================================================================

export interface TaskPrediction {
  /** Probability per class, in label-index order. */
  probs: number[];
  /** Label names, parallel to `probs`. */
  labels: string[];
  /** argmax index. */
  argmax: number;
  /** Label at argmax (convenience). */
  argmaxLabel: string;
  /** Confidence at argmax (0..1). */
  confidence: number;
}

export interface ModelPrediction {
  bristolType: TaskPrediction;
  secondary: Record<SecondaryTaskName, TaskPrediction>;
  /** Wall-clock inference time (ms) for this model on this image. */
  inferenceMs: number;
}

export interface ComparisonResult {
  production: ModelPrediction;
  candidate: ModelPrediction;
  productionModelPath: string;
  candidateModelPath: string;
}

// ============================================================================
// Model loading — load both sessions once at startup
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
// Single-model inference
// ============================================================================

async function runModel(
  session: ort.InferenceSession,
  inputTensor: ort.Tensor,
): Promise<ModelPrediction> {
  const t0 = Date.now();
  const results = await session.run({ input: inputTensor });
  const inferenceMs = Date.now() - t0;

  const get = (name: string): Float32Array => {
    const out = results[name]?.data;
    if (!out) throw new Error(`Model output '${name}' missing`);
    return out as Float32Array;
  };

  const bristolType = buildTaskPrediction(
    get("bristol_type"),
    BRISTOL_LABELS,
    BRISTOL_SOFTMAX_TEMPERATURE,
  );

  const secondary = {} as Record<SecondaryTaskName, TaskPrediction>;
  for (const name of SECONDARY_TASK_NAMES) {
    secondary[name] = buildTaskPrediction(get(name), SECONDARY_LABELS[name]);
  }

  return { bristolType, secondary, inferenceMs };
}

// ============================================================================
// Public API: compare both models on one image
// ============================================================================

export async function compareModels(
  imageBuffer: Buffer,
): Promise<ComparisonResult> {
  // Preprocess once — both models take identical input.
  const inputData = await preprocessImage(imageBuffer);
  const inputTensor = new ort.Tensor("float32", inputData, [
    1,
    3,
    MODEL_INPUT_HEIGHT,
    MODEL_INPUT_WIDTH,
  ]);

  // Run both models in parallel.
  const [productionSession, candidateSession] = await Promise.all([
    getProductionSession(),
    getCandidateSession(),
  ]);
  const [production, candidate] = await Promise.all([
    runModel(productionSession, inputTensor),
    runModel(candidateSession, inputTensor),
  ]);

  return {
    production,
    candidate,
    productionModelPath: PRODUCTION_MODEL_PATH,
    candidateModelPath: CANDIDATE_MODEL_PATH,
  };
}
