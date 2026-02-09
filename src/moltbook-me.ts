import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  MOLTBOOK_API_KEY: z.string().min(1, "MOLTBOOK_API_KEY is required"),
});

async function main(): Promise<void> {
  const { MOLTBOOK_API_KEY } = Env.parse(process.env);

  const resp = await fetch("https://www.moltbook.com/api/v1/agents/me", {
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
    console.error("❌ GET /agents/me failed:", resp.status, resp.statusText);
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  // Print just the key fields that affect the dashboard.
  const agent = (data as any)?.agent ?? (data as any)?.data?.agent ?? (data as any)?.data ?? data;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        name: agent?.name ?? agent?.username ?? null,
        description: agent?.description ?? null,
        metadata: agent?.metadata ?? null,
        is_claimed: agent?.is_claimed ?? agent?.isClaimed ?? null,
        updated_at: agent?.updated_at ?? agent?.updatedAt ?? null,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", e?.message || String(e));
  process.exit(1);
});

