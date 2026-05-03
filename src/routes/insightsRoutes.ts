import {Router} from "express";
import {insightsController} from "../controllers/insightsController";

const router = Router();

// List recent briefs for a period (returns shells, not full bodies)
router.get("/briefs/:period", insightsController.listBriefs);

// Get one full brief by (period, date)
router.get("/briefs/:period/:date", insightsController.getBrief);

// List recent daily analyst notes (for the "what's the agent watching" view)
router.get("/daily-notes", insightsController.listDailyNotes);

// Submit per-section feedback (👍 / 👎 / wrong)
router.post("/feedback", insightsController.submitFeedback);

export default router;
