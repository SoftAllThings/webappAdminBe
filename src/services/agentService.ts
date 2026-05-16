import Anthropic from "@anthropic-ai/sdk";
import { mcpTools } from "@anthropic-ai/sdk/helpers/beta/mcp";
import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "fs";
import path from "path";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string | Anthropic.Beta.BetaContentBlockParam[];
};

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; name: string; serverName: string }
  | { type: "tool_use_end"; name: string }
  | { type: "done"; usage: { input: number; output: number; cached: number } }
  | { type: "error"; message: string };

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8000;

let cachedClient: Anthropic | null = null;
let cachedGlossary: string | null = null;

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

function getGlossary(): string {
  if (cachedGlossary) return cachedGlossary;
  const glossaryPath = path.join(__dirname, "agent", "metrics_glossary.md");
  cachedGlossary = fs.readFileSync(glossaryPath, "utf8");
  return cachedGlossary;
}

function buildSystemPrompt(): Anthropic.Beta.BetaTextBlockParam[] {
  const today = new Date().toISOString().slice(0, 10);
  return [
    {
      type: "text",
      text:
        "You are the PoopCheck Analyst — a data agent that answers analytics questions about the PoopCheck app.\n\n" +
        "You have MCP tools that query Firestore (metric snapshots, RevenueCat events, subscriber state, insights briefs, section feedback) and BigQuery (event funnels). Use them. Do not invent numbers.\n\n" +
        "When the question is concrete, take this approach:\n" +
        "1. Pick the right tool(s) for the question.\n" +
        "2. Run them. Chain queries if you need to cross-reference (e.g., unsubscribed users × recent activity).\n" +
        "3. Answer with a direct number first, then a one-line explanation of how you got it.\n" +
        "4. State any assumption inline (e.g., \"treating 'unsubscribed' as CANCELLATION events\").\n\n" +
        "When the question is ambiguous or uses a term you can't map to the glossary, ask a clarifying question instead of guessing.\n\n" +
        "Keep answers tight. Marco reads numbers, not prose.\n\n" +
        "Below is the canonical glossary of business terms. Use it.\n\n" +
        "=== METRICS GLOSSARY ===\n\n" +
        getGlossary() +
        `\n\nToday's date: ${today}.`,
    },
  ];
}

async function connectMcp(): Promise<MCPClient> {
  const url = process.env.POOPCHECK_MCP_URL;
  const token = process.env.POOPCHECK_MCP_TOKEN;
  if (!url || !token) {
    throw new Error("POOPCHECK_MCP_URL and POOPCHECK_MCP_TOKEN must be set");
  }
  // The poopcheck MCP server (stateless StreamableHTTPServerTransport) hangs
  // on GET requests instead of returning 405. The SDK's transport always
  // opens a GET stream during connect to listen for server-pushed events,
  // which would hang us indefinitely. Short-circuit GETs with a synthetic
  // 405 so the SDK treats the server as POST-only (per its own comment:
  // "405 indicates that the server does not offer an SSE stream at GET endpoint").
  const skipGetFetch: typeof fetch = (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") {
      return Promise.resolve(new Response(null, { status: 405 }));
    }
    return fetch(input, init);
  };

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    fetch: skipGetFetch,
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
  const mcp = new MCPClient(
    { name: "poopcheck-analyst", version: "1.0.0" },
    { capabilities: {} },
  );
  // Library types use loose strict-optional shapes that conflict with
  // exactOptionalPropertyTypes; runtime shape is correct.
  await mcp.connect(transport as never);
  return mcp;
}

export async function runAnalystChat(
  messages: ChatMessage[],
  emit: (event: AgentEvent) => void,
): Promise<void> {
  const client = getClient();
  let mcp: MCPClient | null = null;

  try {
    console.log("[agent] connecting to MCP server");
    mcp = await connectMcp();
    const { tools: mcpToolList } = await mcp.listTools();
    console.log(`[agent] connected, ${mcpToolList.length} tools available`);

    const tools = mcpTools(
      mcpToolList,
      mcp as unknown as Parameters<typeof mcpTools>[1],
    );

    console.log("[agent] starting toolRunner");
    const runner = client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(),
      tools,
      messages: messages as Anthropic.Beta.BetaMessageParam[],
      stream: true,
      max_iterations: 10,
    });

    let totalInput = 0;
    let totalOutput = 0;
    let totalCached = 0;
    let iteration = 0;

    for await (const messageStream of runner) {
      iteration += 1;
      console.log(`[agent] iteration #${iteration} stream opened`);
      for await (const event of messageStream) {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "tool_use") {
            console.log(`[agent]   tool call: ${block.name}`);
            emit({
              type: "tool_use_start",
              name: block.name,
              serverName: "poopcheck-insights",
            });
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            emit({ type: "text_delta", text: event.delta.text });
          }
        }
      }
      const final = await messageStream.finalMessage();
      console.log(
        `[agent] iteration #${iteration} done, stop=${final.stop_reason}`,
      );
      totalInput += final.usage.input_tokens;
      totalOutput += final.usage.output_tokens;
      totalCached += final.usage.cache_read_input_tokens ?? 0;
    }

    console.log(
      `[agent] done — input=${totalInput} cached=${totalCached} output=${totalOutput}`,
    );
    emit({
      type: "done",
      usage: { input: totalInput, output: totalOutput, cached: totalCached },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("agentService error:", err);
    emit({ type: "error", message });
  } finally {
    if (mcp) {
      try {
        await mcp.close();
      } catch (closeErr) {
        console.warn("[agent] mcp close error:", closeErr);
      }
    }
  }
}
