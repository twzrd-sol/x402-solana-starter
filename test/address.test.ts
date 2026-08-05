import { describe, expect, it } from "vitest";
import { isSolanaAddress, normalizePayTo } from "../src/address.js";

describe("isSolanaAddress", () => {
  it("accepts base58 pubkeys of valid length", () => {
    expect(isSolanaAddress("4LkEFjJdXARkKx8FBx4LBFa2SvJNmjQpgGDLoJcypZUE")).toBe(true);
    expect(isSolanaAddress("11111111111111111111111111111112")).toBe(true);
  });

  it("trims whitespace", () => {
    expect(isSolanaAddress("  4LkEFjJdXARkKx8FBx4LBFa2SvJNmjQpgGDLoJcypZUE\n")).toBe(true);
  });

  it("rejects EVM and empty values", () => {
    expect(isSolanaAddress("0x" + "11".repeat(20))).toBe(false);
    expect(isSolanaAddress("")).toBe(false);
    expect(isSolanaAddress(undefined)).toBe(false);
    expect(isSolanaAddress("not valid!!")).toBe(false);
  });
});

describe("normalizePayTo", () => {
  it("returns trimmed address or null", () => {
    expect(normalizePayTo("  4LkEFjJdXARkKx8FBx4LBFa2SvJNmjQpgGDLoJcypZUE  ")).toBe(
      "4LkEFjJdXARkKx8FBx4LBFa2SvJNmjQpgGDLoJcypZUE",
    );
    expect(normalizePayTo("0xabc")).toBeNull();
  });
});
