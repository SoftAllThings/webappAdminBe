import { Request, Response } from "express";
import { poopService } from "../services/poopService";
import { uploadImage } from "../services/s3Service";
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

  async getImage(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const idResult = validateId(id);
      if (!idResult.valid || !id) {
        res.status(400).json({ success: false, error: { message: idResult.error } });
        return;
      }

      const record = await poopService.getPoopById(id);
      if (!record) {
        res.status(404).json({ success: false, error: { message: "Poop record not found" } });
        return;
      }

      if (!record.s3_url) {
        res.status(404).json({ success: false, error: { message: "Record has no image" } });
        return;
      }

      const upstream = await fetch(record.s3_url);
      if (!upstream.ok || !upstream.body) {
        res.status(502).json({
          success: false,
          error: { message: `Upstream image fetch failed (${upstream.status})` },
        });
        return;
      }

      const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=300");

      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.status(200).send(buffer);
    } catch (error) {
      console.error("Error in getImage:", error);
      res.status(500).json({ success: false, error: { message: "Failed to fetch image" } });
    }
  }

  async replaceImage(req: Request, res: Response): Promise<void> {
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

      const existing = await poopService.getPoopById(id);
      if (!existing) {
        res.status(404).json({ success: false, error: { message: "Poop record not found" } });
        return;
      }

      const bytes = Buffer.from(imageBase64, "base64");
      const { s3Key, s3Url } = await uploadImage(id, bytes, "image/jpeg", "jpg");
      const updated = await poopService.updateImage(id, s3Key, s3Url);

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error("Error in replaceImage:", error);
      res.status(500).json({ success: false, error: { message: "Failed to replace image" } });
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
