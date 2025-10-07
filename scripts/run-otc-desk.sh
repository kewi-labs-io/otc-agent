#!/bin/bash

echo "🚀 Starting OTC Desk System"
echo "================================"

# Clean up any existing processes
echo "🧹 Cleaning up..."
pkill -f "hardhat node" 2>/dev/null
pkill -f "next dev" 2>/dev/null
pkill -f "elizaos" 2>/dev/null
sleep 2

# Start Hardhat in background
echo "⛓️  Starting Hardhat node..."
(cd contracts && npx hardhat node 2>&1 | tee ../hardhat.log) &
HARDHAT_PID=$!
sleep 5

# Check if contracts need deployment
echo "📝 Checking contracts..."
if [ ! -f "contracts/ignition/deployments/chain-31337/deployed_addresses.json" ]; then
    echo "   Deploying contracts..."
    cd contracts && npx hardhat ignition deploy ./ignition/modules/OTCDesk.ts --network localhost
    cd ..
else
    echo "   Contracts already deployed"
fi

# Ensure database is ready
echo "🗄️  Preparing database..."
npx prisma generate 2>/dev/null

# Start services
echo "🌐 Starting services..."
yarn dev:with-agent &
SERVICES_PID=$!

echo ""
echo "⏳ Waiting for services to start (15 seconds)..."
sleep 15

echo ""
echo "✅ System is running!"
echo ""
echo "🔗 Access points:"
echo "   • Application: http://localhost:2222"
echo "   • elizaOS Agent: http://localhost:3137"
echo "   • Hardhat RPC: http://127.0.0.1:8545"
echo ""
echo "📊 To test the system:"
echo "   1. Visit http://localhost:2222"
echo "   2. View the initial quote"
echo "   3. Click 'Accept Quote' or negotiate in chat"
echo ""
echo "🛑 Press Ctrl+C to stop all services"
echo ""

# Save PIDs
echo "$HARDHAT_PID" > .hardhat.pid
echo "$SERVICES_PID" > .services.pid

# Wait for Ctrl+C
trap 'echo ""; echo "Stopping services..."; kill $HARDHAT_PID $SERVICES_PID 2>/dev/null; pkill -f "hardhat node"; pkill -f "next dev"; pkill -f "elizaos"; exit' INT
wait







