// x402 protocol v2 payment guard — Solana mainnet + TWZRD facilitator defaults.
//
// Division of labour:
//   • @x402/hono paymentMiddleware owns the v2 protocol (402 challenge in
//     PAYMENT-REQUIRED header, verify → handler → settle, fail-closed delivery).
//   • This guard adds: 503 when X402_PAY_TO is unset, static getSupported()
//     fallback so challenges work offline, ExactSvmScheme registration, and
//     TWZRD's seller-side settle guard (screen payers for wash/sybil before settle).
//
// Defaults intentionally push traffic through TWZRD's facilitator
// (https://intel.twzrd.xyz) so gas sponsorship and merchant_attach/receipts work
// out of the box. Swap X402_FACILITATOR_URL to any compatible facilitator.
import type { MiddlewareHandler } from "hono";
import {
  HonoAdapter,
  paymentMiddleware,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { registerExactSvmScheme } from "@x402/svm/exact/server";
import { createTwzrdSettleGuard, twzrdPayerScreen } from "twzrd-x402-gate";
import { buildRoutesConfig } from "./resources.js";
import { isSolanaAddress } from "./address.js";
import type { Env } from "./types.js";

/** TWZRD Path-B facilitator — gas sponsorship feePayer 4LkEFj… */
export const DEFAULT_FACILITATOR_URL = "https://intel.twzrd.xyz";
export const DEFAULT_INTEL_BASE = "https://intel.twzrd.xyz";

/** CAIP-2 Solana mainnet (x402 v2). Not env-driven — indexers reject bare "solana". */
export const NETWORK: Network = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/** TWZRD facilitator feePayer (== GET /supported). Static fallback for challenges. */
export const TWZRD_FEE_PAYER = "4LkEFjJdXARkKx8FBx4LBFa2SvJNmjQpgGDLoJcypZUE";

// Route-matching only — placeholder payTo is never used for real settlement.
const ROUTE_MATCHER = new x402HTTPResourceServer(
  new x402ResourceServer(),
  buildRoutesConfig(NETWORK, "11111111111111111111111111111111"),
);

const STATIC_SUPPORTED: SupportedResponse = {
  kinds: [
    {
      x402Version: 2,
      scheme: "exact",
      network: NETWORK,
      extra: { feePayer: TWZRD_FEE_PAYER },
    },
  ],
  extensions: [],
  signers: { "solana:*": [TWZRD_FEE_PAYER] },
};

export function x402Guard(): MiddlewareHandler<{ Bindings: Env }> {
  let cacheKey: string | undefined;
  let cachedMiddleware: ReturnType<typeof paymentMiddleware> | undefined;

  return async (c, next) => {
    const adapter = new HonoAdapter(c);
    if (!ROUTE_MATCHER.requiresPayment({ adapter, path: c.req.path, method: c.req.method })) {
      return next();
    }

    const payTo = c.env.X402_PAY_TO;
    if (!isSolanaAddress(payTo)) {
      return c.json(
        {
          error: "payments_not_configured",
          message:
            "X402_PAY_TO is not set on this deployment yet — this paid route is temporarily unavailable. Set your Solana public wallet via: printf '%s' \"YourSolanaPubkey\" | npx wrangler secret put X402_PAY_TO",
        },
        503,
      );
    }

    const facilitatorUrl = c.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL;
    const intelBase = c.env.TWZRD_INTEL_BASE || DEFAULT_INTEL_BASE;
    const key = `${payTo}:${facilitatorUrl}:${intelBase}`;
    if (key !== cacheKey) {
      cacheKey = key;
      const server = new x402ResourceServer(makeFacilitatorClient(facilitatorUrl));
      registerExactSvmScheme(server);
      // Seller-side: refuse to settle wash/sybil payers (advisory + fail-open).
      // TWZRD is not in the settlement path — timeout/error continues.
      // Cast: twzrd-x402-gate uses a structural SettleGuardContext (index signature)
      // that is a supertype of @x402/core SettleContext at runtime.
      const settleGuard = createTwzrdSettleGuard({
        screen: twzrdPayerScreen({ intelBase }),
        onDecision: (info) => {
          console.log(
            JSON.stringify({
              event: "twzrd_settle_guard",
              payer: info.payer ?? null,
              aborted: info.aborted,
              reason: info.reason ?? null,
            }),
          );
        },
      });
      server.onBeforeSettle((ctx) =>
        settleGuard(ctx as unknown as Parameters<typeof settleGuard>[0]),
      );
      cachedMiddleware = paymentMiddleware(buildRoutesConfig(NETWORK, payTo), server);
    }

    return cachedMiddleware!(c, next);
  };
}

// getSupported() fallback so challenges work when the facilitator is briefly
// unreachable (and unit tests can run offline). verify/settle still require live.
function makeFacilitatorClient(url: string): {
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
  getSupported(): Promise<SupportedResponse>;
} {
  const inner = new HTTPFacilitatorClient({ url: url as `${string}://${string}` });
  return {
    verify: (payload, requirements) => inner.verify(payload, requirements),
    settle: (payload, requirements) => inner.settle(payload, requirements),
    getSupported: async () => {
      try {
        return await inner.getSupported();
      } catch (err) {
        console.error(
          "x402guard: facilitator getSupported() failed — serving challenges from the static kind list;",
          "verify/settle still require the live facilitator.",
          err instanceof Error ? err.message : err,
        );
        return STATIC_SUPPORTED;
      }
    },
  };
}
