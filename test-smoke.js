// Smoke test: spawn the server over stdio, list tools, exercise each one.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'node', args: ['src/index.js'] });
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const show = (label, r, n = 700) =>
  console.log(`\n--- ${label} ---\n` + (r.isError ? 'ERROR: ' : '') + r.content[0].text.slice(0, n));

const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));

show('echr_stats', await client.callTool({ name: 'echr_stats', arguments: {} }), 400);

show('echr_facets (top 5)', await client.callTool({
  name: 'echr_facets', arguments: { top: 5 },
}), 900);

const s = await client.callTool({
  name: 'echr_search',
  arguments: { query: '"necessary in a democratic society"', articles: ['11'], limit: 2 },
});
show('echr_search (group=case · Art. 11)', s, 1100);

show('echr_search (group=paragraph)', await client.callTool({
  name: 'echr_search',
  arguments: { query: 'solitary confinement', group: 'paragraph', sections: ['Merits'], limit: 2 },
}), 1000);

// Chain: pull a case_id out of the search output and drive the case tools with it.
const caseId = (s.content[0].text.match(/case_id:\s*([0-9-]+)/) || [])[1];
console.log(`\n(chaining on case_id ${caseId})`);
if (caseId) {
  show('echr_get_case', await client.callTool({ name: 'echr_get_case', arguments: { case_id: caseId } }), 900);
  show('echr_get_paragraphs (Merits, 3)', await client.callTool({
    name: 'echr_get_paragraphs', arguments: { case_id: caseId, sections: ['Merits'], limit: 3 },
  }), 900);
  show('echr_cited_by', await client.callTool({ name: 'echr_cited_by', arguments: { case_id: caseId, limit: 3 } }), 600);
  show('echr_cites', await client.callTool({ name: 'echr_cites', arguments: { case_id: caseId, limit: 3 } }), 600);
}

// Error path: a bad id must fail with an actionable message, not a stack trace.
show('echr_get_case (bad id)', await client.callTool({
  name: 'echr_get_case', arguments: { case_id: '001-does-not-exist' },
}), 300);

await client.close();
process.exit(0);
