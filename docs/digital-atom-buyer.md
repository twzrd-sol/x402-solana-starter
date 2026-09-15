# Digital-atom buyer verification state machine (draft)

Companion to the [endpoint contract](digital-fact-contract.md). This defines
the requested implementation and evidence gates; it is not an executed proof.

## Fixed inputs and invariants

Before network access, require an exact absolute resource URL, expected seller
`payTo`, scheme, network, USDC mint, atomic amount, facilitator fee payer, payer
public key, fixture/manifest pins, and whether the TWZRD gate is enabled.
Deployment values must be explicit; missing values fail configuration checks.
The baseline amount is `"10000"` (0.01 USDC), using integer strings/BigInt, never
floating-point price comparisons. Network and asset pins are in the contract.

The buyer is given this resource URL. The 402 discovers its payment terms;
this first proof does not establish autonomous service search or outside demand.

- One run, one fresh evidence directory, at most one payer-sign invocation and
  one payment-bearing retry. Never re-sign after a timeout, changed challenge,
  second 402, redirect, or transport error.
- Exactly two resource GETs on a successful run: unpaid, then paid, to the same
  byte-identical configured URL. Both disable redirects and cache reuse and
  send `Accept: application/json`. No cookies or unrelated authorization.
- No documentation fetch, reader call, `/scrape` to `/browse` fallback, HTML
  parser, or alternate resource. RPC and explicitly configured TWZRD/payment
  transport endpoints are allowed, bounded dependencies.
- Suggested fixed budgets: each resource request 30 s; challenge age at signing
  at most 60 s by monotonic clock; confirmation polling at most 60 s. Abort a
  stalled body as well as stalled headers. Cap each payment header at 64 KiB
  and each decoded header/resource body at 1 MiB. Record chosen limits in run
  policy before the first request. These are harness limits, not x402 fields.
- First persist `run.json` with `closed_loop: false`. Persist state transitions
  and timestamps atomically. A crash or incomplete bundle can never imply PASS.

The payer remains the current `@x402/core` + `@x402/svm` implementation. The
current script rejects an unpaid 200, but calls `createPaymentPayload` without
independent policy pins and exits 0 based only on the final status. Those are
implementation gaps this contract closes. The README's PayAI `beforePayment`
example is a separate integration, not an already-wired hook in that script.

## Transition table

Every guard is mandatory. Any guard failure enters terminal `FAIL`; no edge
returns to a previous payment state. Unperformed checks remain null/unobserved,
not successful. Persist raw responses before parsing whenever bytes exist.

| State | Required action / guard | Next state | Evidence |
| --- | --- | --- | --- |
| `PREFLIGHT` | Validate independent policy, source pins, exact fixture bytes, and all golden expectations locally; reserve new run directory | `REQUEST_UNPAID` | `fixture.md`, `fixture.manifest.json`, initial `run.json` |
| `REQUEST_UNPAID` | GET exact URL without payment; require status **402**, no redirect, no cache reuse | `VALIDATE_CHALLENGE` | Status, timings, headers and body in `challenge.json` |
| `VALIDATE_CHALLENGE` | Require one nonempty `PAYMENT-REQUIRED`; strict base64/JSON and SDK v2 validation; independently check every pinned term | `AUTHORIZE` | Raw header, decoded envelope, selected option, policy comparison and digest in `challenge.json` |
| `AUTHORIZE` | If gate enabled, explicit fresh TWZRD allow for this exact request/requirements; persist decision before signer use. Otherwise record gate disabled | `SIGN_ONCE` | `payment-decision.json` only when enabled; policy in `run.json` |
| `SIGN_ONCE` | Recheck challenge age and unchanged approved terms; invoke SDK payment construction once with a counted signer wrapper; verify one successful payer signature | `RETRY_SAME_RESOURCE` | Signed message digest, payload digest, payer, sign count/timestamps in `run.json` |
| `RETRY_SAME_RESOURCE` | Encode `PAYMENT-SIGNATURE` via SDK; issue one same-URL GET; require final status exactly 200 and JSON media type | `VERIFY_SETTLEMENT` | Exact body bytes in `paid-response.json`; status/headers/timings in `settlement.json` |
| `VERIFY_SETTLEMENT` | Decode `PAYMENT-RESPONSE`, require successful matching receipt, and corroborate the exact submitted payment on mainnet | `VERIFY_PAYLOAD` | Receipt plus chain checks in `settlement.json` |
| `VERIFY_PAYLOAD` | Strict JSON and schema; compare source pins and recomputed fixture SHA/length; independently verify all results and byte bounds | `FINALIZE` | Detailed per-check results in `verification.json` |
| `FINALIZE` | All guards true; all required evidence present and hashed; expected counts agree; atomically write completed summary | `PASS` | Final `run.json`, `closed_loop: true` |
| `FAIL` | Record stable code, failed state, observed evidence, and any possible payment exposure; exit nonzero; never sign again | Terminal | Partial bundle and `run.json`, `closed_loop: false` |

