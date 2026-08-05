# x402 Solana starter

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/twzrd-sol/x402-solana-starter)

**Sell one API route to AI agents on Solana in about 10 minutes.** A minimal
Cloudflare Worker that speaks [x402](https://x402.org) **v2** — HTTP `402
Payment Required` + **USDC on Solana mainnet** — with:

| Pre-wired default | Why |
|---|---|
| **TWZRD facilitator** (`https://intel.twzrd.xyz`) | Gas-sponsored settles (`feePayer` `4LkEFj…`), free merchant cards, signed receipts |
| **TWZRD settle guard** | Screens payers via free `merchant_card` for wash/sybil before settle+serve (advisory, fail-open; Workers-safe, no Node `createRequire`) |
| Free discovery | `GET /`, `GET /.well-known/x402`, `GET /openapi.json`, `GET /health` |

No login, no API key, no human checkout. A buyer needs a Solana wallet and USDC.

> **Permissionless hosting.** Anyone can publish a Deploy button pointing at a
> public repo — Cloudflare clones it into *their* account, on *their* domain,
> paying *their* bill. This template is that button for Solana x402 sellers.

## What this sells

One paid route (`GET /report`, **$0.01 USDC**, Solana mainnet) plus free
discovery. Swap `/report` for whatever you're selling — price, path, and
handler live in `src/resources.ts` + `src/index.ts`.

## Deploy

### One-click

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/twzrd-sol/x402-solana-starter)

Cloudflare clones this repo into your GitHub account and deploys it. Paid
routes respond `503 payments_not_configured` until you set the `X402_PAY_TO`
secret (step 2 below). Free routes work immediately.

### Manual (~10 minutes)

Prereqs: free Cloudflare account, Node 22+, and a **Solana** public wallet
address (Phantom, Solflare, etc. — public base58 only; no private key ever
touches this Worker).

```bash
git clone https://github.com/twzrd-sol/x402-solana-starter && cd x402-solana-starter
npm install

# 1. Confirm free routes locally
npm run dev
curl -s http://localhost:8787/health
curl -s http://localhost:8787/               # catalog
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/report   # 503 expected

# 2. Set your Solana payout address (where USDC lands)
printf '%s' "YourSolanaPubkeyHere" | npx wrangler secret put X402_PAY_TO

# 3. Ship
npm run deploy
```

Open the printed `workers.dev` URL. `curl -si <url>/report` should return
**402** with a `PAYMENT-REQUIRED:` header (v2 challenge) and body `{}`.

## Buy the route (smoke)

Any x402-compatible Solana client works. With stock PayAI client + TWZRD gate
on the **buyer** side (optional but recommended):

```bash
npm i x402-solana@2.1.0 twzrd-x402-gate@0.8.13
```

```ts
import { createX402Client } from "x402-solana";
import { createTwzrdBeforePaymentHook } from "twzrd-x402-gate";

const client = createX402Client({
  wallet, // your Solana signer
  network: "solana",
  beforePayment: createTwzrdBeforePaymentHook({ refuseWashFlagged: true }),
});

const res = await client.fetch("https://YOUR_WORKER.workers.dev/report");
console.log(await res.json());
```

## Defaults you get for free

| Knob | Default | Override |
|---|---|---|
| Network | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet) | fixed in code |
| Facilitator | `https://intel.twzrd.xyz` | `X402_FACILITATOR_URL` var |
| Fee payer | `4LkEFjJdXARkKx8FBx4LBFa2SvJNmjQpgGDLoJcypZUE` | from facilitator `/supported` |
| Settle guard | free `GET /v1/intel/merchant_card/{payer}` (in-Worker) | `TWZRD_INTEL_BASE` var |
| Price | `$0.01` | `src/resources.ts` |

## Troubleshooting

1. **v1 vs v2 wire format.** v2 puts the challenge in a base64 `PAYMENT-REQUIRED`
   header (body is `{}`), uses CAIP-2 network ids, and renames
   `maxAmountRequired` → `amount`. Indexers like [x402scan](https://x402scan.com)
   reject v1. This starter is v2.
2. **Prices are strings; amounts are atomic.** You write `price: "$0.01"`;
   the scheme converts to `amount: "10000"` (USDC 6 decimals).
3. **Verify ≠ settle.** Middleware `verify()`s before your handler, then
   `settle()`s only after a `2xx`. If the handler throws, the buyer paid $0.
4. **`X402_PAY_TO` must be Solana base58**, not an `0x…` EVM address. Wrong shape
   → 503.
5. **Gas sponsorship depends on the facilitator wallet.** TWZRD's fee payer
   must be funded for sponsored settles. If sponsorship is drained, buyers can
   still settle with their own SOL for fees depending on client support — or
   point `X402_FACILITATOR_URL` at another facilitator.

## What's in the box

| Path | What it is |
|---|---|
| `src/index.ts` | Worker: catalog, discovery, health, paid route |
| `src/resources.ts` | Single source of truth for what's for sale |
| `src/catalog.ts` | Bazaar-shaped discovery catalog |
| `src/x402guard.ts` | Payment middleware + TWZRD settle guard + facilitator fallback |
| `wrangler.jsonc` | Deploy config — facilitator pre-wired, payTo is a secret |
| `test/` | Offline unit tests (no network, no real payment) |

## Same pattern, other hosts

The Deploy button pattern is identical on Vercel and Railway — same public
repo, different button URL. This Worker is the Cloudflare seat; the payment
surface is plain HTTP 402 and can sit behind any edge runtime that runs Hono.

## Links

- [x402 protocol](https://x402.org)
- [TWZRD agent intel / facilitator](https://intel.twzrd.xyz)
- [twzrd-x402-gate (npm)](https://www.npmjs.com/package/twzrd-x402-gate)
- [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [x402-solana (PayAI client)](https://www.npmjs.com/package/x402-solana)

## License

MIT
