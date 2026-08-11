/**
 * Proves the template actually sells something before anyone deploys it.
 *
 * Ported from x402-seller-starter's smoke.mts (x402-hono v1 shape: 402
 * challenge in the JSON body, bare "solana" network string) to this repo's
 * actual protocol: x402 v2 — challenge in the PAYMENT-REQUIRED response
 * header, network as full CAIP-2 ("solana:5eykt4Uv..."), route is /report
 * (not /paid/hello), env vars are X402_PAY_TO / X402_FACILITATOR_URL
 * (not PAY_TO / FACILITATOR_URL).
 *
 * Boots the Worker in-process and asserts the three things a one-click deploy
 * can get wrong in ways the deployer would not notice:
 *   1. the paid route really returns a 402 (not a 500, not a free 200)
 *   2. the challenge carries a *sponsored* Solana **mainnet** requirement
 *      (CAIP-2 mainnet genesis hash, not devnet/testnet)
 *   3. an unset X402_PAY_TO is refused loudly, so a fresh deploy can never
 *      route a stranger's money to nowhere
 *
 * Run: npm run smoke        (uses the live TWZRD facilitator by default)
 *      X402_FACILITATOR_URL=... npm run smoke
 *      npm run smoke:contrast   (TWZRD must pass; x402.org/facilitator must fail)
 */
import app from "../src/index.js";
import { NETWORK } from "../src/x402guard.js";

const FACILITATOR = process.env.X402_FACILITATOR_URL || "https://intel.twzrd.xyz";
const REAL_WALLET =
  process.env.X402_PAY_TO || "GFpLvocNdEjnSsLH3VJQL6wGcjGxTbUBrj6fqN3Qe1Gs";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const env = {
  X402_PAY_TO: REAL_WALLET,
  X402_FACILITATOR_URL: FACILITATOR,
};

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
}

const call = (path: string, e: Record<string, string> = env) =>
  app.fetch(new Request(`https://example.test${path}`), e as never);

console.log(`x402 solana starter smoke  (facilitator=${FACILITATOR})`);

// 1. free route (catalog)
const root = await call("/");
check("free route serves 200", root.status === 200, `got ${root.status}`);

// 2. paid route must 402, with the challenge in the PAYMENT-REQUIRED header
let paidStatus = 0;
let paidBody: any = null;
try {
  const paid = await call("/report");
  paidStatus = paid.status;
  if (paid.status === 402) {
    const header = paid.headers.get("payment-required");
    paidBody = header ? JSON.parse(Buffer.from(header, "base64").toString("utf8")) : null;
  }
  check("paid route returns 402", paid.status === 402, `got ${paid.status}`);
} catch (err: any) {
  const msg = String(err?.message || err);
  check("paid route returns 402", false, `threw: ${msg.slice(0, 120)}`);
}

if (paidStatus === 402 && paidBody) {
  const accepts = paidBody?.accepts?.[0];
  const network = String(accepts?.network || "");
  // Mainnet wedge: full CAIP-2 mainnet genesis hash is what @x402/svm +
  // this repo's indexer-facing challenges require. Devnet/testnet CAIP-2 or
  // the bare v1 "solana" short name are NOT this network.
  check(
    "challenge network is Solana mainnet (CAIP-2)",
    accepts?.scheme === "exact" && network === NETWORK,
    JSON.stringify({ scheme: accepts?.scheme, network }),
  );
  check("payTo is the operator's wallet", accepts?.payTo === REAL_WALLET, String(accepts?.payTo));
  const feePayer = accepts?.extra?.feePayer;
  check(
    "facilitator supplied a gas sponsor (feePayer)",
    Boolean(feePayer) && BASE58.test(String(feePayer)),
    feePayer ? `feePayer=${feePayer}` : "MISSING - facilitator did not answer /supported for solana mainnet",
  );
} else {
  check("challenge network is Solana mainnet (CAIP-2)", false, "no 402 to inspect");
  check("payTo is the operator's wallet", false, "no 402 to inspect");
  check("facilitator supplied a gas sponsor (feePayer)", false, "no 402 to inspect");
}

// 3. an unconfigured deploy must refuse, not misroute money
const unset = await call("/report", { ...env, X402_PAY_TO: "YourSolanaPubkeyHere" });
check("placeholder X402_PAY_TO is refused", unset.status === 503, `got ${unset.status}`);

console.log(failures === 0 ? "\nOK - template sells." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
