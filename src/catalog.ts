import { ExactSvmScheme } from "@x402/svm/exact/server";
import { NETWORK, TWZRD_FEE_PAYER } from "./x402guard.js";
import { isSolanaAddress } from "./address.js";
import { REPORT_ROUTE } from "./resources.js";
import type { Env } from "./types.js";

// Same scheme the payment guard registers — catalog price/asset can't drift
// from a real 402 challenge on the same route.
const PRICE_SCHEME = new ExactSvmScheme();

export interface CatalogPaymentRequirement {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string | null;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface CatalogResource {
  type: "http";
  resource: string;
  x402Version: 2;
  method: string;
  accepts: CatalogPaymentRequirement[];
  lastUpdated: string;
  metadata: { description: string; mimeType: string };
}

export interface Catalog {
  name: string;
  description: string;
  x402Version: 2;
  network: string;
  payTo: string | null;
  facilitator: string;
  resources: CatalogResource[];
}

export async function buildCatalog(env: Env, origin: string): Promise<Catalog> {
  const payTo = isSolanaAddress(env.X402_PAY_TO) ? env.X402_PAY_TO : null;
  const resourceUrl = `${origin}${REPORT_ROUTE.path}`;
  const facilitator = env.X402_FACILITATOR_URL || "https://intel.twzrd.xyz";

  let accepts: CatalogPaymentRequirement[] = [];
  try {
    const asset = await PRICE_SCHEME.parsePrice(REPORT_ROUTE.price, NETWORK);
    accepts = [
      {
        scheme: "exact",
        network: NETWORK,
        amount: asset.amount,
        asset: asset.asset,
        payTo,
        maxTimeoutSeconds: 300,
        extra: {
          ...(asset.extra ?? {}),
          feePayer: (asset.extra as { feePayer?: string } | undefined)?.feePayer ?? TWZRD_FEE_PAYER,
        },
      },
    ];
  } catch {
    accepts = [];
  }

  return {
    name: "x402 Solana starter",
    description:
      "A minimal, deploy-your-own machine-payable API. Pay with HTTP 402 + USDC on Solana — no human account needed. Facilitator + payer screen via TWZRD.",
    x402Version: 2,
    network: NETWORK,
    payTo,
    facilitator,
    resources: [
      {
        type: "http",
        resource: resourceUrl,
        x402Version: 2,
        method: REPORT_ROUTE.method,
        accepts,
        lastUpdated: new Date().toISOString(),
        metadata: { description: REPORT_ROUTE.description, mimeType: REPORT_ROUTE.mimeType },
      },
    ],
  };
}
