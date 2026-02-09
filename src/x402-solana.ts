import { Connection, PublicKey } from "@solana/web3.js";
import { z } from "zod";

const EnvSchema = z.object({
  SOLANA_RPC_URL: z.string().min(1),
  // Allow empty in dev-bypass mode so the server can boot immediately.
  // We validate it later (only when bypass is disabled).
  X402_TREASURY_ADDRESS: z.string().optional().transform((v) => String(v ?? "").trim()),
  X402_PRICE_USD: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 0.25 : Number(v)))
    .pipe(z.number().finite().positive().max(100)),
  X402_DEV_BYPASS: z
    .string()
    .optional()
    .transform((v) => String(v ?? "false").toLowerCase() === "true"),
});

export type X402Config = z.infer<typeof EnvSchema>;

export function readX402ConfigFromEnv(env: NodeJS.ProcessEnv): X402Config {
  return EnvSchema.parse(env);
}

export type PaymentCheckResult =
  | { ok: true; txSig: string; paidLamports: number; paidTo: string }
  | { ok: false; reason: string };

/**
 * Minimal "x402-style" gate:
 * - Client pays SOL to treasury address, then sends `X-Payment-Tx: <signature>`
 * - Server verifies parsed transaction contains a SystemProgram transfer to treasury >= requiredLamports.
 *
 * Notes:
 * - This is intentionally small and judge-friendly; it can be extended to handle SPL/USDC.
 */
export async function verifySolPayment(args: {
  connection: Connection;
  treasuryAddress: string;
  txSignature: string;
  requiredLamports: number;
}): Promise<PaymentCheckResult> {
  const txSignature = args.txSignature.trim();
  if (!txSignature) return { ok: false, reason: "missing tx signature" };

  let treasury: PublicKey;
  try {
    treasury = new PublicKey(args.treasuryAddress);
  } catch {
    return { ok: false, reason: "invalid treasury address" };
  }

  const tx = await args.connection.getParsedTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!tx) return { ok: false, reason: "transaction not found (yet)" };
  if (tx.meta?.err) return { ok: false, reason: "transaction failed" };

  // Check instructions for a transfer to treasury.
  const instructions = tx.transaction.message.instructions;
  let paidLamports = 0;
  for (const ix of instructions as any[]) {
    const parsed = ix?.parsed;
    const program = String(ix?.program ?? "");
    const type = String(parsed?.type ?? "");
    if (program !== "system" || type !== "transfer") continue;
    const info = parsed?.info ?? {};
    const dest = String(info?.destination ?? "");
    const lamports = Number(info?.lamports ?? 0);
    if (!dest || !Number.isFinite(lamports)) continue;
    if (dest === treasury.toBase58()) {
      paidLamports += lamports;
    }
  }

  if (paidLamports < args.requiredLamports) {
    return {
      ok: false,
      reason: `insufficient payment: paid ${paidLamports} lamports, require ${args.requiredLamports}`,
    };
  }

  return {
    ok: true,
    txSig: txSignature,
    paidLamports,
    paidTo: treasury.toBase58(),
  };
}

/**
 * Very small SOL/USD conversion using a public price endpoint.
 * For hackathon demo this is fine; for production use a proper oracle.
 */
export async function fetchSolUsdPrice(timeoutMs = 8_000): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`price http ${resp.status}`);
    const data: any = await resp.json();
    const px = Number(data?.solana?.usd);
    if (!Number.isFinite(px) || px <= 0) throw new Error("invalid price");
    return px;
  } finally {
    clearTimeout(timer);
  }
}

export function usdToLamports(args: { usd: number; solUsd: number }): number {
  const sol = args.usd / args.solUsd;
  const lamports = Math.ceil(sol * 1_000_000_000);
  return Math.max(1, lamports);
}

