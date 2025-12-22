#!/usr/bin/env bun

/**
 * Migration fix script
 *
 * Fixes inconsistent migration state in the database by:
 * 1. Dropping conflicting constraints/indexes that block migrations
 * 2. Resetting the migration tracker for @elizaos/plugin-sql
 * 3. Allowing the system to re-migrate cleanly
 *
 * Usage: bun scripts/fix-migrations.ts
 */

import dotenv from "dotenv";
import pg from "pg";

// Load env
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const port = process.env.POSTGRES_DEV_PORT || process.env.VENDOR_OTC_DESK_DB_PORT || 5439;
const DEFAULT_POSTGRES_URL = `postgres://eliza:password@localhost:${port}/eliza`;

let postgresUrl: string;
if (process.env.DATABASE_POSTGRES_URL) {
  postgresUrl = process.env.DATABASE_POSTGRES_URL;
} else if (process.env.DATABASE_URL_UNPOOLED) {
  postgresUrl = process.env.DATABASE_URL_UNPOOLED;
} else if (process.env.POSTGRES_URL) {
  postgresUrl = process.env.POSTGRES_URL;
} else if (process.env.POSTGRES_DATABASE_URL) {
  postgresUrl = process.env.POSTGRES_DATABASE_URL;
} else {
  postgresUrl = DEFAULT_POSTGRES_URL;
}

if (!postgresUrl) {
  throw new Error(
    "Database URL is required. Set one of: DATABASE_POSTGRES_URL, DATABASE_URL_UNPOOLED, POSTGRES_URL, or POSTGRES_DATABASE_URL",
  );
}

const isRemote = !postgresUrl.includes("localhost") && !postgresUrl.includes("127.0.0.1");

console.log(`🔧 Migration Fix Script`);
console.log(`📍 Database: ${isRemote ? "Remote (Vercel/Neon)" : `Local (port ${port})`}`);
console.log("");

