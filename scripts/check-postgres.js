#!/usr/bin/env node
// Simple dev bootstrap: ensure a local Postgres is running on port 5439
// If not, attempt to start a Docker container named "eliza-postgres"

const { execSync, spawnSync } = require('node:child_process');
const net = require('node:net');

const DEV_PORT = 5439;
const CONTAINER_NAME = 'eliza-postgres';
const DEFAULT_URL = `postgres://eliza:password@localhost:${DEV_PORT}/eliza`;

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function dockerAvailable() {
  try {
    execSync('docker --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function containerExists(name) {
  try {
    const res = execSync(`docker ps -a --filter name=^/${name}$ --format '{{.Names}}'`, { encoding: 'utf8' }).trim();
    return res === name;
  } catch {
    return false;
  }
}

function containerIsRunning(name) {
  try {
    const res = execSync(`docker ps --filter name=^/${name}$ --format '{{.Names}}'`, { encoding: 'utf8' }).trim();
    return res === name;
  } catch {
    return false;
  }
}

async function main() {
  const hasPostgresUrl = !!process.env.POSTGRES_URL;
  const portOpen = await isPortOpen(DEV_PORT);

  if (hasPostgresUrl) {
    console.log(`[PG] POSTGRES_URL is set; skipping local bootstrap.`);
    return;
  }

  if (portOpen) {
    console.log(`[PG] Postgres already available on port ${DEV_PORT}.`);
    return;
  }

  if (!dockerAvailable()) {
    console.warn(`[PG] Docker not available; cannot auto-start Postgres. Please install Docker or set POSTGRES_URL.`);
    return;
  }

  const exists = containerExists(CONTAINER_NAME);
  const running = exists && containerIsRunning(CONTAINER_NAME);

  if (!exists) {
    console.log(`[PG] Starting local Postgres container '${CONTAINER_NAME}' on port ${DEV_PORT}...`);
    const args = [
      'run', '-d', '--name', CONTAINER_NAME,
      '-e', 'POSTGRES_PASSWORD=password',
      '-e', 'POSTGRES_USER=eliza',
      '-e', 'POSTGRES_DB=eliza',
      '-p', `${DEV_PORT}:5432`,
      'postgres:16-alpine'
    ];
    const res = spawnSync('docker', args, { stdio: 'inherit' });
    if (res.status !== 0) {
      console.warn('[PG] Failed to start Postgres container. You may need to start it manually.');
      return;
    }
  } else if (!running) {
    console.log(`[PG] Starting existing Postgres container '${CONTAINER_NAME}'...`);
    const res = spawnSync('docker', ['start', CONTAINER_NAME], { stdio: 'inherit' });
    if (res.status !== 0) {
      console.warn('[PG] Failed to start Postgres container. You may need to start it manually.');
      return;
    }
  } else {
    console.log(`[PG] Postgres container '${CONTAINER_NAME}' already running.`);
  }

  // Wait for port
  for (let i = 0; i < 20; i++) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortOpen(DEV_PORT)) {
      console.log(`[PG] Postgres is ready at ${DEFAULT_URL}`);
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 500));
  }
  console.warn('[PG] Postgres did not become ready in time.');
}

main().catch((err) => {
  console.error('[PG] Error bootstrapping Postgres:', err);
});


