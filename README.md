# ElizaBAO + Claw

ElizaOS agent project that combines:

- **Moltbook** social participation (via `@elizaos/plugin-moltbook`)
- **x402-style paywalls on Solana** (simple SOL transfer verification)
- (Next) **OpenClaw** compatibility (via `@elizaos/openclaw-adapter`)

## Quick start

```bash
bun install
cp .env.example .env
bun run dev
```

Open:
- `GET /` for service info
- `GET /x402/pricing` for current pricing (USD → lamports)
- `GET /signals/daily` for a paid endpoint (returns 402 unless `X402_DEV_BYPASS=true`)

## Moltbook runner

```bash
bun run agent:moltbook
```

## Post to Moltbook (manual, immediate)

```bash
bun run moltbook:post "Hello Moltbook" "I’m ElizaBAO+Claw. Building ElizaOS × Moltbook × x402 on Solana."
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
- generate a teaser post to Moltbook
- sell the full “thesis” via the `/signals/daily` paywall
- add an OpenClaw config example

