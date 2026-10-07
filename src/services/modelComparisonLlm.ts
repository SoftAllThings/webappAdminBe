import OpenAI from "openai";
import { GoogleGenAI, Type } from "@google/genai";
import sharp from "sharp";
import {
  FIELD_LABELS,
  FIELD_NAMES,
  FieldName,
  ModelPrediction,
  ModelRun,
  TaskPrediction,
} from "./modelComparisonFields";

// ============================================================================
// GPT + Gemini vision voters for the Model Comparison page.
//
// Mirror of production's ensemble adapters in softai-backend/src/ensemble/
// (visionShared.ts, gptAdapter.ts, geminiAdapter.ts): same models, prompt,
// enum-constrained schemas, image downscale and timeouts, so this page shows
// what the production voters answer. When the prompt changes there, copy it
// here.
// ============================================================================

// Same env overrides and defaults as softai-backend/src/llm/models.ts.
const GPT_VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-5.4-mini";
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL ?? "gemini-2.5-flash";

// Production ensemble defaults (softai-backend/src/ensemble/config.ts). A voter
// slower than this is dropped from the production verdict.
const GPT_TIMEOUT_MS = 25_000;
const GEMINI_TIMEOUT_MS = 25_000;
const VISION_MAX_EDGE = 768;

// ============================================================================
// Clients — created lazily so the BE boots without the keys; a missing key
// surfaces as that model's error on the page.
// ============================================================================

let openaiClient: OpenAI | null = null;
let geminiClient: GoogleGenAI | null = null;

function getOpenAi(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set in the webappAdminBe env.");
  openaiClient ??= new OpenAI({ apiKey });
  return openaiClient;
}

function getGemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in the webappAdminBe env.");
  geminiClient ??= new GoogleGenAI({ apiKey });
  return geminiClient;
}

// ============================================================================
// Image preparation — downscaled JPEG, like production sends the LLMs
// ============================================================================

export interface VisionImage {
  base64: string;
  mimeType: string;
  /** data: URL form, for OpenAI's image_url content part. */
  dataUrl: string;
}

