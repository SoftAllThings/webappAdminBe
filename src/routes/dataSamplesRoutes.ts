import { Router } from "express";
import { authenticateToken } from "../controllers/authController";
import { dataSamplesController } from "../controllers/dataSamplesController";

const router = Router();

// The zip download is a plain browser navigation, so it cannot send a bearer
// header; it carries a short-lived, export-scoped token in the query instead.
router.get("/exports/:exportId/download", dataSamplesController.download);

// Everything else requires an admin session.
router.use(authenticateToken);
router.get("/catalog", dataSamplesController.catalog);
router.get("/availability", dataSamplesController.availability);
router.get("/preview", dataSamplesController.preview);
router.get("/lookup", dataSamplesController.lookup);
router.get("/buyers", dataSamplesController.listBuyers);
router.post("/buyers", dataSamplesController.createBuyer);
router.get("/buyers/:buyerId/exports", dataSamplesController.listExports);
router.post("/exports", dataSamplesController.prepare);
router.post("/exports/:exportId/download-token", dataSamplesController.downloadToken);
router.post("/exports/:exportId/void", dataSamplesController.void);

export default router;
