import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  MOLTBOOK_API_KEY: z.string().min(1, "MOLTBOOK_API_KEY is required"),
  PUBLIC_BASE_URL: z
    .string()
    .optional()
    .transform((v) => String(v ?? "").trim())
    .transform((v) => v.replace(/\/+$/g, "")),
  GAMMA_API_URL: z
    .string()
    .optional()
    .transform((v) => String(v ?? "https://gamma-api.polymarket.com").trim())
    .transform((v) => v.replace(/\/+$/g, "")),
  MOLTBOOK_NEW_MARKETS_SUBMOLT: z
    .string()
    .optional()
    .transform((v) => String(v ?? "general").trim() || "general"),
  MOLTBOOK_NEW_MARKETS_LIMIT: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 5 : Number(v)))
    .pipe(z.number().int().min(3).max(10)),
  MOLTBOOK_NEW_MARKETS_DRY_RUN: z
    .string()
    .optional()
    .transform((v) => String(v ?? "false").toLowerCase() === "true"),
});

type GammaEvent = {
  id: string;
  title: string;
  createdAt?: string;
  markets?: any[];
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nonce(): string {
  return (globalThis.crypto?.randomUUID?.() || String(Date.now()))
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toLowerCase();
}

function pickYesPrice(m: any): number | null {
  const op = m?.outcomePrices;
  if (!op) return null;
  try {
    const arr = typeof op === "string" ? JSON.parse(op) : op;
    const yes = Array.isArray(arr) ? Number(arr[0]) : NaN;
    return Number.isFinite(yes) ? yes : null;
  } catch {
    return null;
  }
}

function fmtPct(p: number | null): string {
  return p === null ? "" : `YES ${(p * 100).toFixed(1)}%`;
}

async function fetchNewestEvents(gammaApiUrl: string, limit: number): Promise<GammaEvent[]> {
  // Per Polymarket docs: /events?order=id&ascending=false&closed=false gets newest events first.
  const url = `${gammaApiUrl}/events?order=id&ascending=false&closed=false&limit=${Math.max(1, Math.min(100, limit))}`;
  const resp = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "elizabao-claw/0.1" } });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Gamma HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data: unknown = await resp.json();
  const arr = Array.isArray(data) ? data : [];
  return arr.map((e: any) => ({
    id: String(e?.id ?? ""),
    title: String(e?.title ?? ""),
    createdAt: typeof e?.createdAt === "string" ? e.createdAt : undefined,
    markets: Array.isArray(e?.markets) ? e.markets : [],
  }));
}

async function main(): Promise<void> {
  const env = Env.parse(process.env);
  void env.MOLTBOOK_API_KEY;

  const baseUrl = env.PUBLIC_BASE_URL || "http://localhost:3333";
  const gammaApiUrl = env.GAMMA_API_URL;

  const events = await fetchNewestEvents(gammaApiUrl, 25);
  const markets = events
    .flatMap((e) =>
      (e.markets || []).map((m) => ({
        eventTitle: e.title,
        eventId: e.id,
        marketId: String(m?.id ?? ""),
        question: String(m?.question ?? "").trim(),
        slug: String(m?.slug ?? "").trim(),
        endDate: typeof m?.endDate === "string" ? String(m.endDate) : null,
        yesPrice: pickYesPrice(m),
        createdAt: typeof m?.createdAt === "string" ? String(m.createdAt) : e.createdAt ?? null,
      })),
    )
    .filter((m) => m.marketId && m.question)
    .sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""));

  const top = markets.slice(0, env.MOLTBOOK_NEW_MARKETS_LIMIT);
  if (!top.length) {
    // eslint-disable-next-line no-console
    console.error("No new markets found from Gamma /events.");
    process.exit(1);
  }

  const date = todayIso();
  const n = nonce();
  const title = `New Polymarket Markets — ${date} (Top ${top.length})`;

  const lines: string[] = [];
  lines.push("Newest markets (public Gamma API):");
  lines.push("");
  for (let i = 0; i < top.length; i++) {
    const m = top[i];
    const url = m.slug ? `https://polymarket.com/market/${m.slug}` : "";
    const price = fmtPct(m.yesPrice);
    lines.push(`${i + 1}) ${m.question}${price ? ` — ${price}` : ""}${url ? `\n   ${url}` : ""}`);
  }
  lines.push("");
  lines.push(`Signals (ranked): ${baseUrl}/signals/polymarket/top`);
  lines.push(`Full report (paid x402): ${baseUrl}/signals/daily`);
  lines.push("");
  lines.push(`ref:${date}:new:${top.map((m) => m.marketId).join(",")}:${n}`);

  const content = lines.join("\n");
  const submolt = env.MOLTBOOK_NEW_MARKETS_SUBMOLT;

  if (env.MOLTBOOK_NEW_MARKETS_DRY_RUN) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ dryRun: true, submolt, title, content }, null, 2));
    return;
  }

  const proc = Bun.spawn(["bun", "src/moltbook-post-verified.ts", title, content, submolt], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", e?.message || String(e));
  process.exit(1);
});

