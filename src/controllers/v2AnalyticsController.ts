import { Request, Response } from "express";
import {
  v2AnalyticsRepository,
  IndividualsFilters,
  StoolLogsFilters,
} from "../repositories/v2Analytics.repository";

function parseInteger(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseFloatOpt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

function parseString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function parseLimitOffset(q: any): { limit: number; offset: number } {
  const page = Math.max(1, parseInteger(q.page) ?? 1);
  const limitRaw = parseInteger(q.limit) ?? 50;
  const limit = Math.max(1, Math.min(limitRaw, 500));
  const offset = (page - 1) * limit;
  return { limit, offset };
}

// Top-level profile filters: query params prefixed with `profile_` become dynamic profile_data filters
function extractProfileFilters(q: any): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const k of Object.keys(q)) {
    if (k.startsWith("profile_") && k !== "profile_age_min" && k !== "profile_age_max") {
      const key = k.slice("profile_".length);
      const val = parseString(q[k]);
      if (key && val !== undefined && /^[A-Za-z0-9_]+$/.test(key)) {
        out[key] = val;
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function buildIndividualsFilters(q: any): IndividualsFilters {
  const { limit, offset } = parseLimitOffset(q);
  const sortByRaw = parseString(q.sortBy);
  const sortBy =
    sortByRaw === "updated_at" ? "updated_at" : "created_at";
  const sortDir =
    parseString(q.sortDir)?.toLowerCase() === "asc" ? "asc" : "desc";

  return {
    organizationId: parseInteger(q.organization_id),
    sex: parseString(q.sex),
    diet: parseString(q.diet),
    ageMin: parseInteger(q.age_min),
    ageMax: parseInteger(q.age_max),
    stressLevel: parseString(q.stress_level),
    physicalActivityLevel: parseString(q.physical_activity_level),
    waterIntake: parseString(q.water_intake),
    alcoholConsumption: parseString(q.alcohol_consumption),
    medicalCondition: parseString(q.medical_condition),
    createdAfter: parseString(q.created_after),
    createdBefore: parseString(q.created_before),
    profileFilters: extractProfileFilters(q),
    limit,
    offset,
    sortBy,
    sortDir,
  };
}

function buildStoolLogsFilters(q: any): StoolLogsFilters {
  const { limit, offset } = parseLimitOffset(q);
  const sortDir =
    parseString(q.sortDir)?.toLowerCase() === "asc" ? "asc" : "desc";

  return {
    organizationId: parseInteger(q.organization_id),
    individualId: parseString(q.individual_id),
    bristolType: parseString(q.bristol_type),
    health: parseString(q.health),
    color: parseString(q.color),
    consistency: parseString(q.consistency),
    shape: parseString(q.shape),
    quantity: parseString(q.quantity),
    blood: parseString(q.blood),
    mucus: parseString(q.mucus),
    floating: parseString(q.floating),
    sleep: parseString(q.sleep),
    stress: parseString(q.stress),
    diet: parseString(q.diet),
    caffeine: parseString(q.caffeine),
    toiletTime: parseString(q.toilet_time),
    frequency: parseString(q.frequency),
    foodGroup: parseString(q.food_group),
    painMin: parseInteger(q.pain_min),
    painMax: parseInteger(q.pain_max),
    smellMin: parseInteger(q.smell_min),
    smellMax: parseInteger(q.smell_max),
    durationMin: parseInteger(q.duration_min),
    durationMax: parseInteger(q.duration_max),
    waterMin: parseFloatOpt(q.water_min),
    waterMax: parseFloatOpt(q.water_max),
    createdAfter: parseString(q.created_after),
    createdBefore: parseString(q.created_before),
    profileSex: parseString(q.profile_sex),
    profileDiet: parseString(q.profile_diet),
    profileAgeMin: parseInteger(q.profile_age_min),
    profileAgeMax: parseInteger(q.profile_age_max),
    limit,
    offset,
    sortBy: "created_at",
    sortDir,
  };
}

function handleError(res: Response, err: unknown, action: string): void {
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`❌ V2 analytics error (${action}):`, err);
  res.status(500).json({
    success: false,
    error: { message: `Failed to ${action}: ${message}` },
  });
}

export class V2AnalyticsController {
  async getOverview(_req: Request, res: Response): Promise<void> {
    try {
      const overview = await v2AnalyticsRepository.getOverview();
      res.status(200).json({ success: true, data: overview });
    } catch (err) {
      handleError(res, err, "fetch overview");
    }
  }

  async listIndividuals(req: Request, res: Response): Promise<void> {
    try {
      const filters = buildIndividualsFilters(req.query);
      const result = await v2AnalyticsRepository.listIndividuals(filters);
      res.status(200).json({
        success: true,
        data: result.rows,
        meta: {
          total: result.total,
          limit: filters.limit,
          offset: filters.offset,
        },
      });
    } catch (err) {
      handleError(res, err, "list individuals");
    }
  }

  async individualsAggregate(req: Request, res: Response): Promise<void> {
    try {
      const groupBy = parseString(req.query.group_by) ?? "sex";
      const filters = buildIndividualsFilters(req.query);
      const rows = await v2AnalyticsRepository.individualsAggregate(
        groupBy,
        filters
      );
      res.status(200).json({ success: true, data: rows, meta: { groupBy } });
    } catch (err) {
      handleError(res, err, "aggregate individuals");
    }
  }

  async listStoolLogs(req: Request, res: Response): Promise<void> {
    try {
      const filters = buildStoolLogsFilters(req.query);
      const result = await v2AnalyticsRepository.listStoolLogs(filters);
      res.status(200).json({
        success: true,
        data: result.rows,
        meta: {
          total: result.total,
          limit: filters.limit,
          offset: filters.offset,
        },
      });
    } catch (err) {
      handleError(res, err, "list stool logs");
    }
  }

  async stoolLogsAggregate(req: Request, res: Response): Promise<void> {
    try {
      const groupBy = parseString(req.query.group_by) ?? "bristol_type";
      const filters = buildStoolLogsFilters(req.query);
      const rows = await v2AnalyticsRepository.stoolLogsAggregate(
        groupBy,
        filters
      );
      res.status(200).json({ success: true, data: rows, meta: { groupBy } });
    } catch (err) {
      handleError(res, err, "aggregate stool logs");
    }
  }

  async stoolLogsNumericStats(req: Request, res: Response): Promise<void> {
    try {
      const filters = buildStoolLogsFilters(req.query);
      const stats = await v2AnalyticsRepository.stoolLogsNumericStats(filters);
      res.status(200).json({ success: true, data: stats });
    } catch (err) {
      handleError(res, err, "compute stool-log numeric stats");
    }
  }

  async listProfileKeys(_req: Request, res: Response): Promise<void> {
    try {
      const keys = await v2AnalyticsRepository.listProfileKeys();
      res.status(200).json({ success: true, data: keys });
    } catch (err) {
      handleError(res, err, "list profile keys");
    }
  }
}

export const v2AnalyticsController = new V2AnalyticsController();
