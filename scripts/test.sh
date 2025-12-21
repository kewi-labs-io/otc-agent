#!/bin/bash
# Run all tests
# 
# Contract tests: Run directly with forge (no infrastructure needed)
# Unit/Integration tests: Run with bun test
#
# Set TEARDOWN_POSTGRES=true to also stop the database after tests

set -e

cd "$(dirname "$0")/.."

echo "Running all tests..."
echo ""

# ============================================
# 1. Contract Tests (no infrastructure needed)
# ============================================
echo "=== Contract Tests (Forge) ==="
cd contracts && forge test --summary
cd ..
echo ""

# ============================================
# 2. Unit/Integration Tests (bun test)
# ============================================
echo "=== Unit/Integration Tests (bun test) ==="
bun test tests/shared-utils.e2e.test.ts
echo ""

echo "=== All Tests Complete ==="
