import { Hono } from "hono";
import { buildCatalog } from "./catalog.js";
import { x402Guard, DEFAULT_FACILITATOR_URL, NETWORK, TWZRD_FEE_PAYER } from "./x402guard.js";
import openApiSpec from "./openapi.json";
import { REPORT_ROUTE } from "./resources.js";
import { isSolanaAddress } from "./address.js";
import type { Env } from "./types.js";

const app = new Hono<{ Bindings: Env }>();

app.use("*", x402Guard());

app.get("/", async (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(await buildCatalog(c.env, origin));
});

app.get("/health", (c) =>
  c.json({
    status: "ok",
    network: NETWORK,
    facilitator: c.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL,
    feePayer: TWZRD_FEE_PAYER,
    payToConfigured: isSolanaAddress(c.env.X402_PAY_TO),
    settleGuard: "twzrd-x402-gate",
  }),
);

// Static OpenAPI — indexers (x402scan, 402index) probe this without paying.
app.get("/openapi.json", (c) => c.json(openApiSpec));

// Legacy discovery convention — same free catalog as GET /.
app.get("/.well-known/x402", async (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(await buildCatalog(c.env, origin));
});

app.get(REPORT_ROUTE.path, (c) =>
  c.json({
    report:
      "hello from your Solana x402 storefront — this response cost the caller $0.01 USDC.",
    network: NETWORK,
    generatedAt: new Date().toISOString(),
    poweredBy: {
      protocol: "x402 v2",
      facilitator: c.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL,
      settleGuard: "twzrd-x402-gate",
    },
  }),
);

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
