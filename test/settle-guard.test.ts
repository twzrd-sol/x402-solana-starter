import { describe, expect, it, vi } from "vitest";
import { createTwzrdSettleGuard, extractPayer } from "../src/settle-guard.js";

describe("extractPayer", () => {
  it("reads authorization.from first", async () => {
    const p = await extractPayer({
      paymentPayload: {
        payload: { authorization: { from: "PayerAuth11111111111111111111111111" }, payer: "Alias" },
      },
    });
    expect(p).toBe("PayerAuth11111111111111111111111111");
  });

  it("falls back to payload.payer", async () => {
    const p = await extractPayer({
      paymentPayload: { payload: { payer: "PayerLoose11111111111111111111111" } },
    });
    expect(p).toBe("PayerLoose11111111111111111111111");
  });
});

describe("createTwzrdSettleGuard", () => {
  it("aborts on wash_flagged=true", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ wash_flagged: true }), { status: 200 }),
    ) as unknown as typeof fetch;
    const guard = createTwzrdSettleGuard({
      intelBase: "https://intel.twzrd.xyz",
      fetch: fetchImpl,
    });
    const r = await guard({
      paymentPayload: { payload: { payer: "WASH11111111111111111111111111111" } },
    });
    expect(r).toMatchObject({ abort: true, reason: "twzrd_payer_wash_flagged" });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("continues on clean card", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ wash_flagged: false }), { status: 200 }),
    ) as unknown as typeof fetch;
    const guard = createTwzrdSettleGuard({
      intelBase: "https://intel.twzrd.xyz",
      fetch: fetchImpl,
    });
    const r = await guard({
      paymentPayload: { payload: { payer: "CLEAN1111111111111111111111111111" } },
    });
    expect(r).toBeUndefined();
  });

  it("fails open when merchant_card is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const guard = createTwzrdSettleGuard({
      intelBase: "https://intel.twzrd.xyz",
      fetch: fetchImpl,
    });
    const r = await guard({
      paymentPayload: { payload: { payer: "ANY111111111111111111111111111111" } },
    });
    expect(r).toBeUndefined();
  });
});
