export interface Env {
  /** Seller's public Solana wallet (base58). Unset => paid route serves 503. Never hardcode. */
  X402_PAY_TO?: string;
  /** Documentation only — network is fixed in code. */
  X402_NETWORK?: string;
  /** x402 facilitator base URL. Default: TWZRD intel facilitator. */
  X402_FACILITATOR_URL?: string;
  /** Free TWZRD intel base for settle-guard payer screens. Default: https://intel.twzrd.xyz */
  TWZRD_INTEL_BASE?: string;
}