export async function prepareVisionImage(imageBuffer: Buffer): Promise<VisionImage> {
  const out = await sharp(imageBuffer, { failOn: "none" })
    .rotate()
    .resize(VISION_MAX_EDGE, VISION_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const base64 = out.toString("base64");
  return { base64, mimeType: "image/jpeg", dataUrl: `data:image/jpeg;base64,${base64}` };
}

// ============================================================================
// Prompt — verbatim copy of softai-backend/src/ensemble/visionShared.ts
// ============================================================================

const FIELD_HINTS: Partial<Record<FieldName, string>> = {
  bristolType:
    "use the Bristol Stool Scale criteria listed below; pay special attention to the Type 2/3/4/5 boundaries and the Type 5/6 boundary. Type 2 (hard, distinctly lumpy/constipated) is genuinely uncommon — most formed sausage-shaped stool is Type 3 or Type 4. Do NOT pick Type 2 unless you clearly see separate hard lumps fused together; if the stool is a fairly smooth formed sausage with only surface cracks or minor texture, it is Type 3, and if it is smooth and soft it is Type 4. Likewise do NOT pick Type 6 just because the surface looks fluffy or the edges look ragged: stool photographed in toilet water is usually partially submerged, and water frays and fuzzes the surface of perfectly formed stool. Type 6 requires that the stool has lost its overall form — no sausage shape remains, only mushy piles.",
  consistency:
    "hard = firm, holds a rigid shape (Bristol 1-2); normal = well-formed, soft but keeps its shape (Bristol 3-4); soft = loose or mushy, breaks apart easily (Bristol 5-6); liquid = watery, no form (Bristol 7).",
  shape:
    "sausage = long connected cylinder; lumpy = formed but with distinct lumps or segments; flat = flattened or ribbon-like; blob = soft separate blobs with no connected form; liquid = no shape, watery.",
  blood:
    "Visible red or dark blood. Prefer a lower level when unsure, but never ignore clearly visible blood.",
  mucus: "Visible slimy/jelly-like mucus.",
  floating: "Whether the stool floats or sinks.",
};

function buildSystemPrompt(): string {
  const lines: string[] = [];
  lines.push(
    "You are a clinical stool-image analyzer for a gut-health app. Examine the photo of human stool (usually in a toilet) and classify it across the fields below. Base every judgement only on what is visible in the image.",
  );
  lines.push("");
  lines.push(
    'First, decide "isStool": true if the image plausibly shows human stool — including diarrhea, loose or watery stool, smears, mucus, partially submerged or floating stool, blurry photos, and unusual colors. Set false only if it is clearly something else (object, food, animal, empty toilet, screenshot, etc.).',
  );
  lines.push("");
  lines.push(
    "Then, for each field, choose EXACTLY ONE value from its allowed set (use the value verbatim) and give a confidence between 0 and 1:",
  );
  for (const name of FIELD_NAMES) {
    const hint = FIELD_HINTS[name] ? ` — ${FIELD_HINTS[name]}` : "";
    lines.push(`- ${name}: ${FIELD_LABELS[name].join(", ")}${hint}`);
  }
  lines.push("");
  lines.push("Bristol Stool Scale — classify bristolType by these exact criteria:");
  lines.push("- Type 1: separate hard lumps, like nuts (hard to pass)");
  lines.push("- Type 2: sausage-shaped but lumpy");
  lines.push("- Type 3: sausage-shaped with cracks on the surface");
  lines.push("- Type 4: smooth and soft, like a sausage or snake (ideal/normal)");
  lines.push("- Type 5: soft blobs with clear-cut edges (passed easily)");
  lines.push(
    "- Type 6: mushy pieces with ragged edges — the stool has completely lost its form; no log, sausage, or distinct blob shape remains anywhere in the image",
  );
  lines.push("- Type 7: entirely liquid, no solid pieces");
  lines.push("");
  lines.push(
    "Important calibration for the Type 2/3/4 range (the most common and most confused): these three are a continuum and the boundaries are easy to over-call. Type 2 requires clearly visible separate hard lumps fused into a lumpy sausage (a constipated stool) and is genuinely uncommon — do not default to it. A normal formed sausage with cracks on the surface is Type 3; a smooth, soft, snake-like sausage is Type 4. When the stool is well-formed and you are unsure between 2/3/4, prefer Type 3 or Type 4 over Type 2, and do not be overly picky distinguishing 3 from 4.",
  );
  lines.push("");
  lines.push(
    "Important calibration for the Type 5/6 boundary (the most over-called): almost every photo is taken in a toilet, where water softens the stool's surface and frays its edges — a frayed, fuzzy, or partly disintegrating surface on an otherwise formed stool does NOT make it Type 6. Judge the overall form, not the surface texture: if you can still see a sausage/log shape (even broken into segments or partly submerged), it is Type 3 or Type 4; if it is soft separate blobs that each hold their own shape with clear-cut edges, it is Type 5. Reserve Type 6 for stool with no remaining form at all — amorphous mushy piles or scattered fluffy fragments where no piece is a formed log or a distinct blob. When you are unsure between 5 and 6, prefer Type 5; when a recognizable log shape is present, never answer Type 6.",
  );
  lines.push("");
  lines.push(
    "Return ONLY a JSON object matching the provided schema. Never invent values outside the allowed sets.",
  );
  return lines.join("\n");
}

const VISION_SYSTEM_PROMPT = buildSystemPrompt();

const VISION_USER_TEXT =
  "Classify this stool image across every field, and decide whether it shows stool at all. Use only the allowed enum values.";

// ============================================================================
// Response schemas — same shape as production (gate + 9 enum-constrained fields)
// ============================================================================

function buildOpenAiSchema(): Record<string, unknown> {
  const fieldProps: Record<string, unknown> = {};
  for (const name of FIELD_NAMES) {
    fieldProps[name] = {
      type: "object",
      properties: {
        label: { type: "string", enum: [...FIELD_LABELS[name]] },
        confidence: { type: "number", description: "Confidence 0..1" },
      },
      required: ["label", "confidence"],
      additionalProperties: false,
    };
  }
  return {
    type: "object",
    properties: {
      isStool: { type: "boolean" },
      isStoolConfidence: { type: "number", description: "Confidence 0..1" },
      fields: {
        type: "object",
        properties: fieldProps,
        required: [...FIELD_NAMES],
        additionalProperties: false,
      },
    },
    required: ["isStool", "isStoolConfidence", "fields"],
    additionalProperties: false,
  };
}

function buildGeminiSchema(): Record<string, unknown> {
  const fieldProps: Record<string, unknown> = {};
  for (const name of FIELD_NAMES) {
    fieldProps[name] = {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING, enum: [...FIELD_LABELS[name]] },
        confidence: { type: Type.NUMBER },
      },
      required: ["label", "confidence"],
      propertyOrdering: ["label", "confidence"],
    };
  }
  return {
    type: Type.OBJECT,
    properties: {
      isStool: { type: Type.BOOLEAN },
      isStoolConfidence: { type: Type.NUMBER },
      fields: {
        type: Type.OBJECT,
        properties: fieldProps,
        required: [...FIELD_NAMES],
        propertyOrdering: [...FIELD_NAMES],
      },
    },
    required: ["isStool", "isStoolConfidence", "fields"],
    propertyOrdering: ["isStool", "isStoolConfidence", "fields"],
  };
}

