import { z } from "zod";

const MarketSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  question: z.string().catch(""),
  outcomes: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (typeof v === "string") {
        try {
          const parsed = JSON.parse(v);
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          return [];
        }
      }
      return Array.isArray(v) ? v.map(String) : [];
    }),
  outcomePrices: z
    .union([z.string(), z.array(z.union([z.string(), z.number()]))])
    .optional()
    .transform((v) => {
      if (typeof v === "string") {
        try {
          const parsed = JSON.parse(v);
          return Array.isArray(parsed) ? parsed.map((x) => Number(x)) : [];
        } catch {
          return [];
        }
      }
      return Array.isArray(v) ? v.map((x) => Number(x)) : [];
    }),
  volume24hr: z.any().optional(),
  liquidity: z.any().optional(),
  liquidityNum: z.any().optional(),
  active: z.any().optional(),
  closed: z.any().optional(),
  restricted: z.any().optional(),
  endDate: z.any().optional(),
});

export type GammaMarket = z.infer<typeof MarketSchema> & {
  volume24hrNum: number;
  liquidityNum2: number;
  yesPrice: number | null;
  restrictedBool: boolean;
  endDateIso: string | null;
  endDateMs: number | null;
};

function toFiniteNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function getGammaApiUrl(env: NodeJS.ProcessEnv): string {
  return String(env.GAMMA_API_URL || "https://gamma-api.polymarket.com").replace(/\/+$/g, "");
}

export async function fetchGammaMarkets(args: {
  gammaApiUrl: string;
  limit: number;
  offset?: number;
  timeoutMs?: number;
}): Promise<GammaMarket[]> {
  const limit = Math.max(1, Math.min(500, Math.floor(args.limit)));
  const offset = Math.max(0, Math.floor(args.offset ?? 0));
  const timeoutMs = Number.isFinite(Number(args.timeoutMs)) ? Math.max(1000, Number(args.timeoutMs)) : 12_000;

  const url =
    `${args.gammaApiUrl}/markets?limit=${limit}&offset=${offset}` +
    `&active=true&closed=false&restricted=false&order=volume24hr&ascending=false`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "elizabao-claw/0.1" },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Gamma HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data: unknown = await resp.json();
    const arr = Array.isArray(data) ? data : [];
    return arr
      .map((m) => MarketSchema.safeParse(m))
      .filter((x) => x.success)
      .map((x) => x.data)
      .map((m) => {
        const v24 = toFiniteNumber((m as any).volume24hr) ?? 0;
        const liq = toFiniteNumber((m as any).liquidityNum ?? (m as any).liquidity) ?? 0;
        const yes = m.outcomePrices?.length ? toFiniteNumber(m.outcomePrices[0]) : null;
        const restrictedBool = Boolean((m as any).restricted);
        const endDateIso = typeof (m as any).endDate === "string" ? String((m as any).endDate) : null;
        const endDateMs = endDateIso ? Date.parse(endDateIso) : NaN;
        return {
          ...(m as any),
          volume24hrNum: v24,
          liquidityNum2: liq,
          yesPrice: yes,
          restrictedBool,
          endDateIso,
          endDateMs: Number.isFinite(endDateMs) ? endDateMs : null,
        };
      });
  } finally {
    clearTimeout(timer);
  }
}

export type PolymarketSignalItem = {
  marketId: string;
  question: string;
  yesPrice: number;
  score: number;
  volume24hr: number;
  liquidity: number;
  category: string;
  restricted: boolean;
  endDate: string | null;
  hoursToExpiry: number | null;
  why: string;
};

