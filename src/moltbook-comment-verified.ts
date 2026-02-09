import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  MOLTBOOK_API_KEY: z.string().min(1, "MOLTBOOK_API_KEY is required"),
});

function usage(): never {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  bun run moltbook:comment-verified <postId> "<content>" [parentCommentId]

This posts a comment and (if Moltbook returns a verification challenge) auto-solves it
and calls POST /api/v1/verify immediately.
`);
  process.exit(1);
}

function normalizeTokens(s: string): string[] {
  const cleaned = s
    .replace(/[^A-Za-z\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  const raw = cleaned.split(" ");

  // Step 1: Re-join sequences like "t w o" -> "two"
  const joinedSingles: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].length === 1) {
      let j = i;
      let word = "";
      while (j < raw.length && raw[j].length === 1) {
        word += raw[j];
        j++;
      }
      joinedSingles.push(word);
      i = j - 1;
    } else {
      joinedSingles.push(raw[i]);
    }
  }

  // Step 2: Fix split tens words like "twen ty" -> "twenty"
  const tensFix: Record<string, string> = {
    twen: "twenty",
    thir: "thirty",
    for: "forty",
    fou: "fourty", // common misspelling; will be handled below
    fif: "fifty",
    six: "sixty",
    seven: "seventy",
    eigh: "eighty",
    nine: "ninety",
  };

  const out: string[] = [];
  for (let i = 0; i < joinedSingles.length; i++) {
    const a = joinedSingles[i];
    const b = joinedSingles[i + 1];
    if (b === "ty" && tensFix[a]) {
      const merged = tensFix[a] === "fourty" ? "forty" : tensFix[a];
      out.push(merged);
      i++; // consume next
      continue;
    }
    out.push(a);
  }

  return out;
}

function parseNumberWords(tokens: string[]): number[] {
  const ones: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
  };
  const teens: Record<string, number> = {
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
  };
  const tens: Record<string, number> = {
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  };

  const nums: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (teens[t] !== undefined) {
      nums.push(teens[t]);
      continue;
    }
    if (tens[t] !== undefined) {
      const base = tens[t];
      const next = tokens[i + 1];
      if (next && ones[next] !== undefined) {
        nums.push(base + ones[next]);
        i++;
      } else {
        nums.push(base);
      }
      continue;
    }
    if (ones[t] !== undefined) {
      const next = tokens[i + 1];
      if (next === "teen") {
        nums.push(10 + ones[t]);
        i++;
      } else {
        nums.push(ones[t]);
      }
      continue;
    }
    if (/^\d+$/.test(t)) nums.push(Number(t));
  }
  return nums;
}

function solveChallenge(challenge: string): string {
  const tokens = normalizeTokens(challenge);
  const nums = parseNumberWords(tokens);
  if (nums.length < 2) throw new Error("Could not parse numbers from challenge");

  const text = tokens.join(" ");
  const isAdd =
    text.includes("total") || text.includes("sum") || text.includes("together") || text.includes("in total");
  const isSub =
    text.includes("reduce") ||
    text.includes("reduced") ||
    text.includes("reduces") ||
    text.includes("remaining") ||
    text.includes("remains") ||
    text.includes("difference") ||
    text.includes("minus");

  let result = nums[0] + nums[1];
  if (isSub && !isAdd) result = nums[0] - nums[1];

  return result.toFixed(2);
}

function normalizeVerifyEndpoint(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "/api/v1/verify";
  // Often returned as "POST /api/v1/verify"
  const parts = s.split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  if (last.startsWith("/")) return last;
  if (last.startsWith("http")) return last;
  if (s.startsWith("/")) return s;
  if (s.startsWith("http")) return s;
  return "/api/v1/verify";
}

async function main(): Promise<void> {
  const { MOLTBOOK_API_KEY } = Env.parse(process.env);

  const postId = String(process.argv[2] || "").trim();
  const content = String(process.argv[3] || "").trim();
  const parentId = String(process.argv[4] || "").trim();
  if (!postId || !content) usage();

  const body: any = { content };
  if (parentId) body.parent_id = parentId;

  const cResp = await fetch(`https://www.moltbook.com/api/v1/posts/${encodeURIComponent(postId)}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MOLTBOOK_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const cText = await cResp.text().catch(() => "");
  const cData = cText ? JSON.parse(cText) : null;

  if (!cResp.ok) {
    // eslint-disable-next-line no-console
    console.error("❌ Comment failed:", cResp.status, cResp.statusText);
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(cData, null, 2));
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log("✅ Comment created (may require verification).");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(cData, null, 2));

  const verificationRequired = Boolean(cData?.verification_required);
  const code = String(cData?.verification?.code || "").trim();
  const challenge = String(cData?.verification?.challenge || "").trim();
  const verifyEndpoint = normalizeVerifyEndpoint(cData?.verification?.verify_endpoint);

  if (!verificationRequired || !code || !challenge) {
    // eslint-disable-next-line no-console
    console.log("ℹ️ No verification required (or missing challenge). Done.");
    return;
  }

  const answer = solveChallenge(challenge);
  // eslint-disable-next-line no-console
  console.log("🧮 Auto-solved verification answer:", answer);

  const verifyUrl = verifyEndpoint.startsWith("http") ? verifyEndpoint : `https://www.moltbook.com${verifyEndpoint}`;

  const vResp = await fetch(verifyUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MOLTBOOK_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ verification_code: code, answer }),
  });

  const vText = await vResp.text().catch(() => "");
  let vData: any = null;
  try {
    vData = vText ? JSON.parse(vText) : null;
  } catch {
    vData = { raw: vText };
  }

  if (!vResp.ok) {
    // eslint-disable-next-line no-console
    console.error("❌ Verify failed:", vResp.status, vResp.statusText);
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(vData, null, 2));
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log("✅ Verified. Your comment should be published now.");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(vData, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", e?.message || String(e));
  process.exit(1);
});

