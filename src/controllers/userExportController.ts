import { Request, Response } from "express";
import {
  UserExportRequest,
  userExportService,
} from "../services/userExportService";

const isValidDateOnly = (value: unknown): value is string => {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
};

export class UserExportController {
  async exportUsersCsv(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as UserExportRequest;
      const filters = body.filters ?? {};

      if (
        filters.createdAtFrom !== undefined &&
        !isValidDateOnly(filters.createdAtFrom)
      ) {
        res.status(400).json({
          success: false,
          error: { message: "createdAtFrom must use YYYY-MM-DD format" },
        });
        return;
      }

      if (
        filters.createdAtTo !== undefined &&
        !isValidDateOnly(filters.createdAtTo)
      ) {
        res.status(400).json({
          success: false,
          error: { message: "createdAtTo must use YYYY-MM-DD format" },
        });
        return;
      }

      if (
        filters.createdAtFrom &&
        filters.createdAtTo &&
        filters.createdAtFrom > filters.createdAtTo
      ) {
        res.status(400).json({
          success: false,
          error: {
            message: "createdAtFrom must be earlier than or equal to createdAtTo",
          },
        });
        return;
      }

      const csv = await userExportService.exportUsersCsv(body);
      const dateSuffix = new Date().toISOString().slice(0, 10);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="users-export-${dateSuffix}.csv"`
      );
      res.status(200).send(csv);
    } catch (error) {
      console.error("Error in exportUsersCsv:", error);
      const message =
        error instanceof Error ? error.message : "Failed to export users CSV";
      res.status(500).json({
        success: false,
        error: { message },
      });
    }
  }
}

export const userExportController = new UserExportController();
