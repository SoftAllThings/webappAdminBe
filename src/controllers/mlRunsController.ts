import { Request, Response } from "express";
import {
  listTrainingRuns,
  getTrainingRun,
  listBenchmarks,
  getBenchmark,
  invalidateCache,
} from "../services/mlRunsService";

/** Run ids become S3 path segments — keep them to a safe charset. */
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function fail(res: Response, status: number, message: string, hint?: string): void {
  res.status(status).json({ success: false, error: { message, hint } });
}

function handleError(res: Response, err: unknown, where: string): void {
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[mlRuns/${where}] error:`, err);
  const isCreds = /credentials missing/i.test(message);
  fail(
    res,
    500,
    message,
    isCreds
      ? "Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in webappAdminBe/.env"
      : undefined,
  );
}

export const mlRunsController = {
  /** GET /api/ml-runs — training run manifests, newest first. */
  async listRuns(_req: Request, res: Response): Promise<void> {
    try {
      res.json({ success: true, data: await listTrainingRuns() });
    } catch (err) {
      handleError(res, err, "listRuns");
    }
  },

  /** GET /api/ml-runs/:runId */
  async getRun(req: Request, res: Response): Promise<void> {
    const runId = req.params.runId;
    if (!runId || !RUN_ID_RE.test(runId)) return fail(res, 400, "Invalid runId");
    try {
      const run = await getTrainingRun(runId);
      if (!run) return fail(res, 404, `No training manifest for run '${runId}'`);
      res.json({ success: true, data: run });
    } catch (err) {
      handleError(res, err, "getRun");
    }
  },

  /** GET /api/ml-runs/benchmarks/all — benchmark leaderboards, newest first. */
  async listBenchmarkRuns(_req: Request, res: Response): Promise<void> {
    try {
      res.json({ success: true, data: await listBenchmarks() });
    } catch (err) {
      handleError(res, err, "listBenchmarkRuns");
    }
  },

  /** GET /api/ml-runs/benchmarks/:runId */
  async getBenchmarkRun(req: Request, res: Response): Promise<void> {
    const runId = req.params.runId;
    if (!runId || !RUN_ID_RE.test(runId)) return fail(res, 400, "Invalid runId");
    try {
      const bench = await getBenchmark(runId);
      if (!bench) return fail(res, 404, `No benchmark results for run '${runId}'`);
      res.json({ success: true, data: bench });
    } catch (err) {
      handleError(res, err, "getBenchmarkRun");
    }
  },

  /** POST /api/ml-runs/refresh — drop the TTL cache after a fresh publish. */
  refresh(_req: Request, res: Response): void {
    invalidateCache();
    res.json({ success: true, data: { refreshed: true } });
  },
};
