import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Connection } from "@solana/web3.js";
import { fetchSolUsdPrice, readX402ConfigFromEnv, usdToLamports, verifySolPayment } from "./x402-solana.js";
import { fetchGammaMarkets, getGammaApiUrl, topYesNoSignals } from "./polymarket-gamma.js";
import {
  buildAccepts,
  create402Body,
  encodeBase64Json,
  extractPaymentFromHeaders,
  getX402TreasuryAddress,
  settleAndVerifyPayment,
} from "./x402-agentinc.js";

const app = new Hono();

app.get("/", (c) =>
  c.json({
    name: "ElizaBAO + Claw",
    ok: true,
    endpoints: {
      health: "GET /health",
      pricing: "GET /x402/pricing",
      paidSignal: "GET /signals/daily (requires payment)",
      polymarketMarkets: "GET /polymarket/markets?limit=50&q=btc",
      polymarketSignals: "GET /signals/polymarket/top (paid unless bypass enabled)",
    },
  })
);

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.get("/x402/pricing", async (c) => {
  const cfg = readX402ConfigFromEnv(process.env);
  const solUsd = await fetchSolUsdPrice().catch(() => null);
  const requiredLamports = solUsd ? usdToLamports({ usd: cfg.X402_PRICE_USD, solUsd }) : null;
  const treasury = getX402TreasuryAddress() || null;
  return c.json({
    ok: true,
    pricing: {
      usd: cfg.X402_PRICE_USD,
      solUsd,
      requiredLamports,
      treasury,
      headers: {
        payment: "X-PAYMENT: base64(JSON(paymentPayload))",
        paymentTxFallback: "X-Payment-Tx: <solana signature> (manual fallback)",
      },
      notes:
        cfg.X402_DEV_BYPASS
          ? ["Dev bypass enabled: /signals/daily will not require payment.", "Set X402_DEV_BYPASS=false to enforce payments."]
          : treasury
            ? []
            : ["Set X402_TREASURY_ADDRESS in .env to enable payment verification."],
    },
  });
});

app.get("/signals/daily", async (c) => {
  const cfg = readX402ConfigFromEnv(process.env);

  if (cfg.X402_DEV_BYPASS) {
    return c.json({
      ok: true,
      paid: false,
      bypass: true,
      signal: demoSignal(),
    });
  }

  const treasury = getX402TreasuryAddress();
  if (!treasury) {
    return c.json(
      {
        ok: false,
        error: "server not configured",
        reason: "X402_TREASURY_ADDRESS is required when X402_DEV_BYPASS=false",
        fix: "Set X402_TREASURY_ADDRESS in your .env (Solana address that receives payments).",
      },
      500
    );
  }

  const solUsd = await fetchSolUsdPrice().catch(() => null);
  if (!solUsd) {
    return c.json(
      {
        ok: false,
        error: "pricing unavailable",
        reason: "Failed to fetch SOL/USD price from upstream",
        tip: "Retry in a few seconds or set X402_DEV_BYPASS=true for local dev.",
      },
      502
    );
  }
  const requiredLamports = BigInt(usdToLamports({ usd: cfg.X402_PRICE_USD, solUsd }));
  const accepts = buildAccepts({
    lamports: requiredLamports,
    resource: String(c.req.url),
    description: "Unlock daily signal",
    usdAmount: cfg.X402_PRICE_USD,
    solPrice: solUsd,
  });

  // Manual fallback: allow passing just a transaction signature.
  // This makes demoing with Phantom easy while keeping the x402 `X-PAYMENT` path as the primary flow.
  const paymentTx = (c.req.header("x-payment-tx") || c.req.header("X-Payment-Tx") || "").trim();
  if (paymentTx) {
    const connection = new Connection(cfg.SOLANA_RPC_URL, "confirmed");
    const check = await verifySolPayment({
      connection,
      treasuryAddress: treasury,
      txSignature: paymentTx,
      requiredLamports: Number(requiredLamports),
    });
    if (!check.ok) {
      const body = create402Body({ accepts, error: check.reason });
      return c.json(body, 402, { "X-Payment-Required": encodeBase64Json(body) });
    }
    return c.json({
      ok: true,
      paid: true,
      payment: {
        network: "solana",
        transaction: check.txSig,
        paidLamports: String(check.paidLamports),
        payer: null,
        flow: "txSig",
      },
      signal: demoSignal(),
    });
  }

  const parsed = extractPaymentFromHeaders(c.req.raw.headers);
  if (!parsed.ok) {
    const body = create402Body({ accepts });
    return c.json(body, 402, { "X-Payment-Required": encodeBase64Json(body) });
  }

  const connection = new Connection(cfg.SOLANA_RPC_URL, "confirmed");
  const verify = await settleAndVerifyPayment({
    connection,
    signedTxBase64: parsed.txBase64,
    requiredLamports,
    treasuryAddress: treasury,
  });
  if (!verify.ok) {
    const body = create402Body({ accepts, error: verify.reason });
    return c.json(body, 402, { "X-Payment-Required": encodeBase64Json(body) });
  }

  return c.json({
    ok: true,
    paid: true,
    payment: {
      network: "solana",
      transaction: verify.signature,
      paidLamports: verify.paidLamports.toString(),
      payer: verify.payer ?? null,
    },
    signal: demoSignal(),
  });
});

