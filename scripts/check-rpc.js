#!/usr/bin/env node

import { spawn } from 'child_process';
import http from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables from .env.local
function loadEnvFile() {
  try {
    const envPath = join(process.cwd(), '.env.local');
    const envContent = readFileSync(envPath, 'utf8');
    const envVars = {};
    
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          envVars[key.trim()] = value.trim();
        }
      }
    });
    
    // Set env vars
    Object.assign(process.env, envVars);
  } catch (e) {
    // .env.local might not exist, that's ok
  }
}

// Load env vars before checking
loadEnvFile();

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
  // Check if we're using a production network (skip Anvil)
  const network = process.env.NETWORK || process.env.NEXT_PUBLIC_JEJU_NETWORK || 'localnet';
  const isProductionNetwork = ['base', 'bsc', 'jeju-mainnet', 'mainnet'].includes(network);
  
  if (isProductionNetwork) {
    console.log(`✅ Using production network: ${network}`);
    console.log('   Skipping Anvil RPC setup');
    process.exit(0);
    return;
  }
  
  console.log('🔍 Checking if Anvil RPC is running on localhost:8545...');
  const isRunning = await checkRPC();

  if (isRunning) {
    console.log('✅ Anvil RPC is running');
    console.log('📝 You can interact with the OTC Desk contract.');
    process.exit(0);
    return;
  }

  console.log('❌ Anvil RPC is not running. Starting in background...');
  try {
    const child = spawn('npm', ['run', 'rpc:start'], { stdio: 'ignore', shell: true, detached: true });
    child.unref();
    // Give it a moment to boot
    await new Promise((r) => setTimeout(r, 4000));
  } catch (e) {
    console.log('⚠️  Failed to auto-start Anvil. Please run: ./scripts/start-anvil.sh');
  }

  // Re-check but do not fail the whole dev script
  const ok = await checkRPC();
  if (ok) {
    console.log('✅ Anvil RPC started.');
  } else {
    console.log('⚠️  Anvil still not responding; continuing dev server startup.');
  }
  process.exit(0);
}

main();