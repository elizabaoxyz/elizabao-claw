import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import fs from "node:fs/promises";
import { z } from "zod";

import { encodeBase64Json } from "./x402-agentinc.js";

const EnvSchema = z.object({
  PORT: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 3333 : Number(v)))
    .pipe(z.number().int().positive().max(65535)),
  SOLANA_RPC_URL: z.string().min(1),
  // Optional: if set, we will pay to this directly (otherwise we use accepts[].payTo)
  X402_TREASURY_ADDRESS: z.string().optional().transform((v) => String(v ?? "").trim()),
  // Optional: if set, we will pay this many lamports (otherwise use accepts[].maxAmountRequired)
  X402_LAMPORTS_OVERRIDE: z
    .string()
    .optional()
    .transform((v) => (v ? BigInt(v) : null)),
});

type Accepts = {
  scheme: "exact";
  network: "solana" | "solana-devnet";
  maxAmountRequired: string;
  asset: "native";
  payTo: string;
  resource: string;
  description: string;
  maxTimeoutSeconds: number;
};

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function requestAirdropIfDevnet(connection: Connection, payer: Keypair) {
  const url = connection.rpcEndpoint || "";
  if (!url.includes("devnet")) return;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const sig = await connection.requestAirdrop(payer.publicKey, Math.floor(0.05 * 1e9));
      await connection.confirmTransaction(sig, "confirmed");
      return;
    } catch (e) {
      lastErr = e;
      await sleep(500 * Math.pow(2, attempt - 1));
    }
  }

  throw new Error(
    `Devnet airdrop failed after retries. Payer=${payer.publicKey.toBase58()} (error=${(lastErr as any)?.message ?? String(lastErr)})`,
  );
}

async function loadOrCreateDemoKeypair(file = ".x402-demo-keypair.json"): Promise<Keypair> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
  } catch {
    // ignore
  }
  const kp = Keypair.generate();
  await fs.writeFile(file, JSON.stringify(Array.from(kp.secretKey)), "utf8");
  return kp;
}

async function ensurePayerFunded(args: {
  connection: Connection;
  payer: Keypair;
  minLamports: bigint;
}): Promise<void> {
  const url = args.connection.rpcEndpoint || "";
  const bal = BigInt(await args.connection.getBalance(args.payer.publicKey, "confirmed"));
  if (bal >= args.minLamports) return;

  if (url.includes("devnet")) {
    // Try airdrop first; if rate-limited, user can fund via faucet once and rerun.
    await requestAirdropIfDevnet(args.connection, args.payer);
    return;
  }

  throw new Error(
    `Insufficient funds for payer=${args.payer.publicKey.toBase58()} balance=${bal} required>=${args.minLamports}. Fund this address and rerun.`,
  );
}

async function main() {
  const env = EnvSchema.parse(process.env);
  const endpointUrl = `http://localhost:${env.PORT}/signals/daily`;

  // First call: get 402 requirements
  const first = await fetch(endpointUrl);
  const firstJson: any = await first.json().catch(() => null);
  if (first.ok) {
    console.log(
      JSON.stringify(
        { ok: true, status: first.status, note: "Endpoint did not require payment (bypass enabled?)", response: firstJson },
        null,
        2,
      ),
    );
    return;
  }
  if (!firstJson?.accepts?.[0]) {
    console.error("Expected 402 response with accepts[], got:", first.status, firstJson);
    process.exit(1);
  }

  const accepts: Accepts = firstJson.accepts[0];
  const payTo = env.X402_TREASURY_ADDRESS || accepts.payTo;
  const requiredLamports = env.X402_LAMPORTS_OVERRIDE ?? BigInt(accepts.maxAmountRequired);

  // Use a stable local payer keypair for repeatable demos.
  // (It is gitignored; do not commit.)
  const payer = await loadOrCreateDemoKeypair();
  const connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
  try {
    // required + some fee buffer
    const minLamports = requiredLamports + 50_000n;
    await ensurePayerFunded({ connection, payer, minLamports });
  } catch (e: any) {
    console.error(String(e?.message ?? e));
    console.error(
      JSON.stringify(
        {
          nextStep:
            "Fund the demo payer on devnet, then rerun: bun run x402:demo",
          payerAddress: payer.publicKey.toBase58(),
          keypairFile: ".x402-demo-keypair.json",
          faucet: "https://faucet.solana.com",
          note: "Some RPC providers throttle airdrops (HTTP 429).",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  // Build and sign transfer tx
  const bh = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: bh.blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(payTo),
      lamports: Number(requiredLamports),
    })
  );

  tx.sign(payer);
  const signedBytes = tx.serialize();
  const signedTxBase64 = Buffer.from(signedBytes).toString("base64");

  // Build agentinc-compatible paymentPayload and X-PAYMENT header
  const paymentPayload = {
    x402Version: 1,
    scheme: "exact",
    network: accepts.network,
    payload: { transaction: signedTxBase64 },
  };

  const xPaymentHeader = encodeBase64Json(paymentPayload);

  // Second call: include payment header
  const second = await fetch(endpointUrl, {
    headers: { "X-PAYMENT": xPaymentHeader },
  });
  const secondJson = await second.json().catch(() => null);

  console.log(JSON.stringify({
    ok: second.ok,
    status: second.status,
    paidTo: payTo,
    requiredLamports: requiredLamports.toString(),
    payer: payer.publicKey.toBase58(),
    response: secondJson,
  }, null, 2));

  // Give RPC a moment if it was just submitted
  if (second.status === 402) {
    await sleep(1200);
  }
}

await main();

