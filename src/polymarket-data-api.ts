import { z } from "zod";

export function getDataApiUrl(env: NodeJS.ProcessEnv): string {
  return String(env.DATA_API_URL || "https://data-api.polymarket.com").replace(/\/+$/g, "");
}

const LeaderboardRowSchema = z.object({
  rank: z.string().catch(""),
  proxyWallet: z.string().catch(""),
  userName: z.string().optional().catch(""),
  vol: z.number().optional().catch(0),
  pnl: z.number().optional().catch(0),
  profileImage: z.string().optional().catch(""),
  xUsername: z.string().optional().catch(""),
  verifiedBadge: z.boolean().optional().catch(false),
});

export type LeaderboardRow = z.infer<typeof LeaderboardRowSchema>;

export async function fetchTraderLeaderboard(args: {
  dataApiUrl: string;
  category?: string;
  timePeriod?: string;
  orderBy?: string;
  limit?: number;
  offset?: number;
  timeoutMs?: number;
}): Promise<LeaderboardRow[]> {
  const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 25)));
  const offset = Math.max(0, Math.min(1000, Math.floor(args.offset ?? 0)));
  const timeoutMs = Number.isFinite(Number(args.timeoutMs)) ? Math.max(1000, Number(args.timeoutMs)) : 10_000;
  const category = String(args.category ?? "OVERALL");
  const timePeriod = String(args.timePeriod ?? "DAY");
  const orderBy = String(args.orderBy ?? "VOL");

  const url =
    `${args.dataApiUrl}/v1/leaderboard?` +
    `category=${encodeURIComponent(category)}` +
    `&timePeriod=${encodeURIComponent(timePeriod)}` +
    `&orderBy=${encodeURIComponent(orderBy)}` +
    `&limit=${limit}&offset=${offset}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "elizabao-claw/0.1" },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Data API HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data: unknown = await resp.json();
    const arr = Array.isArray(data) ? data : [];
    return arr
      .map((x) => LeaderboardRowSchema.safeParse(x))
      .filter((x) => x.success)
      .map((x) => x.data)
      .filter((x) => x.proxyWallet && x.proxyWallet.startsWith("0x") && x.proxyWallet.length === 42);
  } finally {
    clearTimeout(timer);
  }
}

const ActivitySchema = z.object({
  proxyWallet: z.string().catch(""),
  timestamp: z.number().catch(0),
  conditionId: z.string().optional().catch(""),
  type: z.string().optional().catch(""),
  size: z.number().optional().catch(0),
  usdcSize: z.number().optional().catch(0),
  transactionHash: z.string().optional().catch(""),
  price: z.number().optional().catch(0),
  asset: z.string().optional().catch(""),
  side: z.string().optional().catch(""),
  outcomeIndex: z.number().optional().catch(0),
  title: z.string().optional().catch(""),
  slug: z.string().optional().catch(""),
  eventSlug: z.string().optional().catch(""),
  outcome: z.string().optional().catch(""),
  name: z.string().optional().catch(""),
  pseudonym: z.string().optional().catch(""),
  bio: z.string().optional().catch(""),
  profileImage: z.string().optional().catch(""),
  profileImageOptimized: z.string().optional().catch(""),
});

export type UserActivity = z.infer<typeof ActivitySchema>;

export async function fetchUserActivity(args: {
  dataApiUrl: string;
  user: string;
  limit?: number;
  offset?: number;
  type?: string; // TRADE etc
  start?: number; // unix seconds
  end?: number; // unix seconds
  sortBy?: "TIMESTAMP" | "TOKENS" | "CASH";
  sortDirection?: "ASC" | "DESC";
  timeoutMs?: number;
}): Promise<UserActivity[]> {
  const limit = Math.max(1, Math.min(500, Math.floor(args.limit ?? 100)));
  const offset = Math.max(0, Math.min(10_000, Math.floor(args.offset ?? 0)));
  const timeoutMs = Number.isFinite(Number(args.timeoutMs)) ? Math.max(1000, Number(args.timeoutMs)) : 10_000;

  const params = new URLSearchParams();
  params.set("user", args.user);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (args.type) params.set("type", String(args.type));
  if (args.start !== undefined) params.set("start", String(Math.floor(args.start)));
  if (args.end !== undefined) params.set("end", String(Math.floor(args.end)));
  if (args.sortBy) params.set("sortBy", args.sortBy);
  if (args.sortDirection) params.set("sortDirection", args.sortDirection);

  const url = `${args.dataApiUrl}/activity?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "elizabao-claw/0.1" },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Data API HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data: unknown = await resp.json();
    const arr = Array.isArray(data) ? data : [];
    return arr
      .map((x) => ActivitySchema.safeParse(x))
      .filter((x) => x.success)
      .map((x) => x.data);
  } finally {
    clearTimeout(timer);
  }
}

