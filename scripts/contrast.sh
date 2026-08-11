#!/usr/bin/env bash
# Wedge differentiator: TWZRD must pass smoke; x402.org must fail for network: solana.
# Ported from x402-seller-starter's contrast.sh — only the env var name changed
# (X402_FACILITATOR_URL, not FACILITATOR_URL), same logic.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== TWZRD facilitator (must PASS) ==="
X402_FACILITATOR_URL="${X402_FACILITATOR_URL:-https://intel.twzrd.xyz}" npm run smoke

echo ""
echo "=== x402.org facilitator (must FAIL for mainnet solana) ==="
set +e
X402_FACILITATOR_URL=https://x402.org/facilitator npm run smoke
org_status=$?
set -e

echo ""
echo "=== contrast verdict ==="
if [[ "$org_status" -eq 0 ]]; then
  echo "  x402.org mainnet smoke: PASS (unexpected — wedge claim broken)"
  exit 1
fi
echo "  x402.org mainnet smoke: FAIL (expected — TWZRD is the only sponsor here)"
echo "  wedge holds."
