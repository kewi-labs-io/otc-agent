#!/usr/bin/env node

import http from 'http';

function checkRPC() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 8545,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const data = JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      id: 1
    });

    const req = http.request(options, (res) => {
      if (res.statusCode === 200) {
        resolve(true);
      } else {
        resolve(false);
      }
    });

    req.on('error', () => {
      resolve(false);
    });

    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('🔍 Checking if Hardhat RPC is running on localhost:8545...');
  
  const isRunning = await checkRPC();
  
  if (isRunning) {
    console.log('✅ Hardhat RPC is running!');
    console.log('📝 You can interact with the OTC Desk contract.');
  } else {
    console.log('⚠️  Hardhat RPC is not running!');
    console.log('');
    console.log('To start the local blockchain and deploy contracts, run:');
    console.log('');
    console.log('  npm run dev:with-rpc');
    console.log('');
    console.log('Or run these commands in separate terminals:');
    console.log('  1. cd contracts && npm run start');
    console.log('  2. cd contracts && npm run deploy:local');
    console.log('  3. npm run dev');
    console.log('');
  }
  
  process.exit(isRunning ? 0 : 1);
}

main();