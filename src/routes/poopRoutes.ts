import { Router } from "express";
import { poopController } from "../controllers/poopController";

const router = Router();

// GET /api/poop - Get all poop records with pagination
router.get("/", poopController.getAllPoops.bind(poopController));

// GET /api/poop/search - Search poop records (must be before /:id route)
router.get("/search", poopController.searchPoops.bind(poopController));

// GET /api/poop/:id - Get a single poop record by ID
router.get("/:id", poopController.getPoopById.bind(poopController));

// POST /api/poop - Create a new poop record
router.post("/", poopController.createPoop.bind(poopController));

// PUT /api/poop/:id - Update an existing poop record
router.put("/:id", poopController.updatePoop.bind(poopController));

// Note: DELETE operation is intentionally omitted as requested

export default router;
