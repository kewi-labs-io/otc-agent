#!/bin/bash
# Verification script to ensure Base and BSC support is complete

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔍 Verifying multi-chain support (Base, BSC)..."
echo "📁 Project root: $PROJECT_ROOT"
echo ""

ERRORS=0

# Check for hardcoded "Base" references that should be "EVM"
echo "Checking for hardcoded 'Base' network references..."
HARDCODED_BASE=$(grep -r "Switch to Base\|Connect to Base\|Connected to Base" "$PROJECT_ROOT/src" --include="*.tsx" --include="*.ts" 2>/dev/null | grep -v "// " | wc -l)
if [ "$HARDCODED_BASE" -gt 0 ]; then
  echo "❌ Found $HARDCODED_BASE hardcoded 'Base' references that should be 'EVM'"
  grep -r "Switch to Base\|Connect to Base\|Connected to Base" "$PROJECT_ROOT/src" --include="*.tsx" --include="*.ts" 2>/dev/null | grep -v "// "
  ERRORS=$((ERRORS + 1))
else
  echo "✅ No hardcoded 'Base' network references"
fi

# Check that EVM logo exists
if [ -f "$PROJECT_ROOT/src/components/icons/evm-logo.tsx" ]; then
  echo "✅ EVM logo component exists"
else
  echo "❌ EVM logo component missing"
  ERRORS=$((ERRORS + 1))
fi

# Check that EVM chain selector exists
if [ -f "$PROJECT_ROOT/src/components/evm-chain-selector.tsx" ]; then
  echo "✅ EVM chain selector component exists"
else
  echo "❌ EVM chain selector component missing"
  ERRORS=$((ERRORS + 1))
fi

# Check for BSC logo
if [ -f "$PROJECT_ROOT/src/components/icons/bsc-logo.tsx" ]; then
  echo "✅ BSC logo component exists"
else
  echo "❌ BSC logo component missing"
  ERRORS=$((ERRORS + 1))
fi

# Check multiwallet context has selectedEVMChain
if grep -q "selectedEVMChain" "$PROJECT_ROOT/src/components/multiwallet.tsx"; then
  echo "✅ Multiwallet context has selectedEVMChain state"
else
  echo "❌ Multiwallet context missing selectedEVMChain state"
  ERRORS=$((ERRORS + 1))
fi

# Check chain types include Base and BSC
if grep -q '"base" | "bsc"' "$PROJECT_ROOT/src/types/index.ts"; then
  echo "✅ EVMChain type includes Base and BSC"
else
  echo "❌ EVMChain type incomplete"
  ERRORS=$((ERRORS + 1))
fi

echo ""
if [ $ERRORS -eq 0 ]; then
  echo "✅ All multi-chain support checks passed"
  exit 0
else
  echo "❌ Found $ERRORS issues with multi-chain support"
  exit 1
fi

