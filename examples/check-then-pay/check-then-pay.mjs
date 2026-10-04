#!/usr/bin/env node
// check-then-pay: free TWZRD check before signing, one x402 payment on Solana, chain read after.
//
//   node check-then-pay.mjs --url <resource> --pay-to <expected payTo> [--max-usdc 0.01] [--dry-run]
//
// Stack: official @x402/core client + @x402/svm ExactSvmScheme, wrapped by
// twzrd-x402-gate's createGuardedX402Fetch (local recipient + per-call cap,
// then the TWZRD pre-sign hook). --dry-run registers one more hook after the
// TWZRD hook that aborts with reason "dry_run": the 402 is fetched, the
// requirement selected, the TWZRD decision produced, and nothing is signed.
// The real run needs SVM_KEYPAIR_PATH (64-byte JSON array, or {privateKey}
// base58 of a 32-byte seed / 64-byte secret). Optional SVM_RPC_URL.
// Nothing here prints key material; only the signer address.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createGuardedX402Fetch } from "twzrd-x402-gate";
import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  generateKeyPairSigner,
  getBase58Codec,
} from "@solana/kit";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--dry-run") args.dryRun = true;
  else if (a.startsWith("--")) args[a.slice(2)] = process.argv[++i];
}
if (!args.url || !args["pay-to"]) {
  console.error("usage: check-then-pay.mjs --url <resource> --pay-to <payTo> [--max-usdc 0.01] [--dry-run]");
  process.exit(2);
}
const MAX_USDC = args["max-usdc"] ?? "0.01";
const RPC_URL = process.env.SVM_RPC_URL || "https://api.mainnet-beta.solana.com";
const RUN_ID = `check-then-pay-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const OUT_DIR = process.env.RECORD_DIR || "./records";
const sha256 = (buf) => "sha256:" + createHash("sha256").update(buf).digest("hex");

async function loadSigner() {
  if (args.dryRun && !process.env.SVM_KEYPAIR_PATH) {
    return { signer: await generateKeyPairSigner(), source: "ephemeral (dry run, unfunded, never written)" };
  }
  const path = process.env.SVM_KEYPAIR_PATH;
  if (!path) throw new Error("SVM_KEYPAIR_PATH is required for a funded run");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(raw)) return { signer: await createKeyPairSignerFromBytes(new Uint8Array(raw)), source: path };
  if (raw && typeof raw.privateKey === "string") {
    const bytes = getBase58Codec().encode(raw.privateKey);
    const signer = bytes.length === 64
      ? await createKeyPairSignerFromBytes(bytes)
      : await createKeyPairSignerFromPrivateKeyBytes(bytes);
    return { signer, source: path };
  }
  throw new Error("unrecognized keypair file shape");
}

const record = {
  run_id: RUN_ID,
  started_at: new Date().toISOString(),
  mode: args.dryRun ? "dry_run" : "funded",
  resource_url: args.url,
  expected_pay_to: args["pay-to"],
  max_usdc_per_call: String(MAX_USDC),
  stack: { x402_core: "2.28", x402_svm: "2.28", twzrd_x402_gate: "0.11.4" },
  twzrd_decisions: [],
  before: null,
  payment: null,
  after: null,
  outcome: null,
};

const { signer, source } = await loadSigner();
record.payer = { address: signer.address, key_source: source.startsWith("ephemeral") ? source : "operator keypair file (path not recorded)" };

const client = new x402Client();
client.register("solana:*", new ExactSvmScheme(signer, { rpcUrl: RPC_URL }));

const payingFetch = createGuardedX402Fetch({
  client,
  fetch: globalThis.fetch,
  maxPricePerCall: MAX_USDC,
  allowedRecipients: [args["pay-to"]],
  twzrd: {
    gateOnCanSpend: true,
    refuseWashFlagged: true,
    ...(args["intel-timeout-ms"] ? { intelTimeoutMs: Number(args["intel-timeout-ms"]) } : {}),
    attribution: { integration: "check-then-pay-recipe", runId: RUN_ID },
    onDecision: (detail) => {
      record.twzrd_decisions.push(detail);
      const d = detail ?? {};
      console.log("TWZRD decision:", JSON.stringify({
        verdict: d.verdict ?? d.decision, reason: d.reason, can_spend: d.canSpend ?? d.can_spend,
        wash_flagged: d.washFlagged ?? d.wash_flagged, price_usdc: d.priceUsdc ?? d.price_usdc, pay_to: d.payTo ?? d.pay_to,
      }));
    },
  },
});

// Capture the selected requirement; in a dry run, abort here, after TWZRD spoke.
client.onBeforePaymentCreation(async (ctx) => {
  const r = ctx.selectedRequirements;
  record.before = {
    x402_version: ctx.paymentRequired?.x402Version,
    accepts_count: ctx.paymentRequired?.accepts?.length,
    selected: { scheme: r.scheme, network: r.network, amount: r.amount ?? r.maxAmountRequired, payTo: r.payTo, asset: r.asset, feePayer: r.extra?.feePayer, maxTimeoutSeconds: r.maxTimeoutSeconds },
  };
  console.log("selected requirement:", JSON.stringify(record.before.selected));
  if (args.dryRun) return { abort: true, reason: "dry_run" };
});

let res, body;
try {
  res = await payingFetch(args.url, { headers: { "user-agent": "check-then-pay/0.1 (+https://twzrd.xyz)" } });
  body = Buffer.from(await res.arrayBuffer());
} catch (err) {
  record.outcome = { kind: args.dryRun ? "dry_run_aborted_before_signer" : "payment_failed", error: String(err?.message ?? err).slice(0, 300) };
  console.log("outcome:", JSON.stringify(record.outcome));
  finish();
  process.exit(args.dryRun ? 0 : 1);
}

record.payment = { http_status: res.status, body_sha256: sha256(body), body_bytes: body.length };
let settle = null;
try {
  settle = new x402HTTPClient(client).getPaymentSettleResponse((n) => res.headers.get(n));
} catch {
  // No PAYMENT-RESPONSE header: the wrapper returned without paying (a 402 passed through, or a refusal).
  record.payment.no_settle_header = true;
  record.payment.response_headers = Object.fromEntries([...res.headers.entries()].filter(([k]) => !/^(cf-|report-to|nel|alt-svc|set-cookie)/i.test(k)).map(([k, v]) => [k, v.slice(0, 200)]));
  record.payment.body_head = body.toString("utf8").slice(0, 400);
}
record.payment.settle_response = settle ?? null;
finish(); // persist now: USDC may have moved; the after-proof below must not be able to lose this
console.log("seller response:", res.status, record.payment.body_sha256, "settle:", JSON.stringify(settle ?? null));
if (!settle) console.log("no settle header; headers:", JSON.stringify(record.payment.response_headers ?? {}).slice(0, 600), "body:", (record.payment.body_head ?? "").slice(0, 300));

if (settle?.transaction) try {
  // AFTER: the chain itself (same digest rule as TWZRD's witness route), then TWZRD's hosted witness (ledger-gated).
  const after = { settlement_tx: settle.transaction, network: settle.network, payer: settle.payer ?? null, amount_atomic: settle.amount ?? null };
  for (let i = 0; i < 12; i++) {
    const rpc = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [settle.transaction, { encoding: "base64", commitment: "finalized", maxSupportedTransactionVersion: 0 }] }) });
    let j = {};
    try { j = await rpc.json(); } catch { j = { error: `rpc_http_${rpc.status}` }; }
    if (j.result) {
      const wire = Buffer.from(j.result.transaction[0], "base64");
      after.finalized = { slot: j.result.slot, block_time: j.result.blockTime, wire_sha256: sha256(wire), err: j.result.meta?.err ?? null,
        digest_over: "sha256 of the base64-decoded wire transaction from getTransaction(encoding=base64, commitment=finalized)" };
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!after.finalized) after.finalized = { error: "not_finalized_within_60s" };
  const w = await fetch(`https://intel.twzrd.xyz/v1/receipts/by-tx/${settle.transaction}/witness`);
  after.twzrd_hosted_witness = { http_status: w.status, body: (await w.text()).slice(0, 300) };
  record.after = after;
  console.log("after:", JSON.stringify(after));
} catch (err) {
  record.after = { ...(record.after ?? {}), settlement_tx: settle.transaction, error: String(err?.message ?? err).slice(0, 300) };
  console.log("after-proof error (payment record already saved):", record.after.error);
}
record.outcome = { kind: res.status === 200 && settle?.success !== false ? "paid_and_delivered_http_200" : `http_${res.status}` };
finish();

function finish() {
  record.finished_at = new Date().toISOString();
  mkdirSync(OUT_DIR, { recursive: true });
  const file = `${OUT_DIR}/${RUN_ID}.json`;
  writeFileSync(file, JSON.stringify(record, null, 2));
  console.log("record:", file);
}