The signer wrapper records an attempt durably **before** calling the signer.
`payment_signed` becomes true only after an actual successful signature, not
after wallet loading or challenge decoding. A second signer invocation throws.
Retain the approved requirements and fixture as immutable values, not mutable
references a hook or SDK callback can alter. Use an explicit single-option
payload construction path; do not wrap fetch in an automatic payment loop.

Before delegating to the real signer, decode the proposed transaction with the
existing Solana SDK and check its payer authority, mint, amount, destination
ownership, and sponsor against the approved terms. Permit only instructions
required by the pinned exact-SVM scheme; reject extra value transfers or
unrecognized instructions before signing. A challenge that passed validation
does not authorize a different transaction. Record the signed message digest
only after the wrapper confirms that it is the validated message.

## Challenge checks before signing

Require all of the following, comparing against trusted inputs:

| Field / property | Required check |
| --- | --- |
| Status / version | Exactly 402 and numeric `x402Version: 2`; no body-only or v1 fallback |
| Resource | `resource.url` equals configured URL exactly; configured method remains GET; MIME type `application/json` |
| Options | `accepts.length === 1`; SDK must sign that validated option |
| Scheme / network / asset | Exact pinned strings, including CAIP-2 mainnet and the USDC mint |
| Amount / recipient | `amount === "10000"`, valid base58 `payTo`, exact expected public key |
| Timeout | `maxTimeoutSeconds === 300`; locally observed challenge still within signing-age limit |
| Sponsorship | Valid, independently pinned `extra.feePayer`; no surprise payer-funded SOL fallback |
| Envelope / extensions | Well-formed SDK v2 data; reject duplicate object names, ambiguous headers, and unsupported extensions or payment-affecting extras |

An optional body mirror must agree with the decoded header; `{}` is normal.
Header names are HTTP case-insensitive. Reject duplicate or comma-joined payment
headers rather than choosing one. The displayed description is not authority
to change any payment term. Optional SDK metadata may be allowed only through
an explicit, recorded profile for the pinned SDK version.

Bind a gate decision to SHA-256 of the UTF-8 serialization of
`{method, resource, payer, requirements}`. Recursively sort object keys
lexicographically, retain array order, and use compact `JSON.stringify` output
without a trailing newline. Permit only validated JSON values and safe integers
for numeric fields; amounts remain strings. Use this same algorithm before and
after the gate. Record the gate policy/version, decision,
reason, invocation and completion times, and that digest. Enabled means only
an explicit `allow` proceeds: deny, unknown, timeout, error, malformed result,
missing decision, changed digest, or expired challenge stops before signing.
Do not inherit a library's advisory/fail-open default. The adapter for the
chosen TWZRD API must satisfy these requirements before gate mode is enabled.
Gate-disabled runs remain valid protocol experiments but claim no TWZRD allow.

## Settlement is independently checked

`PAYMENT-RESPONSE` is commerce evidence, never part of `x402.digital_fact.v1`.
Save the exact header, decoded receipt, final HTTP status/content type, payer,
approved amount/network/asset/recipient, and observed transaction identifier.
Missing/invalid receipt, `success !== true`, wrong network/payer, or empty tx
fails even when the application returned 200.

For the mainnet proof, query the independently configured mainnet RPC and
require a confirmed or finalized transaction with `meta.err === null`:

1. Bind the chain transaction to the payer-signed message recorded before
   transmission, including message bytes/digest and the payer signature.
   Facilitator co-signatures may be added; compare the message, not an assumed
   pre-settlement transaction ID that may lack the sponsor signature.
