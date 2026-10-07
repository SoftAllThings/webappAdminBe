import { Request, Response } from "express";
import { ImageDecodeError, compareModels } from "../services/modelComparisonService";

/**
 * Strip an optional "data:image/...;base64," prefix and return the buffer.
 * Mirrors what the FE typically sends from a FileReader.readAsDataURL.
 */
function decodeBase64Image(input: string): Buffer | null {
  const stripped = input.startsWith("data:")
    ? input.slice(input.indexOf(",") + 1)
    : input;
  try {
    const buf = Buffer.from(stripped, "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

export const modelComparisonController = {
  /**
   * POST /api/model-comparison/compare
   * Body: { imageBase64: string }   // raw base64 OR a data:URL
   * Returns: ComparisonResult — Production ONNX, Candidate ONNX, GPT and
   * Gemini predictions. A model that fails comes back with `ok: false` and
   * its error; the request itself still succeeds.
   */
  async compare(req: Request, res: Response): Promise<void> {
    const body = req.body as { imageBase64?: unknown };

    if (typeof body.imageBase64 !== "string" || !body.imageBase64) {
      res.status(400).json({
        success: false,
        error: { message: "Body must include `imageBase64` (string)." },
      });
      return;
    }

    const buffer = decodeBase64Image(body.imageBase64);
    if (!buffer) {
      res.status(400).json({
        success: false,
        error: { message: "imageBase64 could not be decoded." },
      });
      return;
    }

    try {
      const result = await compareModels(buffer);
      res.json({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[modelComparison/compare] error:", err);
      res.status(err instanceof ImageDecodeError ? 400 : 500).json({
        success: false,
        error: { message },
      });
    }
  },
};
