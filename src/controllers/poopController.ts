import { Request, Response } from "express";
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
  validateId,
  validateCreatePoop,
  parseSearchCriteria,
} from "../validators/poop.validator";

export class PoopController {
  async getAllPoops(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const bristolType = req.query.bristol_type
        ? parseInt(req.query.bristol_type as string)
        : undefined;

      const paginationResult = validatePagination(page, limit);
      if (!paginationResult.valid) {
        res.status(400).json({
          success: false,
          error: { message: paginationResult.error },
        });
        return;
      }

      const bristolResult = validateBristolType(bristolType);
      if (!bristolResult.valid) {
        res.status(400).json({
          success: false,
          error: { message: bristolResult.error },
        });
        return;
      }

      const { records, total } = await poopService.getAllPoops(
        page,
        limit,
        bristolType
      );

      const response: PoopListResponse = {
        success: true,
        data: records,
        meta: {
          total,
          page,
          limit,
          ...(bristolType !== undefined && { bristolType }),
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
