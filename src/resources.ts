import type { RoutesConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";

/** The one thing this starter sells. Change price/path/description and ship. */
export const REPORT_ROUTE = {
  method: "GET" as const,
  path: "/report",
  price: "$0.01",
  description:
    "A tiny generated status report — the one paid route this starter ships with. USDC on Solana mainnet via x402.",
  mimeType: "application/json",
};

// Feeds @x402/hono's paymentMiddleware (x402 protocol v2). Single source of truth
// shared with the free catalog so a price edit here shows up in both.
export function buildRoutesConfig(network: Network, payTo: string): RoutesConfig {
  return {
    [`${REPORT_ROUTE.method} ${REPORT_ROUTE.path}`]: {
      description: REPORT_ROUTE.description,
      mimeType: REPORT_ROUTE.mimeType,
      accepts: {
        scheme: "exact",
        price: REPORT_ROUTE.price,
        network,
        payTo,
        maxTimeoutSeconds: 300,
      },
    },
  };
}
