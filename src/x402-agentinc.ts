import { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { z } from "zod";

// Import schemas + config from the team's x402 implementation (agentinc).
// We intentionally only rely on the parts that are framework-agnostic.
import { SOL_NETWORK, TREASURY_ADDRESS } from "../vendor/agentinc/lib/x402/config";
import { SolPaymentPayloadSchema } from "../vendor/agentinc/lib/x402/validation";

export type X402Accepts = {
  scheme: "exact";
  network: "solana" | "solana-devnet";
  maxAmountRequired: string; // lamports
  asset: "native";
  payTo: string;
  resource: string;
  description: string;
  maxTimeoutSeconds: number;
  extra?: {
    usdAmount?: string;
    solPrice?: number;
  };
};

export type X402Receipt = {
  success: boolean;
  transaction?: string;
  network: "solana" | "solana-devnet";
  payer?: string;
  amount?: { lamports: string; sol: string; usd?: string };
  error?: string;
  flow?: "external";
};

const EnvSchema = z.object({
  SOLANA_RPC_URL: z.string().min(1),
  X402_TREASURY_ADDRESS: z.string().optional().transform((v) => String(v ?? "").trim()),
});

export function getX402TreasuryAddress(): string {
  // Prefer the canonical address from agentinc config (it reads X402_TREASURY_ADDRESS).
  // Fall back to env parsing if needed.
  if (TREASURY_ADDRESS) return TREASURY_ADDRESS;
  const env = EnvSchema.parse(process.env);
  return env.X402_TREASURY_ADDRESS;
}

export function getX402Network(): "solana" | "solana-devnet" {
  return SOL_NETWORK;
}

export function buildAccepts(args: {
  lamports: bigint;
  resource: string;
  description: string;
  usdAmount?: number;
  solPrice?: number;
}): X402Accepts {
  return {
    scheme: "exact",
    network: getX402Network(),
    maxAmountRequired: args.lamports.toString(),
    asset: "native",
    payTo: getX402TreasuryAddress(),
    resource: args.resource,
    description: args.description,
    maxTimeoutSeconds: 300,
    extra:
      args.usdAmount !== undefined
        ? {
            usdAmount: args.usdAmount.toFixed(4),
            solPrice: args.solPrice,
          }
        : undefined,
  };
}

export function create402Body(args: { accepts: X402Accepts; error?: string }) {
  return {
    x402Version: 1,
    error: args.error ?? "Payment required",
    accepts: [args.accepts],
  };
}

export function encodeBase64Json(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

export function decodeBase64Json(value: string): unknown {
  const decoded = Buffer.from(value, "base64").toString("utf8");
  return JSON.parse(decoded);
}

export type ParsedPayment =
  | { ok: true; txBase64: string }
  | { ok: false; reason: string };

/**
 * x402 standard (agentinc):
 * - `X-PAYMENT` header contains base64(JSON(paymentPayload))
 * - paymentPayload.payload.transaction contains base64(signed transaction bytes)
 */
export function extractPaymentFromHeaders(headers: Headers): ParsedPayment {
  const raw = headers.get("X-PAYMENT") || headers.get("PAYMENT-SIGNATURE") || "";
  if (!raw) return { ok: false, reason: "missing X-PAYMENT header" };
  try {
    const parsed = decodeBase64Json(raw);
    const result = SolPaymentPayloadSchema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, reason: "invalid payment payload" };
    }
    return { ok: true, txBase64: result.data.payload.transaction };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "bad X-PAYMENT encoding" };
  }
}

export type VerifyResult =
  | { ok: true; signature: string; payer?: string; paidLamports: bigint }
  | { ok: false; reason: string };

/**
 * Settle+verify:
 * - If tx not found, submit it to chain (settle)
 * - Verify parsed tx includes System transfer to treasury >= requiredLamports
 */
export async function settleAndVerifyPayment(args: {
  connection: Connection;
  signedTxBase64: string;
  requiredLamports: bigint;
  treasuryAddress: string;
}): Promise<VerifyResult> {
  const raw = Buffer.from(args.signedTxBase64, "base64");
  if (!raw.length) return { ok: false, reason: "empty transaction" };

  // Transaction signature is the first signature in the signed tx bytes.
  // We don't deserialize fully here; we optimistically try submit + then read parsed tx by signature.
  // If submit returns a signature, use that; otherwise fall back to extracting from raw is tricky.
  let sig: string | null = null;
  try {
    sig = await args.connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 2 });
  } catch {
    // maybe already landed; try to extract the signature bytes by deserializing
    try {
      // Lazy import to avoid extra work unless needed
      const { VersionedTransaction } = await import("@solana/web3.js");
      const tx = VersionedTransaction.deserialize(raw);
      const first = tx.signatures?.[0];
      if (first && first.length) sig = bs58.encode(first);
    } catch {
      // ignore
    }
  }

  if (!sig) return { ok: false, reason: "could not determine tx signature" };

  // Confirm + parse
  const parsed = await args.connection.getParsedTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!parsed) return { ok: false, reason: "transaction not found/confirmed yet" };
  if (parsed.meta?.err) return { ok: false, reason: "transaction failed" };

  const instructions = parsed.transaction.message.instructions as any[];
  let paid = 0n;
  for (const ix of instructions) {
    const program = String(ix?.program ?? "");
    const type = String(ix?.parsed?.type ?? "");
    if (program !== "system" || type !== "transfer") continue;
    const dest = String(ix?.parsed?.info?.destination ?? "");
    const lamports = BigInt(String(ix?.parsed?.info?.lamports ?? "0"));
    if (dest === args.treasuryAddress) paid += lamports;
  }

  if (paid < args.requiredLamports) {
    return { ok: false, reason: `insufficient payment: paid=${paid} require=${args.requiredLamports}` };
  }

  const payer = parsed.transaction.message.accountKeys?.[0]?.pubkey?.toBase58?.();
  return { ok: true, signature: sig, payer, paidLamports: paid };
}

