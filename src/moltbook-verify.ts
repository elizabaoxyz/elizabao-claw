import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  MOLTBOOK_API_KEY: z.string().min(1, "MOLTBOOK_API_KEY is required"),
});

function usage(): never {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  bun run moltbook:verify <verification_code> <answer>

Example:
  bun run moltbook:verify 9bb5...f38 46.00
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { MOLTBOOK_API_KEY } = Env.parse(process.env);

  const code = String(process.argv[2] || "").trim();
  const answer = String(process.argv[3] || "").trim();
  if (!code || !answer) usage();

  const resp = await fetch("https://www.moltbook.com/api/v1/verify", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MOLTBOOK_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ verification_code: code, answer }),
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
    console.error("❌ Verify failed:", resp.status, resp.statusText);
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log("✅ Verification submitted.");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", e?.message || String(e));
  process.exit(1);
});

