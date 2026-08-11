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
 * Keypair file:
 *   - JSON array of 64 bytes (standard solana-keygen output). A 32-byte
 *     array is NOT accepted this way - use the base58 privateKey form below.
 *   - JSON object with a base58 "privateKey" field (agentcash format),
 *     containing either a 32-byte seed or a 64-byte secret key.
 *   (The sibling Python payer, pay_v2_solana.py, only accepts the JSON
 *   array form - 64-byte keypair or 32-byte seed - not the privateKey
 *   object form. The two are not drop-in replacements for each other.)
 */
import { readFileSync } from "node:fs";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  getBase58Codec,
  type KeyPairSigner,
} from "@solana/kit";

export function parseArgs(argv: string[]): { url: string; keypair: string } | null {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (key) args[key] = argv[i + 1];
  }
  if (!args.url || !args.keypair) return null;
  return { url: args.url, keypair: args.keypair };
}

/**
 * Derives a signer from an already-parsed keypair JSON value. Pulled out of
 * loadSigner() so it can be unit-tested against fixture values directly,
 * without touching the filesystem.
 */
export async function signerFromKeypairJson(raw: unknown): Promise<KeyPairSigner> {
  if (Array.isArray(raw)) {
    return createKeyPairSignerFromBytes(new Uint8Array(raw));
  }
  if (raw && typeof raw === "object" && typeof (raw as { privateKey?: unknown }).privateKey === "string") {
    // agentcash format: base58-encoded 32-byte seed or 64-byte secret key.
    const decoded = getBase58Codec().encode((raw as { privateKey: string }).privateKey);
    if (decoded.length === 64) {
      return createKeyPairSignerFromBytes(decoded);
    }
    if (decoded.length === 32) {
      // A 32-byte value is a private-key seed, not a secret key with the
      // public key already appended. createKeyPairSignerFromPrivateKeyBytes
      // properly derives the full keypair (including the public key) from
      // it. The earlier version of this script zero-padded the seed to 64
      // bytes instead and passed that to createKeyPairSignerFromBytes -
      // verified precisely what that does: it produces an invalid combined
      // key (real private key + all-zero "public key" half) and
      // createKeyPairSignerFromBytes's own public-key validation rejects
      // it, throwing "the provided private key does not match the provided
      // public key." Not a vague failure mode - a specific, reproducible one.
      return createKeyPairSignerFromPrivateKeyBytes(decoded);
    }
    throw new Error(
      `unsupported privateKey length: ${decoded.length} bytes (expected 32 or 64)`,
    );
  }
  throw new Error("unsupported keypair format");
}

async function loadSigner(path: string): Promise<KeyPairSigner> {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  try {
    return await signerFromKeypairJson(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${path}: ${msg}`);
  }
}

/**
 * Decides what to do when the first (unpaid) request doesn't come back as
 * 402. Returns an error message to fail with, or null if execution should
 * continue (i.e. status really was 402 - callers only invoke this for the
 * non-402 case, but it's total for easy testing).
 *
 * A 200 here is NOT success - it means the paid route served for free,
 * which is either a real bug or (observed once, transiently, on this exact
 * starter) a stale Cloudflare edge cache serving an earlier successful
 * response to a fresh, unpaid request. Either way this script's job is to
 * prove a real 402->pay->settle round trip, not to shrug at a free
 * response - so 200 fails loudly here instead of exiting 0.
 */
export function describeUnexpectedFirstStatus(status: number): string | null {
  if (status === 402) return null;
  if (status === 200) {
    return (
      "FAILED: got 200 on an unpaid request - route served for free " +
      "(real bug, or a stale cached response - do not treat this as success)"
    );
  }
  return `FAILED: unexpected status ${status} on first request`;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    console.error("usage: pay_v2_solana.mts --url <resource-url> --keypair <path>");
    process.exit(2);
  }
  const { url, keypair: keypairPath } = parsed;
  const solana = await loadSigner(keypairPath);
  console.log(`payer address: ${solana.address}`);

  const client = new x402Client();
  registerExactSvmScheme(client, { signer: solana });
  const http = new x402HTTPClient(client);

  console.log(`GET ${url}`);
  const first = await fetch(url);
  console.log(`first response: ${first.status}`);

  const failure = describeUnexpectedFirstStatus(first.status);
  if (failure) {
    console.log(await first.text());
    console.error(failure);
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

// Only run the CLI when this file is executed directly (npx tsx ...), not
// when imported for its exported functions (e.g. from the test suite) -
// otherwise importing this module for testing would try to parse
// process.argv as CLI args and exit(2).
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
