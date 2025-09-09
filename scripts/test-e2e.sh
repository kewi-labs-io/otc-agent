#!/bin/bash

# E2E Testing Script for OTC Desk
# This script sets up the environment and runs Cypress tests

echo "🧪 Starting OTC Desk E2E Tests..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if dev server is running
if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo -e "${YELLOW}Development server not running. Starting...${NC}"
    yarn dev > /dev/null 2>&1 &
    DEV_PID=$!
    echo "Waiting for server to start..."
    sleep 10
    
    # Check again
    if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo -e "${RED}Failed to start development server${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Development server started (PID: $DEV_PID)${NC}"
else
    echo -e "${GREEN}✓ Development server already running${NC}"
fi

# Check if Hardhat is running
if ! curl -s http://localhost:8545 > /dev/null 2>&1; then
    echo -e "${YELLOW}Hardhat node not running. Starting...${NC}"
    cd contracts
    npx hardhat node > /dev/null 2>&1 &
    HARDHAT_PID=$!
    cd ..
    sleep 5
    echo -e "${GREEN}✓ Hardhat node started (PID: $HARDHAT_PID)${NC}"
    
    # Deploy contracts
    echo -e "${YELLOW}Deploying contracts...${NC}"
    cd contracts
    npx hardhat run scripts/deploy.ts --network localhost > /dev/null 2>&1
    cd ..
    echo -e "${GREEN}✓ Contracts deployed${NC}"
else
    echo -e "${GREEN}✓ Hardhat node already running${NC}"
fi

# Start the quote approval worker
echo -e "${YELLOW}Starting quote approval worker...${NC}"
curl -X POST http://localhost:3000/api/worker/quote-approval \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-api-secret-change-in-production" \
  -d '{"action": "start"}' \
  > /dev/null 2>&1

echo -e "${GREEN}✓ Worker started${NC}"

# Run Cypress tests
echo -e "${YELLOW}Running Cypress tests...${NC}"
echo ""

if [ "$1" == "--open" ]; then
    # Open Cypress GUI
    yarn cypress:open
else
    # Run tests headlessly
    yarn cypress:run
    TEST_EXIT_CODE=$?
fi

# Cleanup
echo ""
echo -e "${YELLOW}Cleaning up...${NC}"

# Stop worker
curl -X POST http://localhost:3000/api/worker/quote-approval \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-api-secret-change-in-production" \
  -d '{"action": "stop"}' \
  > /dev/null 2>&1

# Stop servers if we started them
if [ ! -z "$DEV_PID" ]; then
    kill $DEV_PID 2>/dev/null
    echo -e "${GREEN}✓ Stopped development server${NC}"
fi

if [ ! -z "$HARDHAT_PID" ]; then
    kill $HARDHAT_PID 2>/dev/null
    echo -e "${GREEN}✓ Stopped Hardhat node${NC}"
fi

# Exit with test result code
if [ ! -z "$TEST_EXIT_CODE" ]; then
    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo -e "${GREEN}✅ All tests passed!${NC}"
    else
        echo -e "${RED}❌ Some tests failed${NC}"
    fi
    exit $TEST_EXIT_CODE
fi










