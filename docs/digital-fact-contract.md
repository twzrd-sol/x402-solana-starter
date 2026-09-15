# Digital-fact endpoint contract (draft)

Status: specification only; no digital-fact endpoint or mainnet digital-atom
run is claimed by this change. Based on starter commit
`b04d87a1deafb26518c88ca4ee856248919b5773`.

This experiment sells a deterministic evaluation of an owned, frozen local
fixture. It tests protocol correctness with a controlled buyer and seller.
Outside demand remains unproven.

## Scope and implementation boundary

Replace the single `/report` SKU with `GET /digital-fact/migrate-x402-v2` in a
subsequent implementation. Reuse the existing x402 v2 middleware, Solana payer,
facilitator, and price. The paid handler must never fetch the documentation.

Keep `witness`, `reader.outbid.sh`, `8788`, Monid, and `x402.tick.v1` untouched.
No reader is called, so no `reader_observation` is produced. Existing payment
transport calls are separate from fixture evaluation.

| Surface | Contract |
| --- | --- |
| Method / path | `GET /digital-fact/migrate-x402-v2` |
| Input | No body or query parameters; reject unexpected input before settlement |
| Representation | UTF-8 `application/json`; `Cache-Control: no-store` on every route response |
| Price | Preserve `$0.01` USDC, encoded as atomic string `"10000"` |
| Scheme / network | `exact` / `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Asset | Solana mainnet USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Recipient | Validated deployment `X402_PAY_TO`; buyer supplies an independent expected address |
| Timeout | `maxTimeoutSeconds: 300`, matching the current SKU |
| Delivery | One synchronous JSON artifact after successful settlement; no job ID or polling |

The absolute resource URL is the configured deployment origin plus this exact
path. Reject aliases, trailing-slash variants, redirects, alternate methods,
queries, and free `HEAD` access in this proof profile. Free catalog/OpenAPI
routes may advertise the SKU but do not return its factual payload.

## HTTP outcomes

| Condition | Status and evidence |
| --- | --- |
| Configured, healthy, unpaid | `402`, one `PAYMENT-REQUIRED` header, JSON body `{}` |
| Missing/invalid payout configuration | `503 payments_not_configured`; never a paid success |
| Fixture absent, corrupt, or inconsistent with manifest | `503 fixture_unavailable`; no signing should follow |
| Malformed/invalid payment | Middleware non-2xx rejection; no digital-fact payload |
| Payment verifies but settlement fails | Middleware non-2xx rejection; no digital-fact payload |
| Evaluation/serialization fails | Non-2xx before settlement; no partial result |
| Payment settles and payload is ready | `200`, `PAYMENT-RESPONSE`, exact deterministic JSON artifact |

Use the pinned SDK's x402 codecs and envelope validation, not a parallel payment
implementation. The decoded challenge must have this shape; angle-bracket
values below are deployment inputs, not executable defaults:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://<seller-origin>/digital-fact/migrate-x402-v2",
    "description": "Deterministic facts from a frozen x402 migration guide fixture",
    "mimeType": "application/json"
  },
  "accepts": [{
    "scheme": "exact",
    "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": "10000",
    "payTo": "<independently-pinned-seller-public-key>",
    "maxTimeoutSeconds": 300,
    "extra": { "feePayer": "<independently-pinned-facilitator-public-key>" }
  }]
}
```

For this experiment require exactly one accepted payment option. No v1 body
fallback, automatic option selection, alternate network, or alternate token.
The buyer's policy must not be learned from the same untrusted challenge.

The middleware currently verifies payment, executes the handler, then settles
before releasing a successful response. Preserve that buffered lifecycle:
compute and validate the complete fixture-derived response before settlement,
and do not stream response bytes before settlement succeeds. Cache bypass must
be enforced at the edge as well as in the handler.

## Frozen fixture and trust anchor

The requested historical snapshot has these **candidate pins**, supplied by
the experiment brief, not independently verified by this draft:

| Property | Expected value |
| --- | --- |
| Source URL | `https://docs.x402.org/guides/migration-v1-to-v2.md` |
| Title | `Migration Guide: V1 to V2` |
| Content type | `text/markdown` |
| Length | `16388` bytes |
| SHA-256 | `15bd7640b4031a347a44c74988cb6fcb30f42451c9860e57fd8fb0fa5e189a3f` |
| First `PAYMENT-RESPONSE` match | Proposed byte interval `[758, 774)` |
| `PAYMENT-SIGNATURE` | Expected absent |