2. Require the intended payer as the token transfer authority. Do not confuse
   the facilitator's fee-payer signature with the buyer's USDC payment.
3. Decode the actual transfer and token accounts: expected USDC mint, exact
   `10000` atomic units, source controlled by the payer, destination token
   account owned by the pinned `payTo`. Check the expected sponsor and reject
   unexpected value transfers. Balance changes alone are insufficient.
4. Preserve slot, confirmation level, observed time, transaction/message data,
   and the results of these checks. Bind the receipt transaction ID to this
   transaction, not an unrelated successful transfer.

If the RPC cannot establish this before the deadline, leave settlement
unconfirmed and fail the proof. A paid retry can settle even when its HTTP
response is lost: record `payment_transmitted: true` and
`settlement_status: "unknown"`, never assert that nothing was spent. Read-only
reconciliation is allowed; another payment requires a new explicit run.

This is application-level binding across the saved challenge, HTTP exchange,
and signed transaction. It does not claim the Solana transfer itself commits
to the fact payload or resource URL.

## Delivery verification and counters

Save the exact response body without reformatting. If it is invalid JSON,
`paid-response.json` retains the invalid bytes for diagnosis; its filename
does not certify validity. Parse with duplicate-name rejection and validate
[the JSON Schema](digital-fact.schema.json), then apply all semantic rules in
the endpoint contract. Compute SHA-256 locally; comparing two advertised
hash strings is not verification.

Require exactly the two expected result IDs and targets, in manifest order.
For every entry recompute the outcome, first byte offset, end bound, and slice
from the trusted fixture. Independently establish absence for `not_found`.
An unknown is an evaluated result, not an omitted assertion. Require the
`PAYMENT-RESPONSE` fact to pass and, for this exact historical fixture, the
`PAYMENT-SIGNATURE` fact to be unknown. A truthful unknown for a required-pass
fact still fails fulfillment.

- `facts_evaluated`: expected facts independently checked to completion.
- `facts_pass`: checked entries that agree with a recomputed `pass` and their
  manifest expectation.
- `facts_unknown`: checked entries that agree with recomputed absence and
  their manifest `unknown/not_found` expectation; never included in pass.
- `facts_failed`: checked expected entries with any result/expectation/span
  mismatch, counted once per fact. Structural/transport errors are separate
  verification errors and can fail a run with `facts_failed: 0`.
- `facts_unevaluated`: expected entries not checked to completion, including
  early failure. Evaluated = pass + unknown + failed; expected = evaluated +
  unevaluated. Extra/duplicate entries are structural errors, not extra credit.

`commerce_verified` means the challenge, authorization, one signature, same-route
retry, and mainnet settlement were verified. `closed_loop` additionally requires
verified delivery and complete persisted evidence. A paid but incorrect payload
can have `commerce_verified: true, closed_loop: false`.

## Evidence bundle and summary

Every successfully closed invocation leaves the following files. `commerce_run`
is the evidence domain for challenge/decision/settlement/run records; it is not
a new field added to the fact payload or a requirement for another file.

| File | Contents / domain |
| --- | --- |
| `fixture.md` | Exact trusted input bytes; digital-fact input |
| `fixture.manifest.json` | Trusted source pins, matcher and expectations; digital-fact input |
| `challenge.json` | Unpaid HTTP exchange, raw and decoded challenge, policy check; commerce |
| `payment-decision.json` | Required only when gate enabled, including a denied/error decision; commerce |
| `paid-response.json` | Exact delivered application body; digital fact |
| `settlement.json` | Final HTTP metadata, raw/decoded PAYMENT-RESPONSE, transaction and chain checks; commerce |
| `verification.json` | Schema/integrity/semantic checks, expected vs actual per fact, stable errors and counts |
| `run.json` | State, timestamps, pinned policy, payer, signed-message binding, counters and summary; commerce |

Use a unique run ID in every harness-produced JSON record; do not inject it
into the seller's paid response or the frozen fixture/manifest. Record exact
artifact SHA-256 digests in `run.json` for every other file (never a recursive
hash of `run.json` itself). Write via temporary file plus atomic rename, and
finalize `run.json` last. Do not store private keys, seeds, auth credentials,
or a replayable PAYMENT-SIGNATURE header in the published bundle. The confirmed
transaction and message binding provide public payment evidence.

