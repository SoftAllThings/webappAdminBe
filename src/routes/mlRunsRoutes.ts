import { Router } from "express";
import { mlRunsController } from "../controllers/mlRunsController";

const router = Router();

// Literal segments before ':runId' so '/benchmarks/...' is not swallowed by it.
router.get("/benchmarks/all", mlRunsController.listBenchmarkRuns);
router.get("/benchmarks/:runId", mlRunsController.getBenchmarkRun);
router.post("/refresh", mlRunsController.refresh);
router.get("/:runId", mlRunsController.getRun);
router.get("/", mlRunsController.listRuns);

export default router;
