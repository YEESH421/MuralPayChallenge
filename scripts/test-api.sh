#!/usr/bin/env bash
# API smoke-test script — runs against a live deployment.
# Usage:
#   ./scripts/test-api.sh                                        # local server, default key
#   ./scripts/test-api.sh https://your-app.railway.app           # deployed URL, default key
#   ./scripts/test-api.sh https://your-app.railway.app my-secret # deployed URL, custom key
#   API_KEY=my-secret ./scripts/test-api.sh https://...          # via env var
#
# Requires: curl, python3
# Exit code: 0 = all tests passed, 1 = one or more failed

BASE="${1:-http://localhost:3000}"
API_KEY="${2:-${API_KEY:-merchant-secret-key}}"
PASS=0
FAIL=0

# ── Helpers ──────────────────────────────────────────────────────────────────

green() { printf '\033[32m✓\033[0m %s\n' "$*"; }
red()   { printf '\033[31m✗\033[0m %s\n' "$*"; }

# assert_contains <test-name> <actual-json> <expected-substring>
assert_contains() {
  local name="$1" body="$2" expected="$3"
  if echo "$body" | grep -q "$expected"; then
    green "$name"
    ((PASS++))
  else
    red "$name"
    echo "    expected to contain: $expected"
    echo "    got: $(echo "$body" | head -c 300)"
    ((FAIL++))
  fi
}

# assert_status <test-name> <actual-status> <expected-status>
assert_status() {
  local name="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    green "$name"
    ((PASS++))
  else
    red "$name"
    echo "    expected HTTP $expected, got HTTP $actual"
    ((FAIL++))
  fi
}

echo ""
echo "Testing: $BASE"
echo "────────────────────────────────────────"

# ── Health ───────────────────────────────────────────────────────────────────

echo ""
echo "[ Health ]"

R=$(curl -s -w "\n%{http_code}" "$BASE/health")
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "GET /health → 200" "$STATUS" "200"
assert_contains "GET /health → ok" "$BODY" '"status":"ok"'

# ── Admin setup + config ──────────────────────────────────────────────────────

echo ""
echo "[ Admin ]"

# Ensure merchant is configured before running any tests that depend on it
echo "  Running POST /admin/setup (idempotent)..."
curl -s -X POST "$BASE/admin/setup" -H "x-api-key: $API_KEY" > /dev/null

R=$(curl -s -w "\n%{http_code}" "$BASE/admin/config" -H "x-api-key: $API_KEY")
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "GET /admin/config → 200" "$STATUS" "200"
assert_contains "GET /admin/config → has muralAccountId" "$BODY" "muralAccountId"
assert_contains "GET /admin/config → has walletAddress" "$BODY" "walletAddress"
assert_contains "GET /admin/config → has counterpartyId" "$BODY" "counterpartyId"
assert_contains "GET /admin/config → has payoutMethodId" "$BODY" "payoutMethodId"

R=$(curl -s -w "\n%{http_code}" "$BASE/admin/config")
STATUS=$(echo "$R" | tail -1)
assert_status "GET /admin/config (no auth) → 401" "$STATUS" "401"

# ── Products ─────────────────────────────────────────────────────────────────

echo ""
echo "[ Products ]"

