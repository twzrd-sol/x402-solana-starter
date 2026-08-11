#!/usr/bin/env -S npx tsx
/**
 * Stranger-style Solana mainnet payer for x402 protocol v2 sellers.
 *
 * Ported from x402-seller-starter's pay_v1_solana.py (x402-hono v1 shape:
 * challenge in the JSON body, X-PAYMENT retry header) to this repo's actual
 * protocol: @x402/core v2 — challenge in the PAYMENT-REQUIRED response
 * header, retry via PAYMENT-SIGNATURE, network as full CAIP-2
 * ("solana:5eykt4Uv..."), not the bare "solana" v1 used.
 *
 * Uses the real @x402/core + @x402/svm client libraries rather than
 * hand-rolling the payload envelope, so this stays correct as the protocol
 * evolves instead of silently drifting from what the server actually expects.
 *
 * Usage:
 *   npx tsx scripts/pay_v2_solana.mts --url https://HOST/report --keypair /path/to.json
 *
 * Keypair file: JSON array of 64 bytes (standard solana-keygen output) or
 * a JSON object with a base58 "privateKey" field (agentcash format, 32-byte
 * seed or 64-byte secret key).
 */
import { readFileSync } from "node:fs";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  getBase58Codec,
} from "@solana/kit";

function parseArgs(argv: string[]): { url: string; keypair: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (key) args[key] = argv[i + 1];
  }
  if (!args.url || !args.keypair) {
    console.error("usage: pay_v2_solana.mts --url <resource-url> --keypair <path>");
    process.exit(2);
  }
  return { url: args.url, keypair: args.keypair };
}

async function loadSigner(path: string) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(raw)) {
    return createKeyPairSignerFromBytes(new Uint8Array(raw));
  }
  if (raw && typeof raw === "object" && typeof raw.privateKey === "string") {
    // agentcash format: base58-encoded 32-byte seed or 64-byte secret key.
    const decoded = getBase58Codec().encode(raw.privateKey);
    if (decoded.length === 64) {
      return createKeyPairSignerFromBytes(decoded);
    }
    if (decoded.length === 32) {
      // A 32-byte value is a private-key seed, not a secret key with the
      // public key already appended. createKeyPairSignerFromPrivateKeyBytes
      // properly derives the full keypair (including the public key) from
      // it. Zero-padding to 64 bytes instead (an earlier version of this
      // script did that) produces a garbage keypair — not the intended
      // identity, and not one that would even reliably fail loudly.
      return createKeyPairSignerFromPrivateKeyBytes(decoded);
    }
    throw new Error(
      `unsupported privateKey length: ${decoded.length} bytes (expected 32 or 64)`,
    );
  }
  throw new Error(`unsupported keypair format: ${path}`);
}

async function main() {
  const { url, keypair: keypairPath } = parseArgs(process.argv.slice(2));
  const solana = await loadSigner(keypairPath);
  console.log(`payer address: ${solana.address}`);

  const client = new x402Client();
  registerExactSvmScheme(client, { signer: solana });
  const http = new x402HTTPClient(client);

  console.log(`GET ${url}`);
  const first = await fetch(url);
  console.log(`first response: ${first.status}`);

  if (first.status !== 402) {
    console.log(await first.text());
    // A 200 here is NOT success - it means the paid route served for free,
    // which is either a real bug or (observed once, transiently, on this
    // exact starter) a stale Cloudflare edge cache serving an earlier
    // successful response to a fresh, unpaid request. Either way this
    // script's job is to prove a real 402->pay->settle round trip, not to
    // shrug at a free response. Fail loudly so it gets investigated instead
    // of silently recorded as a passing payer run.
    console.error(
      first.status === 200
        ? "FAILED: got 200 on an unpaid request - route served for free " +
            "(real bug, or a stale cached response - do not treat this as success)"
        : `FAILED: unexpected status ${first.status} on first request`,
    );
    process.exit(1);
  }

  const getHeader = (name: string) => first.headers.get(name);
  const body = await first.json().catch(() => ({}));
  const paymentRequired = http.getPaymentRequiredResponse(getHeader, body);
  console.log("challenge:", JSON.stringify(paymentRequired, null, 2));

  const paymentPayload = await http.createPaymentPayload(paymentRequired);
  const paymentHeaders = http.encodePaymentSignatureHeader(paymentPayload);

  console.log("retrying with payment header...");
  const second = await fetch(url, { headers: paymentHeaders });
  console.log(`second response: ${second.status}`);

  const result = await http.processPaymentResult(
    paymentPayload,
    (name) => second.headers.get(name),
    second.status,
  );
  console.log("settlement:", JSON.stringify(result, null, 2));

  const responseBody = await second.json().catch(() => null);
  console.log("body:", JSON.stringify(responseBody, null, 2));

  process.exit(second.status === 200 ? 0 : 1);
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
