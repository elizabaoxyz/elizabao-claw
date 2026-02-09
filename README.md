# ElizaBAO + Claw

ElizaOS-based agent project that combines:

- **ElizaOS runtime** (`@elizaos/core` + `@elizaos/plugin-sql`) for long-running agents
- **Moltbook** social integration (agent identity + posting APIs)
- **x402-style paywalls** (HTTP `402 Payment Required` flow for agent endpoints)
- **Polymarket public signals** (Gamma API market scanning + ranking)
- **OpenClaw** integration is planned (docs/config will be added; not claimed yet)

## Quick start

```bash
git clone --recurse-submodules https://github.com/elizabaoxyz/elizabao-claw.git
cd elizabao-claw
bun install
cp .env.example .env
bun run dev
```

Open:
- `GET /` for service info
- `GET /x402/pricing` for current pricing (USD → lamports)
- `GET /signals/daily` for a 402-gated endpoint (returns 402 unless `X402_DEV_BYPASS=true`)
- `GET /signals/polymarket/top?limit=10` for ranked Polymarket signals (bypass mode by default)

## Polymarket agent (lalalune) included

This repo includes the full `lalalune/polymarket-agent` codebase as a submodule at:

- `vendor/lalalune-polymarket-agent`

It’s a separate CLI demo agent specialized for Polymarket (requires its own env keys).

To run it locally:

```bash
cd vendor/lalalune-polymarket-agent
bun install
bun run start
```

We keep it as a separate component and integrate at the **demo layer** (signals endpoint + paywall + social posting),
so this repo can stay open-source without bundling any private trading keys.

## What is x402 (and what we implement here)?

**x402** is an agent-friendly pattern for **paying for API calls** using the standard HTTP status
code **`402 Payment Required`**. In production, x402 systems typically include a facilitator,
pricing, and payment proofs so agents can pay automatically.

In this repo, we implement a **minimal x402-style flow**:
- Endpoint returns **402** unless payment is provided
- Payment is supplied via header `X-Payment-Tx: <solana signature>`
- Server verifies a **SOL transfer** to `X402_TREASURY_ADDRESS`

This is intentionally small for a hackathon demo and can be extended to SPL/USDC and a fuller x402 facilitator flow.

## Moltbook runner

```bash
bun run agent:moltbook
```

### Moltbook note (anti-spam moderation)

Moltbook requires verification challenges for new content and has strict anti-duplicate rules for new agents.
Avoid reposting identical text; use the `*-verified` scripts to post and verify immediately.

## Post to Moltbook (manual, immediate)

```bash
bun run moltbook:post "Hello Moltbook" "I’m ElizaBAO+Claw. Building ElizaOS × Moltbook × x402 on Solana."
```

## Post to Moltbook (auto-verify)

```bash
bun run moltbook:post-verified "Hello Moltbook" "Building ElizaOS × Moltbook × x402 on Solana."
```

## Update Moltbook bio (API)

Moltbook supports updating your profile with:
`PATCH https://www.moltbook.com/api/v1/agents/me` (see `https://www.moltbook.com/skill.md`).

Run:

```bash
bun run moltbook:update-profile
```

Or set a custom description:

```bash
bun run moltbook:update-profile "ElizaOS × Moltbook × x402 — prediction market automation on Solana."
```

Set in `.env`:
- `MOLTBOOK_API_KEY` (optional)
- `MOLTBOOK_AUTO_REGISTER=true`
- `MOLTBOOK_AUTO_ENGAGE=false` (set true once you’re ready)

## Notes

This repo is intentionally minimal and judge-friendly. Next steps are:
- add OpenClaw config example + adapter wiring
- extend x402 flow (SPL/USDC, facilitator-compatible receipts)
- improve Polymarket signal explanations and add more endpoints

