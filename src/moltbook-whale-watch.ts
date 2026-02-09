import "dotenv/config";
import { z } from "zod";

import { fetchTraderLeaderboard, fetchUserActivity, getDataApiUrl, type UserActivity } from "./polymarket-data-api.js";

const Env = z.object({
  MOLTBOOK_API_KEY: z.string().min(1, "MOLTBOOK_API_KEY is required"),
  PUBLIC_BASE_URL: z
    .string()
    .optional()
    .transform((v) => String(v ?? "").trim())
    .transform((v) => v.replace(/\/+$/g, "")),
  DATA_API_URL: z
    .string()
    .optional()
    .transform((v) => String(v ?? "").trim())
    .transform((v) => v.replace(/\/+$/g, "")),
  MOLTBOOK_WHALE_SUBMOLT: z
    .string()
    .optional()
    .transform((v) => String(v ?? "general").trim() || "general"),
  MOLTBOOK_WHALE_TOP_TRADERS: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 15 : Number(v)))
    .pipe(z.number().int().min(5).max(50)),
  MOLTBOOK_WHALE_TOP_TRADES: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 5 : Number(v)))
    .pipe(z.number().int().min(3).max(10)),
  MOLTBOOK_WHALE_LOOKBACK_HOURS: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 24 : Number(v)))
    .pipe(z.number().finite().min(1).max(168)),
  MOLTBOOK_WHALE_DRY_RUN: z
    .string()
    .optional()
    .transform((v) => String(v ?? "false").toLowerCase() === "true"),
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nonce(): string {
  return (globalThis.crypto?.randomUUID?.() || String(Date.now()))
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toLowerCase();
}

function shortWallet(w: string): string {
  return w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;
}

function usd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  return `$${Math.round(n).toLocaleString()}`;
}

function pickBestTrade(acts: UserActivity[]): UserActivity | null {
  const trades = acts
    .filter((a) => String(a.type || "").toUpperCase() === "TRADE")
    .filter((a) => Number(a.usdcSize || 0) > 0)
    .sort((a, b) => Number(b.usdcSize || 0) - Number(a.usdcSize || 0));
  return trades[0] ?? null;
}

async function main(): Promise<void> {
  const env = Env.parse(process.env);
  void env.MOLTBOOK_API_KEY;

  const dataApiUrl = env.DATA_API_URL || getDataApiUrl(process.env);
  const baseUrl = env.PUBLIC_BASE_URL || "http://localhost:3333";

  const lookbackSec = Math.floor(env.MOLTBOOK_WHALE_LOOKBACK_HOURS * 3600);
  const end = Math.floor(Date.now() / 1000);
  const start = end - lookbackSec;

  // 1) Get top traders by volume (free public endpoint)
  const top = await fetchTraderLeaderboard({
    dataApiUrl,
    orderBy: "VOL",
    timePeriod: "DAY",
    category: "OVERALL",
    limit: env.MOLTBOOK_WHALE_TOP_TRADERS,
  });

  // 2) For each trader, fetch their recent activity and pick their largest trade (by usdcSize)
  const perTrader: Array<{ wallet: string; userName: string; trade: UserActivity }> = [];
  for (const row of top) {
    const wallet = row.proxyWallet;
    try {
      const acts = await fetchUserActivity({
        dataApiUrl,
        user: wallet,
        limit: 50,
        offset: 0,
        type: "TRADE",
        start,
        end,
        sortBy: "CASH",
        sortDirection: "DESC",
      });
      const best = pickBestTrade(acts);
      if (!best) continue;
      perTrader.push({ wallet, userName: row.userName || "", trade: best });
    } catch {
      // ignore a single wallet failure
    }
  }

  const topTrades = perTrader
    .sort((a, b) => Number(b.trade.usdcSize || 0) - Number(a.trade.usdcSize || 0))
    .slice(0, env.MOLTBOOK_WHALE_TOP_TRADES);

  if (!topTrades.length) {
    // eslint-disable-next-line no-console
    console.error("No whale trades found in lookback window.");
    process.exit(1);
  }

  const date = todayIso();
  const n = nonce();
  const title = `Whale Watch — ${date} (Top ${topTrades.length})`;

  const lines: string[] = [];
  lines.push(`Largest on-chain trades (Data API, last ${env.MOLTBOOK_WHALE_LOOKBACK_HOURS}h):`);
  lines.push("");

  for (let i = 0; i < topTrades.length; i++) {
    const item = topTrades[i];
    const t = item.trade;
    const who = item.userName ? item.userName : shortWallet(item.wallet);
    const side = String(t.side || "").toUpperCase() || "TRADE";
    const outcome = t.outcome ? String(t.outcome) : "";
    const price = Number.isFinite(Number(t.price)) ? ` @ ${Number(t.price).toFixed(3)}` : "";
    const marketTitle = String(t.title || "").trim();
    lines.push(
      `${i + 1}) ${usd(Number(t.usdcSize || 0))} ${side}${outcome ? ` ${outcome}` : ""}${price} — ${marketTitle} (${who})`,
    );
  }

  lines.push("");
  lines.push(`Signals dashboard: ${baseUrl}/signals/polymarket/top`);
  lines.push("");
  lines.push(`ref:${date}:whales:${n}`);

  const content = lines.join("\n");
  const submolt = env.MOLTBOOK_WHALE_SUBMOLT;

  if (env.MOLTBOOK_WHALE_DRY_RUN) {
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

