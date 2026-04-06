#!/usr/bin/env bash
# API smoke-test script — runs against a live deployment.
#
# Usage:
#   ./scripts/test-api.sh                                        # local server, default key
#   ./scripts/test-api.sh https://your-app.railway.app           # deployed URL, default key
#   ./scripts/test-api.sh https://your-app.railway.app my-secret # deployed URL, custom key
#   API_KEY=my-secret ./scripts/test-api.sh https://...          # via env var
#
# Requires: curl, python3
# Exit code: 0 = all tests passed, 1 = one or more failed
#
# ── How this script works ─────────────────────────────────────────────────────
#
# Each section hits a group of related endpoints in sequence. Fixtures created
# early (product, order) are reused by later tests via shell variables so the
# whole suite is self-contained and leaves no hard-coded IDs.
#
# assert_status  checks that the HTTP status code matches the expected value.
# assert_contains checks that the response body contains an expected substring.
# Both helpers print ✓ / ✗, increment PASS / FAIL counters, and show a diff on
# failure. The final summary exits 0 only if every assertion passed.
#
# Section order:
#   1. Health       — sanity-check that the server is up at all
#   2. Admin        — run one-time merchant setup (idempotent), then read config
#   3. Products     — create a test product, list all, fetch by ID, 404 path
#   4. Orders       — validation errors, happy-path order creation, read-back
#   5. Merchant     — auth-gated dashboard endpoints for orders and withdrawals
# ─────────────────────────────────────────────────────────────────────────────

BASE="${1:-http://localhost:3000}"
API_KEY="${2:-${API_KEY:-merchant-secret-key}}"
PASS=0
FAIL=0

# ── Helpers ──────────────────────────────────────────────────────────────────

green() { printf '\033[32m✓\033[0m %s\n' "$*"; }
red()   { printf '\033[31m✗\033[0m %s\n' "$*"; }

# assert_contains <test-name> <actual-json> <expected-substring>
# Passes if <expected-substring> appears anywhere in <actual-json>.
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
# Passes if the HTTP status code matches exactly.
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

# ── 1. Health ─────────────────────────────────────────────────────────────────
# Confirms the server is reachable and the health endpoint responds correctly
# before anything else runs.

echo ""
echo "[ Health ]"

R=$(curl -s -w "\n%{http_code}" "$BASE/health")
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "GET /health → 200" "$STATUS" "200"
assert_contains "GET /health → ok" "$BODY" '"status":"ok"'

# ── 2. Admin setup + config ───────────────────────────────────────────────────
# POST /admin/setup runs the one-time Mural onboarding (create account,
# counterparty, payout method, webhook). It is idempotent — safe to call on
# every test run. Without this the merchant config is empty and order creation
# returns 503, so it must succeed before the Orders section runs.
#
# GET /admin/config then reads back the stored config and asserts all four key
# fields are present. A request without the API key must be rejected with 401.

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

# Admin endpoints require authentication
R=$(curl -s -w "\n%{http_code}" "$BASE/admin/config")
STATUS=$(echo "$R" | tail -1)
assert_status "GET /admin/config (no auth) → 401" "$STATUS" "401"

# ── 3. Products ───────────────────────────────────────────────────────────────
# Creates a fresh "Smoke Test Widget" at $25 USDC so later order tests have a
# real product ID to work with. The ID is parsed from the creation response and
# stored in PRODUCT_ID for reuse. Then the public listing and fetch-by-ID
# endpoints are verified, plus a 404 on a nonexistent UUID.

echo ""
echo "[ Products ]"

# Create a test product and capture its ID for use in the Orders section
PRODUCT_JSON=$(curl -s -X POST "$BASE/admin/products" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"name":"Smoke Test Widget","description":"For testing","priceUsdc":25.00,"stock":50}')
PRODUCT_ID=$(echo "$PRODUCT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)

# Public product listing should return an array that includes priceUsdc
R=$(curl -s -w "\n%{http_code}" "$BASE/products")
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "GET /products → 200" "$STATUS" "200"
assert_contains "GET /products → returns array" "$BODY" "priceUsdc"

# Fetch the specific product created above by its ID
if [ -n "$PRODUCT_ID" ]; then
  R=$(curl -s -w "\n%{http_code}" "$BASE/products/$PRODUCT_ID")
  BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
  assert_status "GET /products/:id → 200" "$STATUS" "200"
  assert_contains "GET /products/:id → correct product" "$BODY" "Smoke Test Widget"
fi

# A nonexistent product ID must return 404
R=$(curl -s -w "\n%{http_code}" "$BASE/products/00000000-0000-0000-0000-000000000000")
STATUS=$(echo "$R" | tail -1)
assert_status "GET /products/:id (not found) → 404" "$STATUS" "404"

# ── 4. Orders ─────────────────────────────────────────────────────────────────
# Tests the full order lifecycle:
#
#   a) Validation — missing customer fields must return 400 with an error
#      message containing "required".
#   b) Validation — a nonexistent product ID must return 400 with "not found"
#      (this test specifically caught a bug where merchant-config was checked
#      before products, causing 503 instead of 400).
#   c) Happy path — order 2× Smoke Test Widget ($25 each = $50 total). The
#      response is checked for status PENDING_PAYMENT, correct totalUsdc, the
#      merchant's POLYGON wallet address, human-readable payment instructions,
#      and blockchain = POLYGON.
#   d) Read-back — the newly created order is fetched by ID and checked for
#      line-item subtotals and a null withdrawal (no payout has happened yet).
#   e) 404 on a nonexistent order ID.
#
# Steps (c) and (d) are skipped if product creation failed (PRODUCT_ID empty).

echo ""
echo "[ Orders ]"

# a) Missing customer fields — must be rejected before hitting the database
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/orders" \
  -H "Content-Type: application/json" \
  -d '{"customer":{},"items":[]}')
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "POST /orders (missing customer) → 400" "$STATUS" "400"
assert_contains "POST /orders (missing customer) → error message" "$BODY" "required"

# b) Nonexistent product ID — product lookup must fail before merchant config is checked
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/orders" \
  -H "Content-Type: application/json" \
  -d '{"customer":{"name":"X","email":"x@x.com"},"items":[{"productId":"00000000-0000-0000-0000-000000000000","quantity":1}]}')
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "POST /orders (bad product) → 400" "$STATUS" "400"
assert_contains "POST /orders (bad product) → error message" "$BODY" "not found"

# c) Valid order: 2× $25 widget = $50 total. Uses a unique email to avoid conflicts.
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

  # Capture the order ID for the read-back and merchant tests below
  ORDER_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['orderId'])" 2>/dev/null)

  # d) Read the order back and verify its shape
  if [ -n "$ORDER_ID" ]; then
    R=$(curl -s -w "\n%{http_code}" "$BASE/orders/$ORDER_ID")
    BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
    assert_status "GET /orders/:id → 200" "$STATUS" "200"
    assert_contains "GET /orders/:id → orderId" "$BODY" "orderId"
    assert_contains "GET /orders/:id → items with subtotal" "$BODY" "subtotal"
    # No payout has been triggered yet so withdrawal must be null
    assert_contains "GET /orders/:id → withdrawal null" "$BODY" '"withdrawal":null'
  fi
