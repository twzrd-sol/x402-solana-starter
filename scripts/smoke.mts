/**
 * Proves this v2 Solana storefront can issue a real mainnet 402 before deploy.
 *
 * Boots the Worker app in-process and asserts:
 *   1. free routes serve 200
 *   2. unpaid paid route returns 402 with v2 PAYMENT-REQUIRED header
 *   3. challenge is Solana **mainnet CAIP-2** (not short "solana", not devnet)
 *   4. facilitator supplies a feePayer (gas sponsor)
 *   5. unset X402_PAY_TO → 503 payments_not_configured (never misroute money)
 *
 * Run:
 *   npm run smoke
 *   X402_FACILITATOR_URL=... npm run smoke
 *   npm run smoke:contrast   # TWZRD must pass; x402.org must fail for mainnet Solana
 */
import { decodePaymentRequiredHeader } from "@x402/core/http";
import app from "../src/index.js";
import { NETWORK, TWZRD_FEE_PAYER } from "../src/x402guard.js";

const FACILITATOR = process.env.X402_FACILITATOR_URL || "https://intel.twzrd.xyz";
const REAL_WALLET =
  process.env.X402_PAY_TO || "GFpLvocNdEjnSsLH3VJQL6wGcjGxTbUBrj6fqN3Qe1Gs";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const env = {
  X402_PAY_TO: REAL_WALLET,
  X402_FACILITATOR_URL: FACILITATOR,
  TWZRD_INTEL_BASE: process.env.TWZRD_INTEL_BASE || "https://intel.twzrd.xyz",
};

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
}

const call = (path: string, e: Record<string, string> = env) =>
  app.fetch(new Request(`https://example.test${path}`), e as never);

console.log(`x402-solana-starter smoke  (facilitator=${FACILITATOR})`);
console.log(`  network=${NETWORK}  payTo=${REAL_WALLET}`);

// 1. free routes
const health = await call("/health");
check("GET /health → 200", health.status === 200, `got ${health.status}`);

const root = await call("/");
check("GET / (catalog) → 200", root.status === 200, `got ${root.status}`);

// 2. paid route: 402 + v2 header challenge
let paidStatus = 0;
let challenge: any = null;
try {
  const paid = await call("/report");
  paidStatus = paid.status;
  check("GET /report unpaid → 402", paid.status === 402, `got ${paid.status}`);

  if (paid.status === 402) {
    const bodyText = await paid.text();
    let bodyOk = false;
    try {
      const parsed = JSON.parse(bodyText);
      bodyOk =
        parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 0;
    } catch {
      bodyOk = false;
    }
    check("v2 body is empty object {}", bodyOk, bodyText.slice(0, 80));

    const header = paid.headers.get("PAYMENT-REQUIRED");
    check("PAYMENT-REQUIRED header present", Boolean(header), header ? "yes" : "missing");
    if (header) {
      challenge = decodePaymentRequiredHeader(header);
    }
  }
} catch (err: any) {
  // @x402/hono throws RouteConfigurationError when facilitator has no kind
  // for this network (stock x402.org path). Surface as failed 402.
  const msg = String(err?.message || err);
  check("GET /report unpaid → 402", false, `threw: ${msg.slice(0, 160)}`);
}

if (challenge) {
  const accepts = challenge.accepts?.[0];
  const network = String(accepts?.network || "");
  check(
    "challenge is x402 v2",
    challenge.x402Version === 2,
    `x402Version=${challenge.x402Version}`,
  );
  check(
    "challenge network is Solana mainnet CAIP-2",
    accepts?.scheme === "exact" && network === NETWORK,
    JSON.stringify({ scheme: accepts?.scheme, network }),
  );
  check(
    "payTo is the operator wallet",
    accepts?.payTo === REAL_WALLET,
    String(accepts?.payTo),
  );
  check(
    "amount is 10000 micro-USDC ($0.01)",
    String(accepts?.amount) === "10000",
    String(accepts?.amount),
  );
  const feePayer = accepts?.extra?.feePayer;
  check(
    "facilitator supplied gas sponsor (feePayer)",
    Boolean(feePayer) && BASE58.test(String(feePayer)),
    feePayer
      ? `feePayer=${feePayer}${feePayer === TWZRD_FEE_PAYER ? " (TWZRD)" : ""}`
      : "MISSING — facilitator /supported has no Solana mainnet kind",
  );
} else {
  check("challenge is x402 v2", false, "no challenge to inspect");
  check("challenge network is Solana mainnet CAIP-2", false, "no challenge");
  check("payTo is the operator wallet", false, "no challenge");
  check("amount is 10000 micro-USDC ($0.01)", false, "no challenge");
  check("facilitator supplied gas sponsor (feePayer)", false, "no challenge");
}

// 3. unconfigured deploy must refuse, not sell
const unset = await call("/report", { ...env, X402_PAY_TO: "" });
check(
  "unset X402_PAY_TO → 503 payments_not_configured",
  unset.status === 503,
  `got ${unset.status}`,
);

console.log(failures === 0 ? "\nOK - template sells (v2 Solana mainnet)." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
