import { describe, expect, it } from "vitest";
import app from "../src/index.js";
import { NETWORK } from "../src/x402guard.js";
import { fakeEnv } from "./fakeEnv.js";
import { json } from "./json.js";

describe("free routes", () => {
  it("GET /health is 200, even with no payTo configured", async () => {
    const res = await app.request("/health", {}, fakeEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.status).toBe("ok");
    expect(body.network).toBe(NETWORK);
    expect(body.payToConfigured).toBe(false);
    expect(body.settleGuard).toBe("twzrd-merchant-card");
  });

  it("GET / returns the v2 discovery catalog, unauthenticated", async () => {
    const res = await app.request("https://example.workers.dev/", {}, fakeEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.x402Version).toBe(2);
    expect(body.network).toBe(NETWORK);
    expect(body.resources).toHaveLength(1);
    expect(new URL(body.resources[0].resource).pathname).toBe("/report");
    expect(body.facilitator).toContain("intel.twzrd.xyz");
  });

  it("catalog advertises the v2 price shape even without a configured payTo", async () => {
    const res = await app.request("https://example.workers.dev/", {}, fakeEnv());
    const body = await json(res);
    const accepts = body.resources[0].accepts[0];
    expect(accepts.amount).toBe("10000"); // $0.01 * 1e6
    expect(accepts.network).toBe(NETWORK);
    expect(accepts.payTo).toBeNull();
    expect(accepts).not.toHaveProperty("maxAmountRequired");
    expect(accepts.extra?.feePayer).toBeTruthy();
  });

  it("GET /.well-known/x402 mirrors the same catalog", async () => {
    const res = await app.request(
      "https://example.workers.dev/.well-known/x402",
      {},
      fakeEnv(),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.resources[0].resource).toContain("/report");
  });

  it("GET /openapi.json describes the paid route", async () => {
    const res = await app.request("/openapi.json", {}, fakeEnv());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.paths["/report"]).toBeDefined();
  });
});
