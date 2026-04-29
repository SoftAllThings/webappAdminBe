import { Request, Response } from "express";
import OpenAI from "openai";
import { poopService } from "../services/poopService";
import {
  CreatePoopRecord,
  UpdatePoopRecord,
  PoopListResponse,
  PoopDetailResponse,
} from "../types/poop";
import {
  validatePagination,
  validateBristolType,
  validateColor,
  validateConsistency,
  validateFloating,
  validateHealth,
  validateId,
  validateCreatePoop,
  parseSearchCriteria,
} from "../validators/poop.validator";
import { PoopListFilters } from "../repositories/poop.repository";

export class PoopController {
  async getAllPoops(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const parseIntParam = (raw: unknown): number | undefined => {
        if (raw === undefined || raw === null || raw === "") return undefined;
        const n = parseInt(raw as string);
        return Number.isNaN(n) ? undefined : n;
      };

      const filters: PoopListFilters = {};
      const bristolTypeParam = parseIntParam(req.query.bristol_type);
      if (bristolTypeParam !== undefined) filters.bristolType = bristolTypeParam;
      const colorParam = parseIntParam(req.query.color);
      if (colorParam !== undefined) filters.color = colorParam;
      const floatingParam = parseIntParam(req.query.floating);
      if (floatingParam !== undefined) filters.floating = floatingParam;
      const consistencyParam = parseIntParam(req.query.consistency);
      if (consistencyParam !== undefined) filters.consistency = consistencyParam;
      const healthParam = parseIntParam(req.query.health);
      if (healthParam !== undefined) filters.health = healthParam;
      if (req.query.blood === "present") filters.bloodPresent = true;
      if (req.query.mucus === "present") filters.mucusPresent = true;

      const paginationResult = validatePagination(page, limit);
      if (!paginationResult.valid) {
        res.status(400).json({
          success: false,
          error: { message: paginationResult.error },
        });
        return;
      }

      const validations = [
        validateBristolType(filters.bristolType),
        validateColor(filters.color),
        validateFloating(filters.floating),
        validateConsistency(filters.consistency),
        validateHealth(filters.health),
      ];
      const failed = validations.find((v) => !v.valid);
      if (failed) {
        res.status(400).json({
          success: false,
          error: { message: failed.error },
        });
        return;
      }

      const { records, total } = await poopService.getAllPoops(
        page,
        limit,
        filters
      );

      const response: PoopListResponse = {
        success: true,
        data: records,
        meta: {
          total,
          page,
          limit,
          ...(filters.bristolType !== undefined && {
            bristolType: filters.bristolType,
          }),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      console.error("Error in getAllPoops:", error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to fetch poop records" },
      });
    }
  }

  async getPoopById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const idResult = validateId(id);
      if (!idResult.valid || !id) {
        res.status(400).json({
          success: false,
          error: { message: idResult.error },
        });
        return;
      }

      const record = await poopService.getPoopById(id);

      if (!record) {
        res.status(404).json({
          success: false,
          error: { message: "Poop record not found" },
        });
        return;
      }

      const response: PoopDetailResponse = {
        success: true,
        data: record,
      };

      res.status(200).json(response);
    } catch (error) {
      console.error("Error in getPoopById:", error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to fetch poop record" },
      });
    }
  }

  async createPoop(req: Request, res: Response): Promise<void> {
    try {
      const data: CreatePoopRecord = req.body;

      const createResult = validateCreatePoop(data);
      if (!createResult.valid) {
        res.status(400).json({
          success: false,
          error: { message: createResult.error },
        });
        return;
      }

      const newRecord = await poopService.createPoop(data);

      const response: PoopDetailResponse = {
        success: true,
        data: newRecord,
      };

      res.status(201).json(response);
    } catch (error) {
      console.error("Error in createPoop:", error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to create poop record" },
      });
    }
  }

  async getLastTypeVerified(req: Request, res: Response): Promise<void> {
    try {
      const record = await poopService.getLastTypeVerified();
      res.status(200).json({
        success: true,
        data: record,
      });
    } catch (error) {
      console.error("Error in getLastTypeVerified:", error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to fetch last verified bristol type" },
      });
    }
  }

  async getBristolStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await poopService.getBristolStats();
      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("Error in getBristolStats:", error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to fetch bristol stats" },
      });
    }
  }

  async updatePoop(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data: Partial<UpdatePoopRecord> = req.body;

      console.log("🔧 updatePoop controller called with:", { id, data });

      const idResult = validateId(id);
      if (!idResult.valid || !id) {
        res.status(400).json({
          success: false,
          error: { message: idResult.error },
        });
        return;
      }

      console.log("🔍 Checking if record exists...");
      const existingRecord = await poopService.getPoopById(id);
      if (!existingRecord) {
        console.log("❌ Record not found");
        res.status(404).json({
          success: false,
          error: { message: "Poop record not found" },
        });
        return;
      }

      console.log("✅ Record exists, proceeding with update...");
      const updatedRecord = await poopService.updatePoop(id, data);

      const response: PoopDetailResponse = {
        success: true,
        data: updatedRecord!,
      };

      console.log("✅ Update completed successfully");
      res.status(200).json(response);
    } catch (error) {
      console.error("❌ Error in updatePoop controller:", error);
      console.error("❌ Error stack:", (error as Error).stack);
      res.status(500).json({
        success: false,
        error: { message: "Failed to update poop record" },
      });
    }
  }

  async analyzeCrop(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { imageBase64 } = req.body;

      const idResult = validateId(id);
      if (!idResult.valid || !id) {
        res.status(400).json({ success: false, error: { message: idResult.error } });
        return;
      }

      if (!imageBase64 || typeof imageBase64 !== "string") {
        res.status(400).json({ success: false, error: { message: "imageBase64 is required" } });
        return;
      }

      if (!process.env.OPENAI_API_KEY) {
        res.status(500).json({ success: false, error: { message: "OPENAI_API_KEY is not configured on the server" } });
        return;
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 600,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are analyzing a stool image for medical-grade ML training data labeling.

Provide a concise, structured analysis with:
1. Bristol Stool Type (1-7) with brief justification
2. Color (e.g. brown, dark brown, green, yellow, black, red)
3. Consistency (e.g. hard, formed, soft, loose, watery)
4. Shape (e.g. separate lumps, sausage-like, fluffy, liquid)
5. Notable characteristics (e.g. mucus, blood, floating, unusual features)
6. Image quality for ML training (good / poor — and why)

Be factual and clinical. Do not add disclaimers or wellness advice.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
      });

      const analysis = completion.choices[0]?.message?.content;
      if (!analysis) {
        res.status(500).json({ success: false, error: { message: "No analysis returned from AI" } });
        return;
      }

      res.json({ success: true, data: { analysis } });
    } catch (error) {
      console.error("Error in analyzeCrop:", error);
      res.status(500).json({ success: false, error: { message: "Failed to analyze image" } });
    }
  }

  async searchPoops(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const criteria = parseSearchCriteria(req.query as Record<string, any>);

      const { records, total } = await poopService.searchPoops(
        criteria,
        page,
        limit
      );

      const response: PoopListResponse = {
        success: true,
        data: records,
        meta: {
          total,
          page,
          limit,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      console.error("Error in searchPoops:", error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to search poop records" },
      });
    }
  }
}

export const poopController = new PoopController();
