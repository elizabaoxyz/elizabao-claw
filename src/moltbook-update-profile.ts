import "dotenv/config";
import { z } from "zod";
import { getMoltbookDescription } from "./profile-text.js";

const Env = z.object({
  MOLTBOOK_API_KEY: z.string().min(1, "MOLTBOOK_API_KEY is required"),
});

async function main(): Promise<void> {
  const { MOLTBOOK_API_KEY } = Env.parse(process.env);

  const description = process.argv.slice(2).join(" ").trim() || getMoltbookDescription();

  const resp = await fetch("https://www.moltbook.com/api/v1/agents/me", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${MOLTBOOK_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ description }),
  });

  const text = await resp.text().catch(() => "");
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // leave as raw text
  }

  if (!resp.ok) {
    // eslint-disable-next-line no-console
    console.error("❌ Moltbook profile update failed:", resp.status, resp.statusText);
    // eslint-disable-next-line no-console
    console.error(typeof data === "object" ? JSON.stringify(data, null, 2) : String(text).slice(0, 800));
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log("✅ Moltbook profile updated.");
  // eslint-disable-next-line no-console
  console.log("Description set to:", description);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", e?.message || String(e));
  process.exit(1);
});

