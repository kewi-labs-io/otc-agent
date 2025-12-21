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
# Run all tests from tests/ folder (excludes contracts/lib OpenZeppelin tests)
bun test tests/
echo ""

echo "=== All Tests Complete ==="
