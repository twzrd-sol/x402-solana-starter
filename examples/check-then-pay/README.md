# Check, then pay: one x402 payment on Solana with a free pre-sign check

Reproduce a full loop for under a cent: a free check on the exact 402 requirement runs before any signer, one USDC payment settles on Solana mainnet, and the finalized chain transaction is read back and digested.

What it does, in order
1. Fetches the seller's 402 and selects the Solana USDC requirement (official `@x402/core` client, `@x402/svm` exact scheme).
2. Runs the `twzrd-x402-gate` pre-sign hook (free): preflight, merchant card, readiness. Recipient is pinned to the payTo you pass, with a per-call cap. A slow or unreachable gate blocks the payment (fail-closed).
3. Signs and pays only if the verdict allows; the seller's facilitator pays the Solana fee, so the payer needs USDC only.
4. Reads the seller's PAYMENT-RESPONSE, polls the finalized transaction, and records its wire sha256 (sha256 over the base64-decoded wire transaction from `getTransaction(encoding=base64, commitment=finalized)`).
5. Writes one JSON record per run (no key path inside).

Run
```
npm install
# find a seller: GET https://intel.twzrd.xyz/v1/intel/resources  (live_402, Solana, exact price)
node check-then-pay.mjs --url <resource> --pay-to <payTo> --max-usdc 0.01 --dry-run   # nothing is signed
SVM_KEYPAIR_PATH=<funded keypair json> SVM_RPC_URL=<private rpc> \
  node check-then-pay.mjs --url <resource> --pay-to <payTo> --max-usdc 0.01
```
`--dry-run` works with no wallet: it aborts after the gate's verdict, before the signer. Use a private RPC for a funded run; public endpoints rate-limit the after-read. Optional `--intel-timeout-ms` widens the gate's 2 s default after a fail-closed timeout.

A worked example (2026-10-02, 0.0022 USDC, two sellers, one fail-closed block that passed on retry) is in [`worked-example-2026-10-02.json`](worked-example-2026-10-02.json).

Honest limits: self-funded, so it shows mechanics, not demand. A 200 is not proof of delivery. TWZRD's hosted by-tx witness route covers only settlements TWZRD facilitated; for a third-party seller the settlement is evidenced by the seller's PAYMENT-RESPONSE and the finalized chain transaction.
