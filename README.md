# ElizaBAO + Claw

An **ElizaOS-powered agent service** that combines:

- **Polymarket public market scanning + ranked signals** (Gamma API; no private keys required)
- **x402-style SOL payments** to gate premium endpoints (HTTP `402 Payment Required`)
- **Moltbook** agent identity + posting utilities (optional; beware moderation/duplicate rules)

## Table of contents

- [Quick start](#quick-start)
- [Demo (x402 paid unlock)](#demo-x402-paid-unlock)
- [API endpoints](#api-endpoints)
- [Configuration](#configuration)
- [Polymarket signals](#polymarket-signals)
- [Moltbook posters](#moltbook-posters)
- [Vendor code (submodules)](#vendor-code-submodules)

## Quick start

```bash
git clone --recurse-submodules https://github.com/elizabaoxyz/elizabao-claw.git
cd elizabao-claw
bun install
cp .env.example .env
bun run dev
```

## Architecture (high level)

```
            ┌──────────────────────────────────────────┐
            │          Polymarket public APIs           │
            │  Gamma: https://gamma-api.polymarket.com  │
            │  Data : https://data-api.polymarket.com   │
            └───────────────────────┬───────────────────┘
                                    │ (fetch)
                                    v
┌────────────────────────────────────────────────────────────────────┐
│                         Localhost service                           │
│                         `src/server.ts`                              │
│  - /signals/polymarket/top   (ranked signals)                        │
│  - /polymarket/markets       (market discovery)                      │
│  - /signals/daily            (paid x402 endpoint)                    │
│  - /x402/pricing             (quote + headers)                       │
└───────────────────────┬────────────────────────────────────────────┘
                        │
                        │ 402 Payment Required (x402)
                        │ proof via X-PAYMENT or X-Payment-Tx
                        v
              ┌──────────────────────────┐
              │     Paid unlock flow      │
              │  wallet pays → retry API  │
              └─────────────┬────────────┘
                            │
                            │ optional distribution / automation
                            v
┌────────────────────────────────────────────────────────────────────┐
│                    ElizaOS runtime + Moltbook bot                   │
│                    `src/agent-moltbook.ts`                           │
│  - AgentRuntime (ElizaOS)                                            │
│  - Moltbook plugin (identity + social actions)                       │
│  - Can fetch from localhost endpoints and publish updates:           │
│    - daily teaser (`moltbook:daily-teaser`)                          │
│    - new markets (`moltbook:new-markets`)                            │
│    - whale watch (`moltbook:whale-watch`)                            │
└───────────────────────────────┬────────────────────────────────────┘
                                │ (post/comment)
                                v
                 ┌────────────────────────────────────┐
                 │              Moltbook               │
                 │   https://www.moltbook.com/api/v1   │
                 └────────────────────────────────────┘
```

## Demo (x402 paid unlock)

This is the fastest judge demo (wallet + curl):

1) Request the paid endpoint (you’ll get a **402 quote**):

```bash
curl -i http://localhost:3333/signals/daily
```

2) Pay the quote with Phantom (send SOL to `accepts[0].payTo`, amount >= `accepts[0].maxAmountRequired`)

3) Retry with the transaction signature:

```bash
curl -i http://localhost:3333/signals/daily \
  -H "X-Payment-Tx: <PASTE_SIGNATURE>"
```

You should get **200 OK** with `"paid": true`.

## API endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Healthcheck |
| `GET /x402/pricing` | Current price quote (USD → lamports) + required headers |
| `GET /signals/daily` | Paid-gated demo endpoint (x402) |
| `GET /signals/polymarket/top` | Ranked Polymarket signals (public) |
| `GET /polymarket/markets` | Raw market discovery (public) |

## Configuration

In `.env`:

```bash
PORT=3333

# Paywall (SOL)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
X402_TREASURY_ADDRESS=<your Solana address>
X402_PRICE_USD=0.25
X402_DEV_BYPASS=false

# Polymarket public data
GAMMA_API_URL=https://gamma-api.polymarket.com

# Polymarket Data API (public)
DATA_API_URL=https://data-api.polymarket.com
```

## x402 payments (what we implement)

**x402** is the standard HTTP pattern where paid endpoints return **`402 Payment Required`** with a machine-readable quote.

This repo supports two payment proof styles:

- **Primary (agentinc-compatible)**: `X-PAYMENT: base64(JSON(paymentPayload))`
- **Manual demo fallback**: `X-Payment-Tx: <solana transaction signature>`

Both paths verify that a System Program **SOL transfer** paid at least the quoted lamports to `X402_TREASURY_ADDRESS`.

### One-command local demo (x402 `X-PAYMENT`)

If you want to demo the “agent pays automatically” flow:

```bash
bun run x402:demo
```

Notes:
- Devnet faucets/rate-limits can fail. The script will print a payer address to fund if needed.

## Polymarket signals (public Gamma API)

The `/signals/polymarket/top` endpoint pulls active markets from the **public Gamma API** and ranks YES/NO markets by a simple “interestingness” score:

- **Uncertainty** (closer to 0.5 is more uncertain)
- **24h volume** (more active markets)
- **Liquidity**

Each result includes a human-readable `why` string (e.g. `uncertainty=93% | vol24h=$148,425 | liq=$33,619 | expires~293.8h`).

### Filters

`GET /signals/polymarket/top` supports:
- `limit`
- `q` (substring match on question)
- `includeRestricted` (default true)
- `minYesPrice`, `maxYesPrice`
- `minLiquidityUsd`, `minVolume24hrUsd`
- `maxHoursToExpiry`

Example:

```bash
curl "http://localhost:3333/signals/polymarket/top?limit=10&q=btc&minLiquidityUsd=50000&minVolume24hrUsd=100000"
```

## Moltbook posters

> Note: Moltbook is strict on duplicate content for new agents. These scripts add a per-run nonce and auto-verify challenges, but you should still avoid spamming.

### Run the agent runtime (optional)

```bash
bun run agent:moltbook
```

### Daily top signals teaser

Posts a Top-N Polymarket teaser (fresh text each run) and links to your paid report endpoint:

```bash
bun run moltbook:daily-teaser
```

Useful env knobs:
- `PUBLIC_BASE_URL` (where your server is reachable; used for links)
- `MOLTBOOK_TEASER_LIMIT` (default 3)
- `MOLTBOOK_TEASER_SUBMOLT` (default `general`)

### New markets radar

Posts the newest markets (Gamma `/events` ordered newest-first) with direct Polymarket links:

```bash
bun run moltbook:new-markets
```

### Whale watch

Posts the largest recent trades by scanning the public Data API leaderboard + user activity:

```bash
bun run moltbook:whale-watch
```



