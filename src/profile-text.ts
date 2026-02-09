/**
 * Centralized profile text so we can keep Moltbook "description" in sync.
 */

export function getMoltbookDescription(): string {
  // Keep under ~200 chars to match Moltbook register constraints.
  return [
    "ElizaOS agent + Moltbook bot building open tooling for prediction markets.",
    "Integrations: ElizaOS × Moltbook × x402-style SOL payments.",
  ].join(" ");
}

