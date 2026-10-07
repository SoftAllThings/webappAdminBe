// ============================================================================
// Field table + result types shared by the ONNX runner and the GPT/Gemini
// voters on the Model Comparison page.
//
// Mirrors softai-backend/src/ensemble/fieldSpec.ts. Index order is locked by
// mlMapping.json and analyzer-onnx.ts, and the LLM response schemas are built
// from this same table, so all four models answer in one label space.
// ============================================================================

export type FieldName =
  | "bristolType"
  | "consistency"
  | "shape"
  | "quantity"
  | "color"
  | "health"
  | "blood"
  | "mucus"
  | "floating";

export const FIELD_LABELS: Record<FieldName, readonly string[]> = {
  bristolType: ["Type 1", "Type 2", "Type 3", "Type 4", "Type 5", "Type 6", "Type 7"],
  consistency: ["hard", "soft", "normal", "liquid"],
  shape: ["sausage", "lumpy", "flat", "blob", "liquid"],
  quantity: ["small", "normal", "large"],
  color: ["black", "white", "green", "yellow", "red", "brown", "orange"],
  health: ["healthy", "unhealthy"],
  blood: ["none", "trace", "moderate", "high"],
  mucus: ["none", "trace", "moderate", "high"],
  floating: ["sink", "float"],
};

export const FIELD_NAMES = Object.keys(FIELD_LABELS) as FieldName[];

// ============================================================================
// Types (shared with the FE — webappAdmin/src/services/api.modelComparison.ts)
// ============================================================================

export interface TaskPrediction {
  /**
   * Probability per class, parallel to `labels`. null for GPT/Gemini, which
   * only report a confidence for the label they picked.
   */
  probs: number[] | null;
  labels: string[];
  /** Index of the picked label. */
  argmax: number;
  /** Picked label (convenience). */
  argmaxLabel: string;
  /** Confidence in the picked label (0..1). */
  confidence: number;
}

/** An LLM's "is this stool?" opinion. Production rejects the photo when false. */
export interface StoolGate {
  isStool: boolean;
  /** 0..1 */
  confidence: number;
}

export interface ModelPrediction {
  /** null when the model omitted the field or answered outside its label space. */
  fields: Record<FieldName, TaskPrediction | null>;
  /** null for ONNX models, which have no gate. */
  gate: StoolGate | null;
}

/** One model's run on one image. A failed model doesn't fail the comparison. */
export type ModelRun =
  | {
      ok: true;
      /** ONNX file path, or the LLM model id. */
      source: string;
      /** ONNX: session.run time. LLMs: API round-trip. */
      inferenceMs: number;
      prediction: ModelPrediction;
    }
  | {
      ok: false;
      source: string;
      inferenceMs: number;
      error: string;
    };
