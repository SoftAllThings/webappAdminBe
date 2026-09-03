import { Router } from "express";
import { exportController } from "../controllers/exportController";

const router = Router();

// What can be exported, for the dashboard dialog.
router.get("/datasets", exportController.listDatasets);

// Streams a zip of CSVs + README.md + manifest.json.
router.post("/", exportController.downloadZip);

export default router;
