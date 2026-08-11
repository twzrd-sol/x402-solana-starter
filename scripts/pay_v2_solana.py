#!/usr/bin/env python3
"""
v2 Solana mainnet payer for @x402/hono storefronts (this starter).

  python3 scripts/pay_v2_solana.py --url https://HOST/report --keypair /path/to.json

Reads the 402 PAYMENT-REQUIRED header (base64), builds a partial-signed
USDC transferChecked, sends PAYMENT-SIGNATURE on retry.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request

from solders.compute_budget import set_compute_unit_limit, set_compute_unit_price
from solders.hash import Hash
from solders.keypair import Keypair
from solders.message import MessageV0, to_bytes_versioned
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import VersionedTransaction
from spl.token.instructions import (
    TransferCheckedParams,
    get_associated_token_address,
    transfer_checked,
)

TOKEN_PROGRAM = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
USDC_DECIMALS = 6
RPC = os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
UA = {"User-Agent": "x402-solana-starter-pay/1.0", "Accept": "application/json"}


def load_keypair(path: str) -> Keypair:
    raw = json.load(open(path))
    if isinstance(raw, list):
        secret = bytes(raw)
        return Keypair.from_bytes(secret) if len(secret) == 64 else Keypair.from_seed(secret)
    raise SystemExit(f"unsupported keypair format: {path}")


def rpc(method: str, params: list):
    req = urllib.request.Request(
        RPC,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        out = json.loads(resp.read())
    if out.get("error"):
        raise RuntimeError(out["error"])
    return out["result"]


def fetch_accepts(url: str) -> dict:
    req = urllib.request.Request(url, headers=UA)
    try:
        urllib.request.urlopen(req, timeout=20)
        raise SystemExit("expected HTTP 402 from paid route")
    except urllib.error.HTTPError as exc:
        if exc.code != 402:
            raise SystemExit(f"expected 402, got {exc.code}: {exc.read()[:300]}")
        # v2: challenge in PAYMENT-REQUIRED header
        pr_hdr = exc.headers.get("Payment-Required") or exc.headers.get("PAYMENT-REQUIRED")
        if not pr_hdr:
            body = exc.read()
            raise SystemExit(f"402 without PAYMENT-REQUIRED header; body={body[:200]!r}")
        challenge = json.loads(base64.b64decode(pr_hdr))
        accepts = challenge.get("accepts") or []
        if not accepts:
            raise SystemExit(f"no accepts[] in PAYMENT-REQUIRED: {challenge}")
        return accepts[0]


def build_tx_b64(accepts: dict, payer: Keypair) -> str:
    mint = Pubkey.from_string(accepts["asset"])
    pay_to = Pubkey.from_string(accepts["payTo"])
    fee_payer = Pubkey.from_string(accepts["extra"]["feePayer"])
    amount = int(accepts.get("amount") or accepts.get("maxAmountRequired") or 0)
    if amount <= 0:
        raise SystemExit("missing amount")

    bh = rpc("getLatestBlockhash", [{"commitment": "confirmed"}])["value"]["blockhash"]
    blockhash = Hash.from_string(bh)
    ix = transfer_checked(
        TransferCheckedParams(
            program_id=TOKEN_PROGRAM,
            source=get_associated_token_address(payer.pubkey(), mint),
            mint=mint,
            dest=get_associated_token_address(pay_to, mint),
            owner=payer.pubkey(),
            amount=amount,
            decimals=USDC_DECIMALS,
        )
    )
    budget = [set_compute_unit_limit(30_000), set_compute_unit_price(10_000)]
    msg = MessageV0.try_compile(fee_payer, [*budget, ix], [], blockhash)
    wire = to_bytes_versioned(msg)
    sigs = [
        payer.sign_message(wire) if key == payer.pubkey() else Signature.default()
        for key in msg.account_keys[: msg.header.num_required_signatures]
    ]
    return base64.b64encode(bytes(VersionedTransaction.populate(msg, sigs))).decode()


def encode_payment_signature(accepts: dict, tx_b64: str) -> str:
    amount = str(accepts.get("amount") or "0")
    accepted = {
        "scheme": accepts["scheme"],
        "network": accepts["network"],
        "asset": accepts["asset"],
        "amount": amount,
        "payTo": accepts["payTo"],
        "maxTimeoutSeconds": accepts.get("maxTimeoutSeconds", 300),
        "extra": accepts.get("extra") or {},
    }
    payload = {
        "x402Version": 2,
        "payload": {"transaction": tx_b64},
        "accepted": accepted,
    }
    return base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--keypair", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    payer = load_keypair(args.keypair)
    print(f"payer={payer.pubkey()}")
    print(f"url={args.url}")

    accepts = fetch_accepts(args.url)
    print(
        "accepts",
        {
            "network": accepts.get("network"),
            "scheme": accepts.get("scheme"),
            "amount": accepts.get("amount"),
            "payTo": accepts.get("payTo"),
            "feePayer": (accepts.get("extra") or {}).get("feePayer"),
        },
    )

    tx_b64 = build_tx_b64(accepts, payer)
    header = encode_payment_signature(accepts, tx_b64)
    print(f"payment_signature_len={len(header)}")

    if args.dry_run:
        print("dry-run: payment constructed")
        return

    req = urllib.request.Request(
        args.url,
        headers={**UA, "PAYMENT-SIGNATURE": header, "X-PAYMENT": header},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            status = resp.status
            raw = resp.read()
            headers = {k.lower(): v for k, v in resp.headers.items()}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        print(f"SETTLE_HTTP_{exc.code}", body[:1500])
        sys.exit(3)

    print(f"SETTLE_HTTP_{status}")
    try:
        print(json.dumps(json.loads(raw), indent=2)[:2000])
    except Exception:
        print(raw[:500])
    for hk in ("payment-response", "x-payment-response"):
        if hk in headers:
            print(f"{hk}_present=true")
            try:
                pr = json.loads(base64.b64decode(headers[hk]))
                print("payment_response", json.dumps(pr, indent=2)[:800])
            except Exception as e:
                print("payment_response_decode_err", e)


if __name__ == "__main__":
    main()
