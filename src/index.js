#!/usr/bin/env node
/**
 * mcp-echr — stdio entry point (Claude Code / Claude Desktop).
 *
 * Tool definitions + API client live in ./server.js. Diagnostics go to stderr
 * so they never corrupt the stdio JSON-RPC stream.
 *
 * Config (env): see ./server.js.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer, config } from './server.js';

const server = buildServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `mcp-echr (stdio) ready · ${config.API_BASE} (key ${config.API_KEY ? 'set' : 'none'}) · ` +
  `TLS ${config.INSECURE_TLS ? 'insecure (self-signed OK)' : 'verified'} · timeout ${config.TIMEOUT_MS}ms`
);
