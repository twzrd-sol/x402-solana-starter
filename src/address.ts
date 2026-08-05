// Solana base58 pubkeys are 32–44 chars of the Bitcoin-style base58 alphabet
// (no 0, O, I, l). Length alone is a soft gate; full ed25519 decode is overkill
// for a deploy-time config check and would pull heavy deps into the Worker.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isSolanaAddress(value: string | undefined | null): value is string {
  return typeof value === "string" && SOLANA_ADDRESS_RE.test(value);
}
