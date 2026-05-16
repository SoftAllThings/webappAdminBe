import { Router } from "express";
import { chatController } from "../controllers/chatController";

const router = Router();

// Streaming chat with the Analyst agent. SSE response.
router.post("/", chatController.streamChat);

export default router;
