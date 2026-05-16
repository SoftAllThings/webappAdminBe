import { Request, Response } from "express";
import { runAnalystChat, ChatMessage } from "../services/agentService";

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { role?: unknown; content?: unknown };
  if (v.role !== "user" && v.role !== "assistant") return false;
  if (typeof v.content !== "string" && !Array.isArray(v.content)) return false;
  return true;
}

export const chatController = {
  async streamChat(req: Request, res: Response): Promise<void> {
    const body = req.body as { messages?: unknown };
    if (!Array.isArray(body.messages) || !body.messages.every(isChatMessage)) {
      res.status(400).json({
        success: false,
        error: {
          message:
            "Body must be { messages: [{ role: 'user'|'assistant', content: ... }] }",
        },
      });
      return;
    }
    if (body.messages.length === 0) {
      res.status(400).json({
        success: false,
        error: { message: "messages must be non-empty" },
      });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx-style buffering
    // helmet defaults CORP to same-origin which blocks cross-origin streams
    // (e.g. localhost:3000 → localhost:3001). Allow cross-origin for SSE.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.flushHeaders();

    let writes = 0;
    let clientClosed = false;
    req.on("close", () => {
      console.log(`[chat] req close fired (writes=${writes})`);
      clientClosed = true;
    });
    res.on("close", () => {
      console.log(`[chat] res close fired (writes=${writes})`);
    });

    const send = (data: unknown) => {
      writes += 1;
      const payload = `data: ${JSON.stringify(data)}\n\n`;
      const ok = res.write(payload);
      console.log(
        `[chat] write #${writes} ok=${ok} clientClosed=${clientClosed} type=${(data as { type?: string }).type}`,
      );
    };

    try {
      await runAnalystChat(body.messages, (event) => {
        send(event);
      });
      console.log(`[chat] finished, total writes=${writes}`);
    } catch (err) {
      console.error("chat/streamChat error:", err);
      send({
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      res.end();
    }
  },
};
