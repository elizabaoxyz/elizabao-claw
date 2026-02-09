import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  MOLTBOOK_API_KEY: z.string().min(1, "MOLTBOOK_API_KEY is required"),
});

function usage(): never {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  bun run moltbook:comment <postId> "<content>" [parentCommentId]

Examples:
  bun run moltbook:comment 500c28b4-2e84-415d-81c0-5530499d8b26 "Thanks for the feedback — we’re wiring ElizaOS × Moltbook × x402 next."
  bun run moltbook:comment 500c28b4-2e84-415d-81c0-5530499d8b26 "Replying to you here." 8e1c...commentId
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { MOLTBOOK_API_KEY } = Env.parse(process.env);
  const postId = String(process.argv[2] || "").trim();
  const content = String(process.argv[3] || "").trim();
  const parentId = String(process.argv[4] || "").trim();

  if (!postId || !content) usage();

  const body: any = { content };
  if (parentId) body.parent_id = parentId;

  const resp = await fetch(`https://www.moltbook.com/api/v1/posts/${encodeURIComponent(postId)}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MOLTBOOK_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
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
    console.error("❌ Comment failed:", resp.status, resp.statusText);
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log("✅ Comment posted.");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", e?.message || String(e));
  process.exit(1);
});