Failures retain only artifacts actually observed/generated; do not fabricate a
challenge, receipt, paid body, decision, or reader observation to complete the
directory. Artifact write errors also prevent `closed_loop: true`.

The following is a **summary excerpt for a future successful run**, not captured
evidence; a real `run.json` also includes the IDs, digests, timestamps, policy,
state history, and payment binding described above:

```json
{
  "schema": "x402.digital_atom_run.v1",
  "resource": "https://<seller-origin>/digital-fact/migrate-x402-v2",
  "challenge_seen": true,
  "challenge_valid": true,
  "gate_enabled": false,
  "payment_signed": true,
  "signer_calls": 1,
  "payment_transmitted": true,
  "settlement_success": true,
  "settlement_status": "confirmed",
  "http_final_status": 200,
  "payload_schema_valid": true,
  "origin_hash_valid": true,
  "facts_expected": 2,
  "facts_evaluated": 2,
  "facts_pass": 1,
  "facts_unknown": 1,
  "facts_failed": 0,
  "facts_unevaluated": 0,
  "commerce_verified": true,
  "delivery_verified": true,
  "artifacts_complete": true,
  "closed_loop": true
}
```

Only `FINALIZE` may set `closed_loop: true`; exit 0 only after its final atomic
write succeeds. Offline evaluator tests may report local verification success,
but cannot claim commerce success or a closed loop.

## Acceptance matrix

Tests use fake transport and a counting signer, with an explicit URL allowlist.
Offline tests fail on any unmocked network access. Mocks establish behavior;
only a separately recorded real mainnet invocation establishes the live claim.

| Case | Required result |
| --- | --- |
| Frozen fixture, no payment/network | Deterministic output; 1 pass + 1 unknown; no commerce claim |
| Unpaid healthy endpoint | 402 + valid v2 challenge; no factual payload |
| Valid mock payment and fulfillment | 200 + deterministic body; one payer signature, two resource GETs |
| Real mainnet happy path | Same behavior plus bound confirmed USDC settlement and complete bundle |
| Local fixture/hash corrupt, even if seller echoes corrupt hash | Fail preflight; zero signer calls |
| Delivered source hash/length corrupt | Fail verification; payment may already have settled |
| Change target text in evaluator-only fixture | `unknown/not_found`; required-pass contract rejects |
| Missing PAYMENT-SIGNATURE in golden fixture | Evaluated unknown; unknown count 1, pass count remains 1 |
| Forged unknown when target exists; bad/later/UTF-16 spans | Reject; include multibyte prefix and repeated-target vectors |
| Wrong payTo, amount, network, resource, asset, scheme, timeout or fee payer | Reject before signing; zero signer calls |
| Multiple options, body/header disagreement, malformed/duplicate/missing payment header | Reject before signing |
| Gate deny/unknown/error/timeout or changed approved terms | Persist decision and reject before signing |
| Constructed transaction differs from approved terms or adds a transfer | Signer wrapper rejects before the real signer is invoked |
| Unpaid free 200, redirect or any first status other than 402 | Fail commerce proof; zero signer calls |
| Paid retry 402/redirect/error/timeout | Fail, never re-sign; preserve possible settlement exposure |
| Final 200 with wrong MIME type, invalid/duplicate-key JSON, wrong schema or missing required pass | Reject delivery |
| Missing/failed receipt, wrong payer/tx/network, RPC-unconfirmed or unrelated transfer | Reject settlement |
| Missing/duplicate/additional/reordered/substituted fact; unexpected payload metadata | Reject contract |
| Any docs fetch, reader call or attempted `/browse` fallback | Test fails on attempted call, even if caught |
| SDK requests a second signature; evidence write failure/crash | Stop; no closed-loop result |

After this passes on mainnet, the supported claim is that a configured
autonomous buyer obtained pricing over HTTP, authorized and settled USDC,
synchronously consumed the digital fact, and independently verified the
delivered result. Both sides remain controlled. The next experiment changes
exactly one side to a foreign seller or buyer; it does not weaken these guards.
