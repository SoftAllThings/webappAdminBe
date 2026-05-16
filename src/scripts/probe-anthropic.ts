/**
 * Quick standalone probe: does a basic streaming Anthropic API call work
 * from this machine, with no MCP, no tools, no system prompt? If THIS hangs
 * too, the problem is not our code — it's the network / SDK / API path.
 *
 * Run:  npx ts-node src/scripts/probe-anthropic.ts
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY missing");
  }
  const client = new Anthropic({ apiKey });
  console.log(`[${new Date().toISOString()}] opening stream`);
  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    messages: [{ role: "user", content: "Say hello in exactly 5 words." }],
  });

  let n = 0;
  for await (const event of stream) {
    n += 1;
    const t = new Date().toISOString().slice(11, 23);
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      console.log(`[${t}] #${n} ${event.type} "${event.delta.text}"`);
    } else {
      console.log(`[${t}] #${n} ${event.type}`);
    }
  }
  const final = await stream.finalMessage();
  console.log(`[${new Date().toISOString()}] done, usage:`, final.usage);
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
