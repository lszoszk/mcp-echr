#!/usr/bin/env node
/**
 * mcp-echr — HTTP (Streamable HTTP) entry point.
 *
 * Serves the same seven tools as the stdio entry over MCP's Streamable HTTP transport, so remote
 * clients (claude.ai custom connectors, Claude Code with --transport http, Cowork) can reach it at
 * a URL. Stateless: a fresh server + transport per request, which is safe because the tools hold no
 * session state; answers are plain JSON (no SSE stream), so any HTTP proxy can forward them.
 *
 * On the HUDOC Researcher VM it runs in a container on the API's Docker network with no published
 * port; the API forwards https://<host>/echr-api/mcp to it.
 *
 * Config (env):
 *   PORT            listen port              (default 8007)
 *   HOST            bind address             (default 0.0.0.0 — reachable only on the Docker network)
 *   MCP_AUTH_TOKEN  optional bearer token; when set, requests must send
 *                   `Authorization: Bearer <token>` or `X-API-Key: <token>`
 *   MCP_GUIDE_URL   page a browser GET is pointed to
 *   plus the ECHR_* vars consumed by ./server.js (ECHR_API_BASE: the API, e.g. http://echr-api:8000/api)
 */
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer, config } from './server.js';

const PORT = Number(process.env.PORT || 8007);
const HOST = process.env.HOST || '0.0.0.0';
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || '';
const GUIDE_URL = process.env.MCP_GUIDE_URL || 'https://lszoszk.github.io/ECHR-Dashboard/about.html#mcp';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'mcp-echr', transport: 'streamable-http', api: config.API_BASE });
});

function authorized(req) {
  if (!AUTH_TOKEN) return true;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.replace(/^Bearer\s+/i, '').trim() === AUTH_TOKEN) return true;
  return req.headers['x-api-key'] === AUTH_TOKEN;
}

const jsonRpcError = (res, status, code, message) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

app.post('/mcp', async (req, res) => {
  if (!authorized(req)) return jsonRpcError(res, 401, -32001, 'Unauthorized');
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp-http] request error:', err);
    if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal server error');
  }
});

// A person who pastes the connector address into a browser gets a short page instead of the
// JSON-RPC 405 the Streamable HTTP spec requires for GET; MCP clients never ask for text/html.
const wantsHtml = (req) => String(req.headers.accept || '').includes('text/html');
app.get('/mcp', (req, res) => {
  if (wantsHtml(req)) {
    return res.type('html').send(`<!doctype html><meta charset="utf-8"><title>HUDOC Researcher · MCP</title>
<body style="font:16px/1.5 Georgia,serif;max-width:640px;margin:48px auto;padding:0 16px;color:#242328">
<h1 style="font-weight:500">HUDOC Researcher — MCP connector</h1>
<p>This address is for AI assistants, not for a browser. Add it as a custom connector in Claude
(Settings → Connectors → Add custom connector) or in Claude Code:
<code>claude mcp add --transport http echr https://150.254.115.204/echr-api/mcp</code></p>
<p><a href="${GUIDE_URL}">How to set it up</a> · <a href="https://lszoszk.github.io/ECHR-Dashboard/">HUDOC Researcher</a></p></body>`);
  }
  return jsonRpcError(res, 405, -32000, 'Method not allowed (stateless server: use POST /mcp).');
});
app.delete('/mcp', (_req, res) => jsonRpcError(res, 405, -32000, 'Method not allowed (stateless server).'));

app.listen(PORT, HOST, () => {
  console.error(`mcp-echr (streamable-http) on http://${HOST}:${PORT}/mcp · API ${config.API_BASE}`);
});