fi

# e) Nonexistent order ID must return 404
R=$(curl -s -w "\n%{http_code}" "$BASE/orders/00000000-0000-0000-0000-000000000000")
STATUS=$(echo "$R" | tail -1)
assert_status "GET /orders/:id (not found) → 404" "$STATUS" "404"

# ── 5. Merchant endpoints ─────────────────────────────────────────────────────
# These are auth-gated dashboard endpoints only the merchant can call.
#
# Orders dashboard:
#   - Unauthenticated request must return 401.
#   - Authenticated list returns a paginated envelope with "total" and "orders".
#   - Pagination: limit=1 must be reflected in the response's "limit" field.
#   - If a test order was created above, fetch it by ID and verify subtotals
#     and the blockchain field are present in the merchant view.
#   - Nonexistent ID must return 404.
#
# Withdrawals dashboard:
#   - Authenticated list returns "total" and "withdrawals".
#   - Nonexistent ID must return 404.

echo ""
echo "[ Merchant ]"

# Unauthenticated request must be rejected
R=$(curl -s -w "\n%{http_code}" "$BASE/merchant/orders")
STATUS=$(echo "$R" | tail -1)
assert_status "GET /merchant/orders (no auth) → 401" "$STATUS" "401"

# Full order list with pagination envelope
R=$(curl -s -w "\n%{http_code}" "$BASE/merchant/orders" -H "x-api-key: $API_KEY")
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "GET /merchant/orders → 200" "$STATUS" "200"
assert_contains "GET /merchant/orders → has total" "$BODY" '"total"'
assert_contains "GET /merchant/orders → has orders array" "$BODY" '"orders"'

# Pagination: requesting limit=1 must echo that limit in the response
R=$(curl -s -w "\n%{http_code}" "$BASE/merchant/orders?limit=1&skip=0" -H "x-api-key: $API_KEY")
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "GET /merchant/orders (paginated) → 200" "$STATUS" "200"
assert_contains "GET /merchant/orders (paginated) → limit respected" "$BODY" '"limit":1'

# Fetch the test order through the merchant view
if [ -n "$ORDER_ID" ]; then
  R=$(curl -s -w "\n%{http_code}" "$BASE/merchant/orders/$ORDER_ID" -H "x-api-key: $API_KEY")
  BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
  assert_status "GET /merchant/orders/:id → 200" "$STATUS" "200"
  assert_contains "GET /merchant/orders/:id → subtotal on items" "$BODY" "subtotal"
  assert_contains "GET /merchant/orders/:id → blockchain" "$BODY" "POLYGON"
fi

# Nonexistent order ID must return 404
R=$(curl -s -w "\n%{http_code}" "$BASE/merchant/orders/00000000-0000-0000-0000-000000000000" -H "x-api-key: $API_KEY")
STATUS=$(echo "$R" | tail -1)
assert_status "GET /merchant/orders/:id (not found) → 404" "$STATUS" "404"

# Withdrawals list — no payouts have been triggered so the list may be empty,
# but the envelope shape must still be correct
R=$(curl -s -w "\n%{http_code}" "$BASE/merchant/withdrawals" -H "x-api-key: $API_KEY")
BODY=$(echo "$R" | head -1); STATUS=$(echo "$R" | tail -1)
assert_status "GET /merchant/withdrawals → 200" "$STATUS" "200"
assert_contains "GET /merchant/withdrawals → has total" "$BODY" '"total"'
assert_contains "GET /merchant/withdrawals → has withdrawals array" "$BODY" '"withdrawals"'

# Nonexistent withdrawal ID must return 404
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
