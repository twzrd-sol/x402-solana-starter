# x402 Solana starter

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/twzrd-sol/x402-solana-starter)

**Role: production Solana storefront (x402 v2).**  
For a **minimal CF-tutorial wedge** (`x402-hono` v1 middleware + one-line facilitator swap), see
[x402-seller-starter](https://github.com/twzrd-sol/x402-seller-starter).

**Sell one API route to AI agents on Solana in about 10 minutes.** A Cloudflare
Worker that speaks [x402](https://x402.org) **v2** — HTTP `402 Payment Required`
+ **USDC on Solana mainnet** — with:

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

## Verify before you trust it (smoke + wedge)

```bash
npm install
npm test                 # offline unit tests
npm run smoke            # in-process 402 against live TWZRD facilitator
npm run smoke:contrast   # TWZRD must PASS; x402.org must FAIL for mainnet Solana
```

What smoke asserts (v2-native):

| Check | Expected |
|---|---|
| Free `/` + `/health` | 200 |
| Unpaid `/report` | **402**, body `{}`, challenge in `PAYMENT-REQUIRED` |
| Network | CAIP-2 `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet) |
| feePayer | Present (TWZRD `4LkEFj…` when facilitator is intel) |
| Unset `X402_PAY_TO` | **503** `payments_not_configured` |

`smoke:contrast` proves the wedge: stock `https://x402.org/facilitator` has no
Solana **mainnet** kind, so the storefront cannot sell — TWZRD can.

### Settlement runbook (after deploy)

1. Deploy with a real `X402_PAY_TO` secret.
2. Confirm `curl -si https://YOUR.workers.dev/report` → **402** + `PAYMENT-REQUIRED`.
3. Pay with any Solana x402 v2 client (example below). Expect **200** body + settlement evidence.
4. Confirm on-chain USDC transfer to `X402_PAY_TO`.

### Live example (mainnet, v2)

Deployed and settling (not only simulated):

```bash
curl -si https://x402-solana-starter.fp4b5ksccw.workers.dev/report
# HTTP/1.1 402 + PAYMENT-REQUIRED header; body {}
```

Settlement tx (Solana mainnet, **$0.01** USDC):  
[`4Hbk81j3ktb3yW47Ts7gHT6JermWmAJaNW61VxdM4Z6frJKwPF5WcirWCuJxdUymD9syQvPLDQ9X9YVpKnYxdEoJ`](https://explorer.solana.com/tx/4Hbk81j3ktb3yW47Ts7gHT6JermWmAJaNW61VxdM4Z6frJKwPF5WcirWCuJxdUymD9syQvPLDQ9X9YVpKnYxdEoJ)

```bash
python3 scripts/pay_v2_solana.py \
  --url https://x402-solana-starter.fp4b5ksccw.workers.dev/report \
  --keypair /path/to/funded.json

# or, using the real @x402/core + @x402/svm client libraries directly
# instead of a hand-rolled transaction envelope:
npm run pay -- \
  --url https://x402-solana-starter.fp4b5ksccw.workers.dev/report \
  --keypair /path/to/funded.json
```

The two payers accept **different** keypair file formats — they are not
drop-in replacements for each other:

| Payer | Accepts |
|---|---|
| `pay_v2_solana.py` | JSON byte array only — 64-byte keypair, or 32-byte seed |
| `pay_v2_solana.mts` (`npm run pay`) | 64-byte JSON byte array, **or** `{"privateKey": "<base58>"}` (32-byte seed or 64-byte secret key) |

Both fail loudly on an unpaid `200` response rather than treating it as
success — this starter has hit a transient Cloudflare edge-cache artifact
that served a stale `200` for one request before self-correcting, and a
payer script's job is to prove a real 402→pay→settle round trip, not shrug
at a free response.

Honest caveat: the demo payer was ops-funded to prove the rail, not organic external demand.

## Buy the route

Any x402-compatible Solana client works. With stock PayAI client + TWZRD gate
on the **buyer** side (optional but recommended — Path B refuse-before-sign):

```bash
npm i x402-solana@2.1.0 twzrd-x402-gate@0.8.16
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

## What is proven vs not

| Claim | Status |
|-------|--------|
| Challenge construction end-to-end (v2, CAIP-2 Solana mainnet) via TWZRD facilitator | **Proven** (`npm run smoke`) |
| Stock `x402.org/facilitator` cannot supply a feePayer for Solana mainnet | **Proven** (`npm run smoke:contrast`) |
| Unconfigured deploy refuses (`503`) instead of misrouting payment | **Proven** (`npm run smoke`) |
| Settle guard screens payers via `merchant_card` before serving | **Proven** by unit test (`test/settle-guard.test.ts`), not yet by a live wash-flagged payer |
| Full USDC settle through a deployed Worker, ops-funded payer | **Proven** 2026-08-11 — see [Live example](#live-example-mainnet-v2) above (settlement tx independently re-verified against Solana mainnet RPC before this line was written) |
| Settle from a non-TWZRD-controlled operator environment (someone else deploys and runs this Worker independently) | **Not yet** |
| Organic external demand (a real stranger pays, regardless of who operates the Worker) | **Not yet** — the live example's payer was ops-funded specifically to prove the rail |

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
| `scripts/smoke.mts`, `scripts/contrast.sh` | Live wedge proof (`npm run smoke`, `npm run smoke:contrast`) |
| `scripts/pay_v2_solana.py`, `scripts/pay_v2_solana.mts` | Live payer scripts (`npm run pay` for the TypeScript one) |

## Same pattern, other hosts

The Deploy button pattern is identical on Vercel and Railway — same public
repo, different button URL. This Worker is the Cloudflare seat; the payment
surface is plain HTTP 402 and can sit behind any edge runtime that runs Hono.

## Related starters

| Repo | Role | Stack |
|---|---|---|
| **This repo** | Full Solana storefront | `@x402/hono` + `@x402/svm` v2 + settle-guard |
| [x402-seller-starter](https://github.com/twzrd-sol/x402-seller-starter) | Minimal CF-tutorial wedge | `x402-hono` v1 + facilitator URL only |

## Links

- [x402 protocol](https://x402.org)
- [TWZRD agent intel / facilitator](https://intel.twzrd.xyz)
- [twzrd-x402-gate (npm)](https://www.npmjs.com/package/twzrd-x402-gate)
- [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [x402-solana (PayAI client)](https://www.npmjs.com/package/x402-solana)

## License

MIT
