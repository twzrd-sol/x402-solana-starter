import { describe, expect, it } from "vitest";
import { getBase58Decoder } from "@solana/kit";
import {
  signerFromKeypairJson,
  describeUnexpectedFirstStatus,
  parseArgs,
} from "../scripts/pay_v2_solana.mts";

// A fixed, known-good 64-byte solana-keygen-style secret key (private key
// half + public key half concatenated), generated once and verified to
// derive address 9rcNJADJPsqskszYGeHtyaF2dVwMEQTczBg8xgKwpA9v via both
// createKeyPairSignerFromBytes (64-byte form) and
// createKeyPairSignerFromPrivateKeyBytes (32-byte seed form) before being
// hardcoded here, so tests are deterministic instead of depending on the
// crypto RNG each run - and so this fixture is provably a real, valid
// keypair rather than arbitrary-looking bytes.
const SECRET_KEY_64 = new Uint8Array([
  146, 188, 84, 19, 150, 155, 115, 54, 113, 219, 46, 65, 133, 228, 49, 226, 57,
  76, 65, 49, 202, 54, 112, 109, 13, 240, 175, 186, 44, 75, 100, 24, 131, 146,
  241, 225, 38, 37, 71, 9, 96, 24, 53, 171, 228, 226, 11, 88, 222, 18, 36, 205,
  158, 85, 82, 237, 97, 9, 156, 59, 64, 10, 30, 129,
]);
const SEED_32 = SECRET_KEY_64.slice(0, 32);
const EXPECTED_ADDRESS = "9rcNJADJPsqskszYGeHtyaF2dVwMEQTczBg8xgKwpA9v";

describe("signerFromKeypairJson", () => {
  it("derives the correct address from a 64-byte JSON array (solana-keygen format)", async () => {
    const signer = await signerFromKeypairJson(Array.from(SECRET_KEY_64));
    expect(signer.address).toBe(EXPECTED_ADDRESS);
  });

  it("derives the correct address from a base58 privateKey field containing a 32-byte seed", async () => {
    const base58 = getBase58Decoder().decode(SEED_32);
    const signer = await signerFromKeypairJson({ privateKey: base58 });
    expect(signer.address).toBe(EXPECTED_ADDRESS);
  });

  it("derives the correct address from a base58 privateKey field containing a 64-byte secret key", async () => {
    const base58 = getBase58Decoder().decode(SECRET_KEY_64);
    const signer = await signerFromKeypairJson({ privateKey: base58 });
    expect(signer.address).toBe(EXPECTED_ADDRESS);
  });

  it("the 32-byte seed and 64-byte secret key for the SAME key derive the SAME address", async () => {
    const fromSeed = await signerFromKeypairJson({
      privateKey: getBase58Decoder().decode(SEED_32),
    });
    const fromFullKey = await signerFromKeypairJson({
      privateKey: getBase58Decoder().decode(SECRET_KEY_64),
    });
    expect(fromSeed.address).toBe(fromFullKey.address);
    expect(fromSeed.address).toBe(EXPECTED_ADDRESS);
  });

  it("rejects a base58 privateKey of an invalid length", async () => {
    const tooShort = getBase58Decoder().decode(new Uint8Array(16));
    await expect(signerFromKeypairJson({ privateKey: tooShort })).rejects.toThrow(
      /unsupported privateKey length/,
    );
  });

  it("rejects an unrecognized keypair shape", async () => {
    await expect(signerFromKeypairJson({ foo: "bar" })).rejects.toThrow(
      /unsupported keypair format/,
    );
    await expect(signerFromKeypairJson("not even an object")).rejects.toThrow(
      /unsupported keypair format/,
    );
  });

  it("a zero-padded 32-byte seed (the old, fixed bug) fails public-key validation", async () => {
    // Regression test for the exact bug this script used to have: treating
    // a 32-byte seed as if it were already a 64-byte secret key by padding
    // with zeros, instead of properly deriving the keypair. This is NOT
    // the code path under test (signerFromKeypairJson no longer does this)
    // - it's here to pin down and document the failure mode so it's
    // provable rather than asserted from memory.
    const { createKeyPairSignerFromBytes } = await import("@solana/kit");
    const zeroPadded = new Uint8Array([...SEED_32, ...new Uint8Array(32)]);
    await expect(createKeyPairSignerFromBytes(zeroPadded)).rejects.toThrow(
      /private key does not match/i,
    );
  });
});

describe("describeUnexpectedFirstStatus", () => {
  it("returns null for 402 (the expected, successful case)", () => {
    expect(describeUnexpectedFirstStatus(402)).toBeNull();
  });

  it("fails an unpaid 200 with a message calling out the free-serve risk", () => {
    const msg = describeUnexpectedFirstStatus(200);
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/200/);
    expect(msg).toMatch(/free|cach/i);
  });

  it("fails any other unexpected status with a generic message", () => {
    const msg = describeUnexpectedFirstStatus(500);
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/500/);
  });
});

describe("parseArgs", () => {
  it("parses --url and --keypair", () => {
    const args = parseArgs(["--url", "https://example.com/report", "--keypair", "/tmp/k.json"]);
    expect(args).toEqual({ url: "https://example.com/report", keypair: "/tmp/k.json" });
  });

  it("returns null when a required flag is missing", () => {
    expect(parseArgs(["--url", "https://example.com/report"])).toBeNull();
    expect(parseArgs([])).toBeNull();
  });
});