app.get("/polymarket/markets", async (c) => {
  const limit = Math.max(1, Math.min(200, Number(c.req.query("limit") || 50)));
  const q = (c.req.query("q") || "").trim();
  const gammaApiUrl = getGammaApiUrl(process.env);
  const markets = await fetchGammaMarkets({ gammaApiUrl, limit, offset: 0, timeoutMs: 12_000 });
  const out = q
    ? markets.filter((m) => String(m.question || "").toLowerCase().includes(q.toLowerCase()))
    : markets;
  return c.json({ ok: true, gammaApiUrl, count: out.length, markets: out });
});

app.get("/signals/polymarket/top", async (c) => {
  const cfg = readX402ConfigFromEnv(process.env);

  // In bypass mode, return signals freely (nice for local dev).
  // In paid mode, require a payment tx (same flow as /signals/daily).
  if (!cfg.X402_DEV_BYPASS) {
    const treasury = getX402TreasuryAddress();
    if (!treasury) {
      return c.json(
        {
          ok: false,
          error: "server not configured",
          reason: "X402_TREASURY_ADDRESS is required when X402_DEV_BYPASS=false",
        },
        500
      );
    }
    const solUsd = await fetchSolUsdPrice().catch(() => null);
    if (!solUsd) {
      return c.json(
        {
          ok: false,
          error: "pricing unavailable",
          reason: "Failed to fetch SOL/USD price from upstream",
        },
        502
      );
    }
    const requiredLamports = BigInt(usdToLamports({ usd: cfg.X402_PRICE_USD, solUsd }));
    const accepts = buildAccepts({
      lamports: requiredLamports,
      resource: String(c.req.url),
      description: "Unlock Polymarket top signals",
      usdAmount: cfg.X402_PRICE_USD,
      solPrice: solUsd,
    });

    const paymentTx = (c.req.header("x-payment-tx") || c.req.header("X-Payment-Tx") || "").trim();
    if (paymentTx) {
      const connection = new Connection(cfg.SOLANA_RPC_URL, "confirmed");
      const check = await verifySolPayment({
        connection,
        treasuryAddress: treasury,
        txSignature: paymentTx,
        requiredLamports: Number(requiredLamports),
      });
      if (!check.ok) {
        const body = create402Body({ accepts, error: check.reason });
        return c.json(body, 402, { "X-Payment-Required": encodeBase64Json(body) });
      }
      // continue to compute and return signals (paid)
    } else {
      const parsed = extractPaymentFromHeaders(c.req.raw.headers);
      if (!parsed.ok) {
        const body = create402Body({ accepts });
        return c.json(body, 402, { "X-Payment-Required": encodeBase64Json(body) });
      }

      const connection = new Connection(cfg.SOLANA_RPC_URL, "confirmed");
      const verify = await settleAndVerifyPayment({
        connection,
        signedTxBase64: parsed.txBase64,
        requiredLamports,
        treasuryAddress: treasury,
      });
      if (!verify.ok) {
        const body = create402Body({ accepts, error: verify.reason });
        return c.json(body, 402, { "X-Payment-Required": encodeBase64Json(body) });
      }
    }

  }

  const limit = Math.max(1, Math.min(50, Number(c.req.query("limit") || 10)));
  const q = (c.req.query("q") || "").trim();
  const includeRestrictedRaw = c.req.query("includeRestricted");
  const includeRestricted =
    includeRestrictedRaw === undefined ? true : String(includeRestrictedRaw).toLowerCase() === "true";
  const minYesPrice = c.req.query("minYesPrice") ? Number(c.req.query("minYesPrice")) : undefined;
  const maxYesPrice = c.req.query("maxYesPrice") ? Number(c.req.query("maxYesPrice")) : undefined;
  const minLiquidityUsd = c.req.query("minLiquidityUsd") ? Number(c.req.query("minLiquidityUsd")) : undefined;
  const minVolume24hrUsd = c.req.query("minVolume24hrUsd") ? Number(c.req.query("minVolume24hrUsd")) : undefined;
  const maxHoursToExpiry = c.req.query("maxHoursToExpiry") ? Number(c.req.query("maxHoursToExpiry")) : undefined;
  const gammaApiUrl = getGammaApiUrl(process.env);
  const markets = await fetchGammaMarkets({ gammaApiUrl, limit: 200, offset: 0, timeoutMs: 12_000 });
  const signals = topYesNoSignals(markets, {
    max: limit,
    q,
    includeRestricted,
    minYesPrice,
    maxYesPrice,
    minLiquidityUsd,
    minVolume24hrUsd,
    maxHoursToExpiry,
  });

  return c.json({
    ok: true,
    paid: !cfg.X402_DEV_BYPASS,
    generatedAt: new Date().toISOString(),
    gammaApiUrl,
    filters: {
      q: q || null,
      includeRestricted,
      minYesPrice: minYesPrice ?? 0.1,
      maxYesPrice: maxYesPrice ?? 0.9,
      minLiquidityUsd: minLiquidityUsd ?? 10_000,
      minVolume24hrUsd: minVolume24hrUsd ?? 50_000,
      maxHoursToExpiry: maxHoursToExpiry ?? 24 * 365 * 10,
    },
    signals,
    notes: ["Public data only (Gamma API). No private keys required."],
  });
});

function demoSignal() {
  return {
    generatedAt: new Date().toISOString(),
    title: "Demo: paid signal unlocked",
    summary:
      "This is a placeholder premium report. Next: plug in ElizaOS + Moltbook to auto-publish a teaser and sell the full thesis via payment.",
    items: [
      { market: "Example market", thesis: "Example thesis", confidence: 0.62, action: "WATCH" as const },
      { market: "Another market", thesis: "Another thesis", confidence: 0.71, action: "BUY_SMALL" as const },
    ],
  };
}

const port = Number(process.env.PORT || 3333);
serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://0.0.0.0:${info.port}`);
});