const OPENAI_SCHEMA = buildOpenAiSchema();
const GEMINI_SCHEMA = buildGeminiSchema();

// ============================================================================
// Response parsing
// ============================================================================

/** Models are asked for 0..1 but production also accepts 0..100; normalize to 0..1. */
function toConfidence(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  return Math.max(0, Math.min(1, n <= 1 ? n : n / 100));
}

/**
 * Case-insensitive match to the field's label space, like production's
 * canonicalizeLabel. An out-of-space label is dropped (null), not guessed.
 */
function toTaskPrediction(field: FieldName, raw: unknown): TaskPrediction | null {
  const entry = raw as { label?: unknown; confidence?: unknown } | undefined;
  if (!entry || typeof entry.label !== "string") return null;
  const labels = FIELD_LABELS[field];
  const needle = entry.label.trim().toLowerCase();
  const idx = labels.findIndex((l) => l.toLowerCase() === needle);
  if (idx < 0) return null;
  return {
    probs: null,
    labels: [...labels],
    argmax: idx,
    argmaxLabel: labels[idx]!,
    confidence: toConfidence(entry.confidence),
  };
}

function parseVisionResponse(text: string): ModelPrediction {
  const obj = (JSON.parse(text) ?? {}) as Record<string, unknown>;
  const rawFields = (obj.fields ?? {}) as Record<string, unknown>;
  const fields = {} as Record<FieldName, TaskPrediction | null>;
  for (const name of FIELD_NAMES) {
    fields[name] = toTaskPrediction(name, rawFields[name]);
  }
  return {
    fields,
    gate:
      typeof obj.isStool === "boolean"
        ? { isStool: obj.isStool, confidence: toConfidence(obj.isStoolConfidence) }
        : null,
  };
}

// ============================================================================
// Voters
// ============================================================================

/** Time a voter and bound it like production; never rejects. */
async function runVoter(
  source: string,
  timeoutMs: number,
  call: () => Promise<ModelPrediction>,
): Promise<ModelRun> {
  const start = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs / 1000}s — production would drop this vote.`)),
      timeoutMs,
    );
  });
  try {
    const prediction = await Promise.race([call(), timeout]);
    return { ok: true, source, inferenceMs: Date.now() - start, prediction };
  } catch (err) {
    return {
      ok: false,
      source,
      inferenceMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function runGpt(image: VisionImage): Promise<ModelRun> {
  return runVoter(GPT_VISION_MODEL, GPT_TIMEOUT_MS, async () => {
    const completion = await getOpenAi().chat.completions.create(
      {
        model: GPT_VISION_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: VISION_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: image.dataUrl, detail: "auto" } },
              { type: "text", text: VISION_USER_TEXT },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "stool_ensemble_fields", strict: true, schema: OPENAI_SCHEMA },
        },
      },
      { timeout: GPT_TIMEOUT_MS },
    );
    const content = completion.choices[0]?.message.content;
    if (!content) throw new Error("Empty GPT vision response");
    return parseVisionResponse(content);
  });
}

export function runGemini(image: VisionImage): Promise<ModelRun> {
  return runVoter(GEMINI_VISION_MODEL, GEMINI_TIMEOUT_MS, async () => {
    const response = await getGemini().models.generateContent({
      model: GEMINI_VISION_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: image.mimeType, data: image.base64 } },
            { text: VISION_USER_TEXT },
          ],
        },
      ],
      config: {
        systemInstruction: VISION_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        // Cast: our plain schema object is structurally a Gemini Schema.
        responseSchema: GEMINI_SCHEMA as never,
        temperature: 0,
      },
    });
    const text = response.text;
    if (!text) throw new Error("Empty Gemini vision response");
    return parseVisionResponse(text);
  });
}