**Fixture blocker:** the exact `fixture.md` is not present in this starter.
Recover the archived bytes and verify all pins before activating the SKU.
The [current migration guide](https://docs.x402.org/guides/migration-v1-to-v2)
contains `PAYMENT-SIGNATURE`; it must not silently replace the historical
snapshot to force a desired result. The live `.md` bytes were not recovered
during this draft. Do not infer their hash from rendered documentation.
If the historical bytes disagree with any proposed offset or result, stop and
record the mismatch; revise the fixture contract explicitly before any payment.

`fixture.manifest.json` is a committed, independently provisioned buyer input:

```json
{
  "schema": "x402.digital_fact_fixture.v1",
  "fact_id": "migrate-x402-v2",
  "fixture_file": "fixture.md",
  "source": {
    "url": "https://docs.x402.org/guides/migration-v1-to-v2.md",
    "title": "Migration Guide: V1 to V2",
    "content_type": "text/markdown",
    "content_bytes": 16388,
    "origin_body_sha256": "15bd7640b4031a347a44c74988cb6fcb30f42451c9860e57fd8fb0fa5e189a3f"
  },
  "matcher": "utf8-byte-substring-first-v1",
  "expectations": [
    { "fact_id": "migrate-x402-v2", "field": "contains", "op": "eq", "target": "PAYMENT-RESPONSE", "result": "pass", "span_start": 758, "span_end": 774 },
    { "fact_id": "migrate-x402-v2-signature", "field": "contains", "op": "eq", "target": "PAYMENT-SIGNATURE", "result": "unknown", "code": "not_found" }
  ]
}
```

This embedded manifest is a draft expectation, not a captured proof artifact.
The runnable version must be accompanied by the exact bytes. Load fixture and
manifest once, verify them, and retain immutable in-memory copies for the run.
The buyer must anchor their hashes to its trusted checkout/configuration before
network access. A seller-provided manifest agreeing with a seller-provided hash
is insufficient. Copy the trusted inputs into the evidence directory.

Hash the original unmodified file bytes. No Markdown rendering, trimming, BOM
removal, newline conversion, Unicode normalization, or fetch-on-miss. A snapshot
change requires an explicit new pin and expected-result review. A fixture hash
proves byte identity, not source authorship or current documentation freshness.

## `x402.digital_fact.v1`

The structural contract is [digital-fact.schema.json](digital-fact.schema.json).
The [candidate paid response](examples/digital-fact.response.example.json)
adds `span_end` to the brief's response to make match bounds unambiguous.

Only `schema`, `fact_id`, `source`, and `results` are permitted at the root.
No settlement, transaction, payer, challenge, timestamps, payment headers,
reader metadata, or transport status belongs in this payload. Objects are
closed to unknown fields. Duplicate JSON object names must be rejected before
schema validation. Semantic checks below are mandatory beyond JSON Schema.

For this SKU the root ID is `migrate-x402-v2`; `results` has exactly the two
unique IDs in the manifest, in that order, with exact field/op/target values.
Missing, duplicate, reordered, additional, or substituted results are failures.
All source metadata must equal the independently pinned manifest.

### Evaluation and match bounds

1. Validate strict UTF-8 fixture bytes and the fixture's length and SHA-256.
2. Encode the nonempty target as UTF-8. Find its first exact byte substring.
   Matching is case sensitive, literal, and includes occurrences inside larger
   strings or code blocks. It is not a claim about the meaning of the document.
3. If found, return `result: "pass"`, zero-based inclusive `span_start`, and
   exclusive `span_end = span_start + targetByteLength`. Do not return `code`.
4. If absent, return `result: "unknown", code: "not_found"` and **omit** both
   spans. Null, zero, or `-1` placeholder spans are invalid.
5. Invalid inputs, unsupported operators, corrupt bytes, and evaluator errors
   are execution failures, not `unknown/not_found` evaluations.

`field: "contains", op: "eq"` is the fixed v1 request vocabulary for this
literal membership operation; no regex, negation, or general query language
is introduced. This narrow v1 supports only `pass` and `unknown` result values.
It does not emit a factual `fail` value for absence.

The buyer recomputes every result from its own trusted bytes, including the
first-occurrence offset, target slice, span length, and absence for unknowns.
An arbitrary later matching occurrence is rejected. JavaScript UTF-16 string
indices are not byte offsets. For the proposed first match, `774` is derived
from `758 + 16`; both the starting position and slice still require the bytes.

Evaluation success and factual truth are separate:

| Evaluation | Meaning | Verifier treatment |
| --- | --- | --- |
| `pass` with exact byte bounds | Literal target found | Counts as one passing fact |
| `unknown/not_found`, target independently absent | Evaluation completed; no matching evidence | Counts as one unknown, zero passing facts |
| Missing required `pass`, forged span, false `unknown`, or malformed result | Contract not fulfilled | Verification fails; no closed loop |

Changing `PAYMENT-RESPONSE` text without changing the trusted pin fails fixture
integrity first. In an isolated evaluator test with a deliberately changed
fixture, absence evaluates to `unknown/not_found`; the golden SKU still fails
its required-pass expectation. Never change the pin during a run to repair it.

Serialize results in manifest order and source keys in the documented order,
using UTF-8 compact JSON with no dynamic fields. The seller returns identical
body bytes across successful requests for the same fixture. The buyer saves
those exact bytes and validates the JSON structure and semantics; JSON object
key order is not a factual assertion.

## Integration map for the implementation

| Existing seam | Required change |
| --- | --- |
| `src/resources.ts` | Replace the single route definition; retain one source of truth for route/price |
| `src/index.ts` | Replace the generated report handler with buffered local fixture evaluation |
| `src/catalog.ts`, `src/openapi.json` | Advertise the same path, MIME type, price, and response schema |
| `src/x402guard.ts` | Retain v2 verify/settle ownership; ensure fixture/config failure cannot yield success |
| `scripts/pay_v2_solana.mts` | Reuse SDK/signer helpers in the explicit [buyer state machine](digital-atom-buyer.md) |
| Tests and smoke | Replace `/report` assumptions and assert every failure boundary below |

The existing seller-side settle guard is advisory and fail-open. It is not the
optional buyer-side refuse-before-sign decision. Keep their claims separate.
There is no runtime change to any of these seams in this draft.
