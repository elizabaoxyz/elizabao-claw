import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Connection } from "@solana/web3.js";
import { fetchSolUsdPrice, readX402ConfigFromEnv, usdToLamports, verifySolPayment } from "./x402-solana.js";
import { fetchGammaMarkets, getGammaApiUrl, topYesNoSignals } from "./polymarket-gamma.js";

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
  return c.json({
    ok: true,
    pricing: {
      usd: cfg.X402_PRICE_USD,
      solUsd,
      requiredLamports,
      treasury: cfg.X402_TREASURY_ADDRESS || null,
      headers: {
        paymentTx: "X-Payment-Tx: <solana signature>",
      },
      notes:
        cfg.X402_DEV_BYPASS
          ? ["Dev bypass enabled: /signals/daily will not require payment.", "Set X402_DEV_BYPASS=false to enforce payments."]
          : cfg.X402_TREASURY_ADDRESS
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

  if (!cfg.X402_TREASURY_ADDRESS) {
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

  const txSig = c.req.header("x-payment-tx") || "";
  if (!txSig.trim()) {
    return c.json(
      {
        ok: false,
        error: "payment required",
        how: "Send a Solana transfer to treasury, then retry with X-Payment-Tx header",
        treasury: cfg.X402_TREASURY_ADDRESS,
      },
      402
    );
  }

  const connection = new Connection(cfg.SOLANA_RPC_URL, "confirmed");
  const solUsd = await fetchSolUsdPrice();
  const requiredLamports = usdToLamports({ usd: cfg.X402_PRICE_USD, solUsd });

  const check = await verifySolPayment({
    connection,
    treasuryAddress: cfg.X402_TREASURY_ADDRESS,
    txSignature: txSig,
    requiredLamports,
  });

  if (!check.ok) {
    return c.json(
      {
        ok: false,
        error: "payment not verified",
        reason: check.reason,
        require: { requiredLamports, solUsd, usd: cfg.X402_PRICE_USD, treasury: cfg.X402_TREASURY_ADDRESS },
      },
      402
    );
  }

  return c.json({
    ok: true,
    paid: true,
    payment: check,
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
    if (!cfg.X402_TREASURY_ADDRESS) {
      return c.json(
        {
          ok: false,
          error: "server not configured",
          reason: "X402_TREASURY_ADDRESS is required when X402_DEV_BYPASS=false",
        },
        500
      );
    }
    const txSig = c.req.header("x-payment-tx") || "";
    if (!txSig.trim()) {
      return c.json(
        {
          ok: false,
          error: "payment required",
          how: "Send a Solana transfer to treasury, then retry with X-Payment-Tx header",
          treasury: cfg.X402_TREASURY_ADDRESS,
        },
        402
      );
    }

    const connection = new Connection(cfg.SOLANA_RPC_URL, "confirmed");
    const solUsd = await fetchSolUsdPrice();
    const requiredLamports = usdToLamports({ usd: cfg.X402_PRICE_USD, solUsd });
    const check = await verifySolPayment({
      connection,
      treasuryAddress: cfg.X402_TREASURY_ADDRESS,
      txSignature: txSig,
      requiredLamports,
    });
    if (!check.ok) {
      return c.json(
        {
          ok: false,
          error: "payment not verified",
          reason: check.reason,
          require: { requiredLamports, solUsd, usd: cfg.X402_PRICE_USD, treasury: cfg.X402_TREASURY_ADDRESS },
        },
        402
      );
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