async function main() {
  const pool = new pg.Pool({
    connectionString: postgresUrl,
    ssl: isRemote ? { rejectUnauthorized: false } : false,
    max: 1,
  });

  const client = await pool.connect();

  // Step 1: Check for the conflicting constraint
  console.log("1️⃣  Checking for conflicting constraints...");

  const constraintsResult = await client.query(`
      SELECT constraint_name, table_name, constraint_type
      FROM information_schema.table_constraints 
      WHERE constraint_name LIKE '%server_agents%'
    `);

  if (constraintsResult.rows.length > 0) {
    console.log(`   Found ${constraintsResult.rows.length} conflicting constraint(s):`);
    for (const c of constraintsResult.rows) {
      console.log(`   - ${c.constraint_name} on ${c.table_name} (${c.constraint_type})`);
    }
  } else {
    console.log("   No conflicting constraints found in information_schema");
  }

  // Step 2: Check for the server_agents table
  console.log("\n2️⃣  Checking for server_agents table...");

  const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'server_agents'
    `);

  if (tablesResult.rows.length > 0) {
    console.log("   Table 'server_agents' exists");

    // Drop the table entirely since it's in an inconsistent state
    console.log("   Dropping server_agents table...");
    await client.query(`DROP TABLE IF EXISTS public.server_agents CASCADE`);
    console.log("   Dropped server_agents table");
  } else {
    console.log("   Table 'server_agents' does not exist");
  }

  // Step 2b: Check for message_server_agents table (the migration wants to drop this)
  console.log("\n2b️⃣  Checking for message_server_agents table...");

  const messageServerAgentsTableResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'message_server_agents'
    `);

  if (messageServerAgentsTableResult.rows.length > 0) {
    console.log("   Table 'message_server_agents' exists");

    // The migration will drop this table, but the constraints have conflicting names
    // with the new server_agents table. Drop the constraints first.
    console.log("   Dropping message_server_agents constraints...");

    // Drop foreign key constraints first
    await client.query(`
        ALTER TABLE IF EXISTS public.message_server_agents 
        DROP CONSTRAINT IF EXISTS server_agents_server_id_message_servers_id_fk CASCADE
      `);
    await client.query(`
        ALTER TABLE IF EXISTS public.message_server_agents 
        DROP CONSTRAINT IF EXISTS server_agents_agent_id_agents_id_fk CASCADE
      `);

    // Now drop the primary key constraint (which also drops the index)
    await client.query(`
        ALTER TABLE IF EXISTS public.message_server_agents 
        DROP CONSTRAINT IF EXISTS server_agents_server_id_agent_id_pk CASCADE
      `);

    console.log("   Dropped conflicting constraints from message_server_agents");

    // Now drop the entire table since the migration will recreate it with different structure
    console.log("   Dropping message_server_agents table...");
    await client.query(`DROP TABLE IF EXISTS public.message_server_agents CASCADE`);
    console.log("   Dropped message_server_agents table");
  } else {
    console.log("   Table 'message_server_agents' does not exist");
  }

  // Step 3: Check for the constraint index directly in pg_class
  console.log("\n3️⃣  Checking for orphaned indexes...");

  const indexesResult = await client.query(`
      SELECT indexname, tablename 
      FROM pg_indexes 
      WHERE indexname LIKE '%server_agents%'
    `);

  if (indexesResult.rows.length > 0) {
    console.log(`   Found ${indexesResult.rows.length} index(es):`);
    for (const idx of indexesResult.rows) {
      console.log(`   - ${idx.indexname} on ${idx.tablename}`);
      // Drop the index
      await client.query(`DROP INDEX IF EXISTS "${idx.indexname}" CASCADE`);
      console.log(`   Dropped index ${idx.indexname}`);
    }
  } else {
    console.log("   No orphaned indexes found");
  }

  // Step 4: Reset migration tracker for plugin-sql
  console.log("\n4️⃣  Resetting migration tracker...");

  // Check if migrations schema exists
  const migrationSchemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = 'migrations'
    `);

  if (migrationSchemaResult.rows.length > 0) {
    console.log("   migrations schema exists, cleaning up...");

    // Delete plugin-sql entries from migration tracker tables
    await client.query(
      `DELETE FROM migrations._migrations WHERE plugin_name = '@elizaos/plugin-sql'`,
    );
    await client.query(`DELETE FROM migrations._journal WHERE plugin_name = '@elizaos/plugin-sql'`);
    await client.query(
      `DELETE FROM migrations._snapshots WHERE plugin_name = '@elizaos/plugin-sql'`,
    );

    console.log("   Cleared @elizaos/plugin-sql migration history");
  } else {
    console.log("   migrations schema does not exist (will be created on first run)");
  }

  // Step 5: Fix message_server_agents table if it exists
  console.log("\n5️⃣  Checking for message_server_agents table...");

  const messageServerAgentsResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'message_server_agents'
    `);

  if (messageServerAgentsResult.rows.length > 0) {
    console.log("   Table 'message_server_agents' exists (will be dropped by migration)");
  } else {
    console.log("   Table 'message_server_agents' does not exist");
  }

  // Step 6: Check channels table columns
  console.log("\n6️⃣  Checking channels table columns...");

  const channelColumnsResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'channels'
    `);

  if (channelColumnsResult.rows.length > 0) {
    const colNames = channelColumnsResult.rows.map((c: { column_name: string }) => c.column_name);
    console.log(`   Columns: ${colNames.join(", ")}`);

    // Check for the columns that the migration wants to add/remove
    if (colNames.includes("message_server_id")) {
      console.log("   message_server_id exists (will be dropped by migration)");
    }
    if (colNames.includes("server_id")) {
      console.log("   server_id already exists");
    } else {
      console.log("   server_id does NOT exist (will be added by migration)");
    }
  } else {
    console.log("   channels table does not exist or has no columns");
  }

  console.log("\nMigration fix complete");
  console.log("   Run your development server again to apply migrations cleanly.");

  client.release();
  await pool.end();
}

main();
