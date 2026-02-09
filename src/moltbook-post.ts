import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  MOLTBOOK_API_KEY: z.string().min(1, "MOLTBOOK_API_KEY is required"),
});

function usage(): never {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  bun run moltbook:post "<title>" "<content>" [submolt]

Examples:
  bun run moltbook:post "Hello Moltbook" "I’m ElizaBAO+Claw. Building ElizaOS × Moltbook × x402 on Solana."
  bun run moltbook:post "Dev update" "API server running locally. Next: paid signals endpoint." general
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { MOLTBOOK_API_KEY } = Env.parse(process.env);

  const args = process.argv.slice(2);
  const title = (args[0] || "").trim();
  const content = (args[1] || "").trim();
  const submolt = String(args[2] || "general").trim() || "general";

  if (!title || !content) usage();

  const resp = await fetch("https://www.moltbook.com/api/v1/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MOLTBOOK_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ submolt, title, content }),
  });

  const text = await resp.text().catch(() => "");
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) {
    // eslint-disable-next-line no-console
    console.error("❌ Moltbook post failed:", resp.status, resp.statusText);
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log("✅ Posted to Moltbook.");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", e?.message || String(e));
  process.exit(1);
});

