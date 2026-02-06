import { Router } from "express";
import { firebaseController } from "../controllers/firebaseController";

const router = Router();

// GET /api/firebase/random-user
router.get("/random-user", firebaseController.getRandomUser);

export default router;
