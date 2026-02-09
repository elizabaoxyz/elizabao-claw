import "dotenv/config";
import { z } from "zod";

import { fetchGammaMarkets, getGammaApiUrl, topYesNoSignals } from "./polymarket-gamma.js";

const Env = z.object({
  MOLTBOOK_API_KEY: z.string().min(1, "MOLTBOOK_API_KEY is required"),
  PORT: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 3333 : Number(v)))
    .pipe(z.number().int().positive().max(65535)),
  PUBLIC_BASE_URL: z
    .string()
    .optional()
    .transform((v) => String(v ?? "").trim())
    .transform((v) => v.replace(/\/+$/g, "")),
  GAMMA_API_URL: z
    .string()
    .optional()
    .transform((v) => String(v ?? "").trim())
    .transform((v) => v.replace(/\/+$/g, "")),
  MOLTBOOK_TEASER_SUBMOLT: z
    .string()
    .optional()
    .transform((v) => String(v ?? "general").trim() || "general"),
  MOLTBOOK_TEASER_LIMIT: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 3 : Number(v)))
    .pipe(z.number().int().min(1).max(10)),
  MOLTBOOK_TEASER_INCLUDE_RESTRICTED: z
    .string()
    .optional()
    .transform((v) => String(v ?? "true").toLowerCase() === "true"),
  MOLTBOOK_TEASER_MIN_LIQUIDITY_USD: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 10_000 : Number(v)))
    .pipe(z.number().finite().min(0)),
  MOLTBOOK_TEASER_MIN_VOLUME_24H_USD: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 50_000 : Number(v)))
    .pipe(z.number().finite().min(0)),
  MOLTBOOK_TEASER_DRY_RUN: z
    .string()
    .optional()
    .transform((v) => String(v ?? "false").toLowerCase() === "true"),
});

function formatPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nonce(): string {
  // Short per-run nonce to reduce accidental duplicate-content matches.
  // (Moltbook moderation is strict for new agents.)
  return (globalThis.crypto?.randomUUID?.() || String(Date.now()))
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toLowerCase();
}

async function main(): Promise<void> {
  const env = Env.parse(process.env);
  void env.MOLTBOOK_API_KEY; // validated; used by the downstream post-verified script

  const baseUrl = env.PUBLIC_BASE_URL || `http://localhost:${env.PORT}`;
  const gammaApiUrl = env.GAMMA_API_URL ? env.GAMMA_API_URL : getGammaApiUrl(process.env);

  const markets = await fetchGammaMarkets({
    gammaApiUrl,
    limit: 250,
    offset: 0,
    timeoutMs: 12_000,
  });

  const signals = topYesNoSignals(markets, {
    max: env.MOLTBOOK_TEASER_LIMIT,
    includeRestricted: env.MOLTBOOK_TEASER_INCLUDE_RESTRICTED,
    minLiquidityUsd: env.MOLTBOOK_TEASER_MIN_LIQUIDITY_USD,
    minVolume24hrUsd: env.MOLTBOOK_TEASER_MIN_VOLUME_24H_USD,
  });

  if (!signals.length) {
    // eslint-disable-next-line no-console
    console.error("No signals found (filters too strict or Gamma API empty).");
    process.exit(1);
  }

  const n = nonce();
  const date = todayIso();
  const title = `Polymarket Radar: Top ${signals.length} — ${date}`;

  const lines: string[] = [];
  lines.push(`Daily scan (public Gamma API). Top ${signals.length} markets with high uncertainty + liquidity:`);
  lines.push("");

  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    lines.push(
      `${i + 1}) ${s.question} — YES ${formatPct(s.yesPrice)} • ${s.why}`,
    );
  }

  lines.push("");
  lines.push(`Full report (paid x402): ${baseUrl}/signals/daily`);
  lines.push(`Raw markets: ${baseUrl}/polymarket/markets?limit=50`);
  lines.push("");
  lines.push(`ref:${date}:${signals.map((s) => s.marketId).join(",")}:${n}`);

  const content = lines.join("\n");
  const submolt = env.MOLTBOOK_TEASER_SUBMOLT;

  if (env.MOLTBOOK_TEASER_DRY_RUN) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ dryRun: true, submolt, title, content }, null, 2));
    return;
  }

  // Reuse our auto-verify posting flow by delegating to the existing script.
  const proc = Bun.spawn(
    ["bun", "src/moltbook-post-verified.ts", title, content, submolt],
    {
      cwd: process.cwd(),
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", e?.message || String(e));
  process.exit(1);
});

