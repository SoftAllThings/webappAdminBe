import * as fs from "fs";
import * as path from "path";

/**
 * Integer → string labels for app.poop's coded columns.
 *
 * Loaded from mapping.json at the repo root — the same table the
 * Firestore→Postgres import uses to encode these columns, and the ONNX model's
 * class order (softai-backend/mlMapping.json). src/types/poop.ts has its own
 * *_TYPES constants; those are stale (they put Brown at 0) and must never be
 * used for anything a buyer sees.
 */

export const LABEL_FIELDS = [
  "consistency",
  "shape",
  "quantity",
  "color",
  "health",
  "blood",
  "mucus",
  "floating",
] as const;
export type LabelField = (typeof LABEL_FIELDS)[number];

/** Same three levels the import maps the condition screenings onto. */
export const CONDITION_LEVELS = ["low", "moderate", "high"] as const;

// src/services/dataSamples → repo root, and the same from dist/services/dataSamples.
const MAPPING_PATH = path.resolve(__dirname, "../../../mapping.json");

function load(): Record<LabelField, readonly string[]> {
  const raw = fs.readFileSync(MAPPING_PATH, "utf8");
  // mapping.json carries JSONC-style line comments; strip them before parsing.
  const parsed = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;

  const out = {} as Record<LabelField, readonly string[]>;
  for (const field of LABEL_FIELDS) {
    const table = parsed[field];
    if (!table || typeof table !== "object") {
      throw new Error(`mapping.json has no table for '${field}'`);
    }
    const byCode: string[] = [];
    for (const [label, code] of Object.entries(table as Record<string, unknown>)) {
      if (typeof code !== "number" || byCode[code] !== undefined) {
        throw new Error(`mapping.json '${field}': bad or duplicate code for '${label}'`);
      }
      byCode[code] = label;
    }
    // A gap would silently decode a valid code to undefined.
    if (byCode.some((l) => l === undefined) || byCode.length === 0) {
      throw new Error(`mapping.json '${field}': codes must be contiguous from 0`);
    }
    out[field] = byCode;
  }
  return out;
}

/** Ordered labels per field: index = the integer stored in app.poop. */
export const LABELS: Record<LabelField, readonly string[]> = load();

export function isLabelField(name: string): name is LabelField {
  return (LABEL_FIELDS as readonly string[]).includes(name);
}
