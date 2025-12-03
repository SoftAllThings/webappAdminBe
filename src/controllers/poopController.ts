import { Request, Response } from "express";
import { PoopService } from "../services/poopService";
import {
  CreatePoopRecord,
  UpdatePoopRecord,
  PoopListResponse,
  PoopDetailResponse,
} from "../types/poop";

const poopService = new PoopService();

export class PoopController {
  // GET /api/poop - Get all poop records with pagination
  async getAllPoops(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const bristolType = req.query.bristol_type
        ? parseInt(req.query.bristol_type as string)
        : undefined;

      // Validate pagination parameters
      if (page < 1 || limit < 1 || limit > 100) {
        res.status(400).json({
          success: false,
          error: {
            message:
              "Invalid pagination parameters. Page must be >= 1, limit must be between 1 and 100.",
          },
        });
        return;
      }

      // Validate bristol_type parameter
      if (bristolType !== undefined && (bristolType < 1 || bristolType > 7)) {
        res.status(400).json({
          success: false,
          error: {
            message: "Invalid bristol_type parameter. Must be between 1 and 7.",
          },
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
        error: {
          message: "Failed to fetch poop records",
        },
      });
    }
  } // GET /api/poop/:id - Get a single poop record by ID
  async getPoopById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          error: {
            message: "ID parameter is required",
          },
        });
        return;
      }

      const record = await poopService.getPoopById(id);

      if (!record) {
        res.status(404).json({
          success: false,
          error: {
            message: "Poop record not found",
          },
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
        error: {
          message: "Failed to fetch poop record",
        },
      });
    }
  }
  // POST /api/poop - Create a new poop record
  async createPoop(req: Request, res: Response): Promise<void> {
    try {
      const data: CreatePoopRecord = req.body;

      // Basic validation for required fields
      const requiredFields = [
        "bristol_type",
        "consistency",
        "shape",
        "quantity",
        "color",
        "health",
      ];
      const missingFields = requiredFields.filter(
        (field) => data[field as keyof CreatePoopRecord] === undefined
      );

      if (missingFields.length > 0) {
        res.status(400).json({
          success: false,
          error: {
            message: `Missing required fields: ${missingFields.join(", ")}`,
          },
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
        error: {
          message: "Failed to create poop record",
        },
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
        error: {
          message: "Failed to fetch last verified bristol type",
        },
      });
    }
  }

  // GET /api/poop/bristolStats - Get Bristol type stats from readyToTrainView
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
        error: {
          message: "Failed to fetch bristol stats",
        },
      });
    }
  }

  // PUT /api/poop/:id - Update an existing poop record
  async updatePoop(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data: Partial<UpdatePoopRecord> = req.body;

      console.log("🔧 updatePoop controller called with:", { id, data });

      if (!id) {
        res.status(400).json({
          success: false,
          error: {
            message: "ID parameter is required",
          },
        });
        return;
      }

      // Check if record exists first
      console.log("🔍 Checking if record exists...");
      const existingRecord = await poopService.getPoopById(id);
      if (!existingRecord) {
        console.log("❌ Record not found");
        res.status(404).json({
          success: false,
          error: {
            message: "Poop record not found",
          },
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
        error: {
          message: "Failed to update poop record",
        },
      });
    }
  }

  // GET /api/poop/search - Search poop records with criteria
  async searchPoops(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      // Extract search criteria from query parameters
      const criteria: any = {};
      const allowedFields = [
        "bristol_type",
        "consistency",
        "shape",
        "quantity",
        "color",
        "health",
        "blood",
        "mucus",
        "floating",
        "verified",
      ];

      allowedFields.forEach((field) => {
        if (req.query[field] !== undefined) {
          const value = req.query[field] as string;
          if (field === "verified") {
            criteria[field] = value.toLowerCase() === "true";
          } else {
            criteria[field] = parseInt(value);
          }
        }
      });

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
        error: {
          message: "Failed to search poop records",
        },
      });
    }
  }
}

// Export controller instance
export const poopController = new PoopController();
