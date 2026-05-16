/**
 * Probe matching our agent service exactly — toolRunner + system prompt +
 * 13 MCP tools. This is the configuration that hangs in production.
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { mcpTools } from "@anthropic-ai/sdk/helpers/beta/mcp";
import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "fs";
import path from "path";

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const mcpUrl = process.env.POOPCHECK_MCP_URL;
  const mcpToken = process.env.POOPCHECK_MCP_TOKEN;
  if (!apiKey || !mcpUrl || !mcpToken) throw new Error("env vars missing");
  const client = new Anthropic({ apiKey });

  const glossary = fs.readFileSync(
    path.join(__dirname, "..", "services", "agent", "metrics_glossary.md"),
    "utf8",
  );

  const skipGetFetch: typeof fetch = (input, init) =>
    (init?.method ?? "GET").toUpperCase() === "GET"
      ? Promise.resolve(new Response(null, { status: 405 }))
      : fetch(input, init);

  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    fetch: skipGetFetch,
    requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } },
  });
  const mcp = new MCPClient(
    { name: "probe", version: "1.0.0" },
    { capabilities: {} },
  );
  await mcp.connect(transport as never);
  const { tools: mcpToolList } = await mcp.listTools();
  console.log(`mcp tools: ${mcpToolList.length}, glossary: ${glossary.length} chars`);

  const tools = mcpTools(
    mcpToolList,
    mcp as unknown as Parameters<typeof mcpTools>[1],
  );

  const t0 = Date.now();
  console.log("[+0ms] opening toolRunner");
  const runner = client.beta.messages.toolRunner({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: "You are the PoopCheck Analyst.\n\n" + glossary,
    tools,
    messages: [{ role: "user", content: "How many people had premium and unsubscribed in the last 30 days?" }],
    stream: true,
    max_iterations: 5,
  });

  let iter = 0;
  for await (const stream of runner) {
    iter += 1;
    console.log(`[+${Date.now() - t0}ms] iter #${iter} opened`);
    let n = 0;
    for await (const event of stream) {
      n += 1;
      const detail =
        event.type === "content_block_delta" && event.delta.type === "text_delta"
          ? ` "${event.delta.text}"`
          : event.type === "content_block_start"
            ? ` (${event.content_block.type})`
            : "";
      console.log(`[+${Date.now() - t0}ms] #${n} ${event.type}${detail}`);
    }
    const final = await stream.finalMessage();
    console.log(
      `[+${Date.now() - t0}ms] iter #${iter} done, stop=${final.stop_reason}`,
    );
  }
  await mcp.close();
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