# Create a product for testing
PRODUCT_JSON=$(curl -s -X POST "$BASE/admin/products" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"name":"Smoke Test Widget","description":"For testing","priceUsdc":25.00,"stock":50}')
PRODUCT_ID=$(echo "$PRODUCT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)

R=$(curl -s -w "\n%{http_code}" "$BASE/products")
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "GET /products → 200" "$STATUS" "200"
assert_contains "GET /products → returns array" "$BODY" "priceUsdc"

if [ -n "$PRODUCT_ID" ]; then
  R=$(curl -s -w "\n%{http_code}" "$BASE/products/$PRODUCT_ID")
  BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
  assert_status "GET /products/:id → 200" "$STATUS" "200"
  assert_contains "GET /products/:id → correct product" "$BODY" "Smoke Test Widget"
fi

R=$(curl -s -w "\n%{http_code}" "$BASE/products/00000000-0000-0000-0000-000000000000")
STATUS=$(echo "$R" | tail -1)
assert_status "GET /products/:id (not found) → 404" "$STATUS" "404"

# ── Orders ───────────────────────────────────────────────────────────────────

echo ""
echo "[ Orders ]"

# POST /orders — missing customer fields
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/orders" \
  -H "Content-Type: application/json" \
  -d '{"customer":{},"items":[]}')
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "POST /orders (missing customer) → 400" "$STATUS" "400"
assert_contains "POST /orders (missing customer) → error message" "$BODY" "required"

# POST /orders — bad product ID
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/orders" \
  -H "Content-Type: application/json" \
  -d '{"customer":{"name":"X","email":"x@x.com"},"items":[{"productId":"00000000-0000-0000-0000-000000000000","quantity":1}]}')
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "POST /orders (bad product) → 400" "$STATUS" "400"
assert_contains "POST /orders (bad product) → error message" "$BODY" "not found"

# POST /orders — valid
if [ -n "$PRODUCT_ID" ]; then
  R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/orders" \
    -H "Content-Type: application/json" \
    -d "{\"customer\":{\"name\":\"Test Buyer\",\"email\":\"buyer-$(date +%s)@test.com\"},\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":2}]}")
  BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
  assert_status "POST /orders (valid) → 201" "$STATUS" "201"
  assert_contains "POST /orders → PENDING_PAYMENT" "$BODY" "PENDING_PAYMENT"
  assert_contains "POST /orders → totalUsdc 50" "$BODY" '"totalUsdc":50'
  assert_contains "POST /orders → walletAddress" "$BODY" "walletAddress"
  assert_contains "POST /orders → instructions" "$BODY" "instructions"
  assert_contains "POST /orders → blockchain POLYGON" "$BODY" "POLYGON"

  ORDER_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['orderId'])" 2>/dev/null)

  # GET /orders/:id
  if [ -n "$ORDER_ID" ]; then
    R=$(curl -s -w "\n%{http_code}" "$BASE/orders/$ORDER_ID")
    BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
    assert_status "GET /orders/:id → 200" "$STATUS" "200"
    assert_contains "GET /orders/:id → orderId" "$BODY" "orderId"
    assert_contains "GET /orders/:id → items with subtotal" "$BODY" "subtotal"
    assert_contains "GET /orders/:id → withdrawal null" "$BODY" '"withdrawal":null'
  fi
fi

R=$(curl -s -w "\n%{http_code}" "$BASE/orders/00000000-0000-0000-0000-000000000000")
STATUS=$(echo "$R" | tail -1)
assert_status "GET /orders/:id (not found) → 404" "$STATUS" "404"

# ── Merchant endpoints ────────────────────────────────────────────────────────

echo ""
echo "[ Merchant ]"

R=$(curl -s -w "\n%{http_code}" "$BASE/merchant/orders")
STATUS=$(echo "$R" | tail -1)
assert_status "GET /merchant/orders (no auth) → 401" "$STATUS" "401"

R=$(curl -s -w "\n%{http_code}" "$BASE/merchant/orders" -H "x-api-key: $API_KEY")
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "GET /merchant/orders → 200" "$STATUS" "200"
assert_contains "GET /merchant/orders → has total" "$BODY" '"total"'
assert_contains "GET /merchant/orders → has orders array" "$BODY" '"orders"'

R=$(curl -s -w "\n%{http_code}" "$BASE/merchant/orders?limit=1&skip=0" -H "x-api-key: $API_KEY")
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "GET /merchant/orders (paginated) → 200" "$STATUS" "200"
assert_contains "GET /merchant/orders (paginated) → limit respected" "$BODY" '"limit":1'

if [ -n "$ORDER_ID" ]; then
  R=$(curl -s -w "\n%{http_code}" "$BASE/merchant/orders/$ORDER_ID" -H "x-api-key: $API_KEY")
  BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
  assert_status "GET /merchant/orders/:id → 200" "$STATUS" "200"
  assert_contains "GET /merchant/orders/:id → subtotal on items" "$BODY" "subtotal"
  assert_contains "GET /merchant/orders/:id → blockchain" "$BODY" "POLYGON"
fi

R=$(curl -s -w "\n%{http_code}" "$BASE/merchant/orders/00000000-0000-0000-0000-000000000000" -H "x-api-key: $API_KEY")
STATUS=$(echo "$R" | tail -1)
assert_status "GET /merchant/orders/:id (not found) → 404" "$STATUS" "404"

R=$(curl -s -w "\n%{http_code}" "$BASE/merchant/withdrawals" -H "x-api-key: $API_KEY")
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "GET /merchant/withdrawals → 200" "$STATUS" "200"
assert_contains "GET /merchant/withdrawals → has total" "$BODY" '"total"'
assert_contains "GET /merchant/withdrawals → has withdrawals array" "$BODY" '"withdrawals"'

R=$(curl -s -w "\n%{http_code}" "$BASE/merchant/withdrawals/00000000-0000-0000-0000-000000000000" -H "x-api-key: $API_KEY")
STATUS=$(echo "$R" | tail -1)
assert_status "GET /merchant/withdrawals/:id (not found) → 404" "$STATUS" "404"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────"
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -gt 0 ]; then
  red "$FAIL test(s) failed"
  exit 1
else
  green "All tests passed"
  exit 0
fi
