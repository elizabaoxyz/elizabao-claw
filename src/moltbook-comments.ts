import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  MOLTBOOK_API_KEY: z.string().min(1, "MOLTBOOK_API_KEY is required"),
});

function usage(): never {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  bun run moltbook:comments <postId> [sort]

sort: top | new | controversial (default: top)

Example:
  bun run moltbook:comments 500c28b4-2e84-415d-81c0-5530499d8b26 top
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { MOLTBOOK_API_KEY } = Env.parse(process.env);
  const postId = String(process.argv[2] || "").trim();
  const sort = String(process.argv[3] || "top").trim();
  if (!postId) usage();

  const url = `https://www.moltbook.com/api/v1/posts/${encodeURIComponent(postId)}/comments?sort=${encodeURIComponent(sort)}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${MOLTBOOK_API_KEY}`,
      Accept: "application/json",
    },
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
    console.error("❌ Fetch comments failed:", resp.status, resp.statusText);
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", e?.message || String(e));
  process.exit(1);
});