function categorize(question: string): string {
  const q = (question || "").toLowerCase();
  if (q.includes("bitcoin") || q.includes("btc") || q.includes("ethereum") || q.includes("eth") || q.includes("solana") || q.includes("sol")) {
    return "crypto";
  }
  if (q.includes("election") || q.includes("president") || q.includes("trump") || q.includes("biden") || q.includes("congress") || q.includes("senate")) {
    return "politics";
  }
  if (q.includes("vs.") || q.includes("nba") || q.includes("nfl") || q.includes("nhl") || q.includes("mlb") || q.includes("soccer") || q.includes("fifa")) {
    return "sports";
  }
  return "other";
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function topYesNoSignals(
  markets: GammaMarket[],
  opts?: {
    max?: number;
    q?: string;
    /**
     * Some Gamma responses still mark markets as `restricted:true` even when
     * the request includes `restricted=false`. In practice, these markets are
     * still visible in the public API responses and are useful for discovery.
     *
     * Default: true (include them) so the endpoint doesn't return empty results.
     */
    includeRestricted?: boolean;
    minYesPrice?: number;
    maxYesPrice?: number;
    minLiquidityUsd?: number;
    minVolume24hrUsd?: number;
    maxHoursToExpiry?: number;
  }
): PolymarketSignalItem[] {
  const max = Math.max(1, Math.min(50, Math.floor(opts?.max ?? 10)));
  const qNorm = (opts?.q || "").trim().toLowerCase();
  const includeRestricted = Boolean(opts?.includeRestricted ?? true);
  const minYes = Number.isFinite(Number(opts?.minYesPrice)) ? clamp(Number(opts?.minYesPrice), 0.001, 0.999) : 0.1;
  const maxYes = Number.isFinite(Number(opts?.maxYesPrice)) ? clamp(Number(opts?.maxYesPrice), 0.001, 0.999) : 0.9;
  const minLiquidity = Number.isFinite(Number(opts?.minLiquidityUsd)) ? Math.max(0, Number(opts?.minLiquidityUsd)) : 10_000;
  const minVolume = Number.isFinite(Number(opts?.minVolume24hrUsd)) ? Math.max(0, Number(opts?.minVolume24hrUsd)) : 50_000;
  const maxHoursToExpiry = Number.isFinite(Number(opts?.maxHoursToExpiry)) ? Math.max(0, Number(opts?.maxHoursToExpiry)) : 24 * 365 * 10;

  const isYesNo = (m: GammaMarket) => Array.isArray(m.outcomes) && m.outcomes.length === 2;

  const filtered = markets
    .filter((m) => m && isYesNo(m))
    .filter((m) => typeof m.yesPrice === "number" && m.yesPrice > 0 && m.yesPrice < 1)
    .filter((m) => (includeRestricted ? true : !m.restrictedBool))
    .filter((m) => (m.yesPrice as number) >= minYes && (m.yesPrice as number) <= maxYes)
    .filter((m) => (m.liquidityNum2 ?? 0) >= minLiquidity)
    .filter((m) => (m.volume24hrNum ?? 0) >= minVolume)
    .filter((m) => {
      if (!m.endDateMs) return true;
      const hours = (m.endDateMs - Date.now()) / 3_600_000;
      // Skip clearly expired / ended markets and extremely far future if user wants a cap.
      if (!Number.isFinite(hours) || hours <= -1) return false;
      return hours <= maxHoursToExpiry;
    })
    .filter((m) => (qNorm ? String(m.question || "").toLowerCase().includes(qNorm) : true))
    .map((m) => {
      const yes = m.yesPrice as number;
      // Simple “interestingness” score for demo purposes:
      // - closer to 0.5 is more uncertain
      // - higher volume is more liquid
      const uncertainty = 1 - Math.min(1, Math.abs(yes - 0.5) * 2);
      const volumeScore = Math.min(1, (m.volume24hrNum ?? 0) / 500_000);
      const liquidityScore = Math.min(1, (m.liquidityNum2 ?? 0) / 500_000);
      const score = uncertainty * 0.6 + volumeScore * 0.25 + liquidityScore * 0.15;
      const hoursToExpiry =
        m.endDateMs && Number.isFinite(m.endDateMs) ? Math.max(0, (m.endDateMs - Date.now()) / 3_600_000) : null;
      const cat = categorize(m.question);
      const why = [
        `uncertainty=${(uncertainty * 100).toFixed(0)}%`,
        `vol24h=$${Math.round(m.volume24hrNum ?? 0).toLocaleString()}`,
        `liq=$${Math.round(m.liquidityNum2 ?? 0).toLocaleString()}`,
        hoursToExpiry !== null ? `expires~${hoursToExpiry.toFixed(1)}h` : null,
      ]
        .filter(Boolean)
        .join(" | ");
      return {
        marketId: String(m.id),
        question: String(m.question || "").trim(),
        yesPrice: yes,
        score,
        volume24hr: m.volume24hrNum ?? 0,
        liquidity: m.liquidityNum2 ?? 0,
        category: cat,
        restricted: m.restrictedBool,
        endDate: m.endDateIso,
        hoursToExpiry,
        why,
      };
    })
    .sort((a, b) => b.score - a.score);

  return filtered.slice(0, max);
}

