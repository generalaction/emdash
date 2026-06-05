#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { generateApiKey } from './crypto.js';
import { defaultConfigPath, defaultDbPath, loadConfig, saveConfig } from './config.js';
import { initDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildServer } from './server.js';

const { positionals } = parseArgs({ allowPositionals: true });
const command = positionals[0] ?? 'start';

async function init(): Promise<void> {
  const configPath = defaultConfigPath();
  if (existsSync(configPath)) {
    console.log(`Config already exists at ${configPath}`);
    return;
  }
  const config = {
    apiKey: generateApiKey(),
    port: 8080,
    host: '0.0.0.0',
    dbPath: defaultDbPath(),
    signingSecrets: {},
    routes: [],
  };
  saveConfig(config);
  console.log(`✓ Initialized emdash-server`);
  console.log(`  Config: ${configPath}`);
  console.log(`  API key: ${config.apiKey}`);
  console.log(`  DB: ${config.dbPath}`);
  console.log(`\nAdd this server in Emdash Settings → emdash-server.`);
  console.log(`Run 'emdash-server start' to start the server.`);
}

async function start(): Promise<void> {
  const config = loadConfig();
  initDb(config.dbPath);
  runMigrations();
  const app = buildServer(config);
  await app.listen({ port: config.port, host: config.host });
  console.log(`emdash-server listening on ${config.host}:${config.port}`);
}

if (command === 'init') {
  await init();
} else if (command === 'start') {
  await start();
} else {
  console.error(`Unknown command: ${command}. Use: init | start`);
  process.exit(1);
}
