#!/usr/bin/env bash
# Wedge differentiator (v2 storefront):
#   TWZRD facilitator must pass smoke (Solana mainnet CAIP-2 + feePayer).
#   x402.org/facilitator must FAIL for solana:5eykt4… (no mainnet kind).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== TWZRD facilitator (must PASS) ==="
# set -e: failure here aborts the contrast (TWZRD must work).
X402_FACILITATOR_URL="${X402_FACILITATOR_URL:-https://intel.twzrd.xyz}" npm run smoke

echo ""
echo "=== x402.org facilitator (must FAIL for Solana mainnet) ==="
set +e
X402_FACILITATOR_URL=https://x402.org/facilitator npm run smoke
org_status=$?
set -e

echo ""
echo "=== contrast verdict ==="
if [[ "$org_status" -eq 0 ]]; then
  echo "  TWZRD mainnet smoke: PASS"
  echo "  x402.org mainnet smoke: PASS (unexpected — wedge claim broken)"
  exit 1
fi
echo "  TWZRD mainnet smoke: PASS"
echo "  x402.org mainnet smoke: FAIL (expected — no solana:5eykt4… kind)"
echo ""
echo "OK - wedge holds: stock x402.org facilitator cannot sell Solana mainnet; TWZRD can."
