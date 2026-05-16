/**
 * Probe with MCP tools attached but NO toolRunner — uses raw streaming. If
 * this hangs, the issue is the tool schemas. If this works, the issue is
 * something in toolRunner's loop.
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const mcpUrl = process.env.POOPCHECK_MCP_URL;
  const mcpToken = process.env.POOPCHECK_MCP_TOKEN;
  if (!apiKey || !mcpUrl || !mcpToken) {
    throw new Error("env vars missing");
  }
  const client = new Anthropic({ apiKey });

  const skipGetFetch: typeof fetch = (input, init) => {
    if ((init?.method ?? "GET").toUpperCase() === "GET") {
      return Promise.resolve(new Response(null, { status: 405 }));
    }
    return fetch(input, init);
  };

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
  console.log(`mcp tools: ${mcpToolList.length}`);

  // Convert MCP schemas to Anthropic tool shape.
  const tools: Anthropic.Tool[] = mcpToolList.map((t) => ({
    name: t.name,
    input_schema: {
      ...t.inputSchema,
      type: "object" as const,
      properties: t.inputSchema.properties ?? {},
      required: (t.inputSchema.required as string[] | undefined) ?? [],
    },
    ...(t.description ? { description: t.description } : {}),
  }));

  const args = process.argv.slice(2);
  const mode = args[0] ?? "all";
  let useTools = tools;
  if (mode === "one") {
    useTools = tools.filter((t) => t.name === "read_section_feedback");
  } else if (mode === "none") {
    useTools = [];
  }
  console.log(`using ${useTools.length} tools (mode=${mode})`);

  const t0 = Date.now();
  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    tools: useTools,
    messages: [
      { role: "user", content: "Briefly: what tools do you have available?" },
    ],
  });

  let n = 0;
  for await (const event of stream) {
    n += 1;
    const dt = Date.now() - t0;
    const detail =
      event.type === "content_block_delta" && event.delta.type === "text_delta"
        ? ` "${event.delta.text}"`
        : event.type === "content_block_delta" &&
          event.delta.type === "input_json_delta"
          ? ` ${event.delta.partial_json}`
          : event.type === "content_block_start"
            ? ` (${event.content_block.type})`
            : "";
    console.log(`[+${dt}ms] #${n} ${event.type}${detail}`);
  }
  const final = await stream.finalMessage();
  console.log("done, stop=", final.stop_reason, "usage:", final.usage);
  await mcp.close();
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
