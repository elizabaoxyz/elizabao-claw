import "dotenv/config";
import { AgentRuntime, createCharacter } from "@elizaos/core";
import sqlPlugin from "@elizaos/plugin-sql";
// NOTE: The npm package for @elizaos/plugin-moltbook is currently missing dist JS in the published build.
// To keep this repo runnable, we vendor the plugin source under vendor/plugin-moltbook.
import { moltbookPlugin } from "../vendor/plugin-moltbook/typescript/src/index.js";
import { getMoltbookDescription } from "./profile-text.js";

/**
 * Minimal Moltbook runner.
 *
 * Goal: prove Moltbook works with ElizaOS in this repo.
 * We keep it simple: initialize a runtime with the Moltbook plugin and stay alive.
 *
 * Next iteration: add an action that (a) generates a teaser post, (b) links to /signals/daily paywall.
 */
async function main(): Promise<void> {
  // Ensure embedded DB has a predictable location (or in-memory for quick tests).
  // This satisfies core's DB requirement via plugin-sql.
  process.env.PGLITE_DATA_DIR = process.env.PGLITE_DATA_DIR || "memory://";

  const character = createCharacter({
    name: "ElizaBAO+Claw",
    username: "elizabao_claw",
    bio: [
      "ElizaOS agent + Moltbook bot building open tooling for prediction markets.",
      "I share market observations, experiments, and integrations (ElizaOS × Moltbook × x402-style SOL payments).",
    ],
    adjectives: ["direct", "data-driven", "helpful"],
    secrets: {},
    settings: {
      MOLTBOOK_API_KEY: process.env.MOLTBOOK_API_KEY,
      MOLTBOOK_AUTO_REGISTER: process.env.MOLTBOOK_AUTO_REGISTER ?? "true",
      MOLTBOOK_AUTO_ENGAGE: process.env.MOLTBOOK_AUTO_ENGAGE ?? "false",
      MOLTBOOK_MIN_QUALITY_SCORE: process.env.MOLTBOOK_MIN_QUALITY_SCORE ?? "7",
    },
  });
  // (Informational) Ensure our intended Moltbook profile description is easy to locate in logs.
  // eslint-disable-next-line no-console
  console.log("ℹ️ Intended Moltbook description:", getMoltbookDescription());

  const runtime = new AgentRuntime({
    character,
    plugins: [sqlPlugin, moltbookPlugin],
    logLevel: "info",
    enableAutonomy: true,
    actionPlanning: false,
    checkShouldRespond: false,
  });

  await runtime.initialize();

  // eslint-disable-next-line no-console
  console.log("✅ Moltbook runtime initialized.");
  // eslint-disable-next-line no-console
  console.log("ℹ️ If MOLTBOOK_AUTO_ENGAGE=true, the plugin may start periodic engagement.");

  // Keep process alive
  setInterval(() => {}, 60_000);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", e?.message || String(e));
  process.exit(1);
});

