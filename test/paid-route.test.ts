import { describe, expect, it } from "vitest";
import app from "../src/index.js";
import { NETWORK } from "../src/x402guard.js";
import { fakeEnv } from "./fakeEnv.js";
import { challenge, json } from "./json.js";

// Deterministic base58-looking test address — never used on-chain.
// Length 44, alphabet-safe. Not a real funded key.
const TEST_PAY_TO = "11111111111111111111111111111112";

describe("GET /report without X402_PAY_TO configured", () => {
  it("returns 503 payments_not_configured", async () => {
    const res = await app.request("/report", {}, fakeEnv());
    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe("payments_not_configured");
  });

  it("rejects an invalid payTo shape as unconfigured", async () => {
    const res = await app.request("/report", {}, fakeEnv({ X402_PAY_TO: "0xnotsolana" }));
    expect(res.status).toBe(503);
  });
});

describe("GET /report with X402_PAY_TO configured, no payment header", () => {
  const env = fakeEnv({ X402_PAY_TO: TEST_PAY_TO });

  it("returns a v2 402 challenge priced at $0.01 with the configured payTo", async () => {
    const res = await app.request("https://example.workers.dev/report", {}, env);
    expect(res.status).toBe(402);

    // v2: challenge in PAYMENT-REQUIRED header; body is `{}`.
    expect(await json(res)).toEqual({});

    const pr = challenge(res);
    expect(pr.x402Version).toBe(2);
    expect(pr.resource.url).toBe("https://example.workers.dev/report");
    expect(pr.resource.description).toMatch(/status report|x402/i);
    expect(pr.accepts).toHaveLength(1);

    const req = pr.accepts[0];
    expect(req.scheme).toBe("exact");
    expect(req.network).toBe(NETWORK);
    expect(req.amount).toBe("10000");
    expect(req).not.toHaveProperty("maxAmountRequired");
    expect(req.payTo).toBe(TEST_PAY_TO);
    expect(req.maxTimeoutSeconds).toBe(300);
    // Solana challenges must advertise a feePayer for gas-sponsored settles.
    expect(req.extra?.feePayer).toBeTruthy();
  });

  it("rejects a malformed payment header rather than serving the route for free", async () => {
    const res = await app.request(
      "https://example.workers.dev/report",
      { headers: { "PAYMENT-SIGNATURE": "not-a-real-payment-payload" } },
      env,
    );
    expect(res.status).toBe(402);
  });
});
