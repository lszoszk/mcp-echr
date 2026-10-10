/**
 * mcp-echr shared server factory.
 *
 * Wraps the ECHR-Dashboard FastAPI backend (api/main.py) as MCP tools. The
 * server owns no search logic of its own: BM25F ranking, section weighting and
 * the dense arm all stay in main.py, so MCP results and the dashboard can never
 * drift apart.
 *
 * Entry point:
 *   - src/index.js  stdio  (Claude Code / Claude Desktop)
 *
 * Config (env):
 *   ECHR_API_BASE      default https://150.254.115.204/echr-api/api
 *   ECHR_API_KEY       optional token sent as X-API-Key
 *   ECHR_INSECURE_TLS  "1" accepts an untrusted cert (self-hosted API); default "0"
 *   ECHR_TIMEOUT_MS    default 45000 — cold FTS queries on the 2M-paragraph
 *                      index have been measured at ~15s; warm ones ~1.5s.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';

const API_BASE = (process.env.ECHR_API_BASE || 'https://150.254.115.204/echr-api/api').replace(/\/$/, '');
const API_KEY = process.env.ECHR_API_KEY || '';
const INSECURE_TLS = (process.env.ECHR_INSECURE_TLS ?? '0') === '1';
const TIMEOUT_MS = Number(process.env.ECHR_TIMEOUT_MS || 45000);

export const config = { API_BASE, API_KEY, INSECURE_TLS, TIMEOUT_MS };

// The VM serves the API behind a self-signed cert. Scope the relaxed TLS to an
// explicit agent rather than the global NODE_TLS_REJECT_UNAUTHORIZED, so we
// don't weaken TLS for anything else this process might do.
const httpsAgent = new https.Agent({ rejectUnauthorized: !INSECURE_TLS });

// node:http(s) rather than global fetch: undici ignores a custom `agent`, so
// the self-signed bypass would silently not apply.
function apiGet(path, params = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const headers = { accept: 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  const opts = { headers };
  if (isHttps) opts.agent = httpsAgent;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, opts, (res) => {
      // nginx gzips cached endpoints (facets, stats, analytics) regardless of
      // Accept-Encoding, and node:http does not auto-decompress.
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      const stream =
        enc === 'gzip'    ? res.pipe(zlib.createGunzip()) :
        enc === 'deflate' ? res.pipe(zlib.createInflate()) :
        enc === 'br'      ? res.pipe(zlib.createBrotliDecompress()) :
        res;
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('error', reject);
      stream.on('end', () => {
        if (res.statusCode === 404) {
          return reject(new Error(`Not found: ${url.pathname}. Check the case_id — it is a HUDOC id such as "001-72346", not an application number.`));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`API ${res.statusCode} for ${url.pathname}${url.search}`));
        }
        const body = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Bad JSON from ${url.pathname}: ${e.message}`)); }
      });
    });
    req.on('error', (e) => reject(new Error(`Cannot reach the ECHR API at ${url.host}: ${e.message}. Is the VM up and are you on a network that can reach it?`)));
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`ECHR API timed out after ${TIMEOUT_MS}ms. A cold full-text query over 2M paragraphs can take ~15s; try narrowing with filters or retry (the cache is then warm).`)));
  });
}

// ── formatting ──────────────────────────────────────────────────────────────

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// "14/02/2006" -> "14 February 2006"; anything unexpected passes through.
function fmtDate(d) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(d || '').trim());
  if (!m) return String(d || '');
  return `${Number(m[1])} ${MONTHS[Number(m[2]) - 1] || m[2]} ${m[3]}`;
}

// Search snippets carry <b> highlight tags and NBSPs.
function stripHtml(s) {
  return String(s || '')
    .replace(/<\/?b>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// The printed paragraph number the Court itself uses. display_para_no is the
// healed/continuation-aware number the dashboard shows; hudoc_para_no is the
// raw HUDOC one; para_idx is an internal row index and is NOT citable.
const paraNo = (p) => (p.display_para_no != null ? p.display_para_no : (p.hudoc_para_no != null ? p.hudoc_para_no : null));

// Strasbourg-style citation. Title stays verbatim from HUDOC (it is uppercase
// there); we do not re-case it, to avoid mangling names.
function citation(c, n) {
  const bits = [String(c.title || '').trim()];
  if (c.case_no) bits.push(`no. ${String(c.case_no).split(';')[0]}`);
  if (n != null) bits.push(`§ ${n}`);
  if (c.judgment_date) bits.push(fmtDate(c.judgment_date));
  return bits.filter(Boolean).join(', ');
}

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

// Judgments HUDOC publishes only in French are served in an unofficial English machine translation.
const isMT = (c) => c && c.text_origin === 'machine_translation';
const mtNote = (c) =>
  `UNOFFICIAL MACHINE TRANSLATION from French: the authentic text is French only (HUDOC item ${c.source_case_id || c.case_id}). ` +
  'Present any quotation as an unofficial translation and cite the French original.';

// Case metadata header shared by search results and echr_get_case.
function caseHeader(c) {
  const lines = [citation(c, null)];
  if (isMT(c)) lines.push(mtNote(c));
  const meta = [c.respondent_state, c.originating_body && `Formation: ${c.originating_body}`, c.document_type].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);
  if (c.importance) lines.push(`Importance: ${c.importance}`);
  const v = arr(c.violation), nv = arr(c.non_violation);
  if (v.length) lines.push(`Violation of Art. ${v.join(', ')}`);
  if (nv.length) lines.push(`No violation of Art. ${nv.join(', ')}`);
  return lines.join('\n');
}

function formatParaHit(h) {
  const c = h.case || {};
  const n = paraNo(h);
  const text = stripHtml(h.snippet != null ? h.snippet : h.text);
  const head = `${citation(c, n)}${h.section ? ` — ${h.section}` : ''}`;
  return `${head}\n${text}\n[case_id: ${c.case_id} · para_idx: ${h.para_idx}]`;
}

function formatCaseResult(c, maxParas) {
  const paras = (c.paragraphs || []).slice(0, maxParas).map((p) => {
    const n = paraNo(p);
    return `  ${n != null ? `§ ${n}` : `(unnumbered, idx ${p.para_idx})`}${p.section ? ` · ${p.section}` : ''}: ${stripHtml(p.snippet != null ? p.snippet : p.text)}`;
  });
  const more = (c.paragraphs || []).length > maxParas ? `\n  … ${(c.paragraphs || []).length - maxParas} more matched paragraph(s) in this case` : '';
  return `${caseHeader(c)}\n${c.hit_count != null ? `${c.hit_count} matching paragraph(s)` : ''}${paras.length ? `\n${paras.join('\n')}` : ''}${more}\n[case_id: ${c.case_id}]`;
}

// Dashboard parity: which row_roles to drop. Headings and boilerplate are noise
// for legal research, so they are excluded unless explicitly asked for.
const ROLES_NO_HEADINGS = 'heading,heading_h0,heading_h1,heading_h2,heading_h3,heading_h4,metadata,signature,footer';
const ROLES_MINIMAL = 'metadata,signature,footer';
const excludeRoles = (includeHeadings) => (includeHeadings ? ROLES_MINIMAL : ROLES_NO_HEADINGS);

const csv = (a) => (arr(a).length ? arr(a).join(',') : undefined);
const ok = (text) => ({ content: [{ type: 'text', text }] });
const fail = (text) => ({ isError: true, content: [{ type: 'text', text }] });

export function buildServer() {
  const server = new McpServer({ name: 'mcp-echr', version: '0.2.1' });

  server.registerTool(
    'echr_search',
    {
      title: 'Search ECtHR case law',
      description:
        'Full-text search over the paragraph-level corpus of European Court of Human Rights judgments and decisions (~20,000 cases, ~2M paragraphs, HUDOC-derived). Returns verbatim paragraphs with a Strasbourg-style citation (case name, application number, § number, date). Ranking is BM25F with the case title and HUDOC keywords boosted. Supports phrase queries in double quotes, e.g. "necessary in a democratic society". Use group="paragraph" when you want the single best paragraphs across all cases; the default group="case" clusters hits under each judgment. This corpus is ECtHR only — for UN treaty-body material use the unhrdb tools instead.',
      inputSchema: {
        query: z.string().min(1).describe('Search terms. Every word is required (AND), so use 2-4 key terms or one quoted phrase, e.g. "margin of appreciation". Also: OR between alternatives, NOT to exclude, a trailing * for word endings (environment*), case:30210/96 for every judgment under an application number.'),
        articles: z.array(z.string()).optional().describe('Convention articles, e.g. ["8","10"] or sub-provisions ["6-1","8-2"]. Multiple = OR. Call echr_facets for valid values.'),
        states: z.array(z.string()).optional().describe('Respondent States as named by the Court, e.g. ["Poland","Türkiye"]. Multiple = OR. Note both "Moldova" and "Republic of Moldova" occur — check echr_facets.'),
        sections: z.array(z.string()).optional().describe('Judgment sections, e.g. ["Merits","Circumstances","Just Satisfaction","Operative part","Separate Opinion","Procedure"]. Multiple = OR.'),
        importance: z.array(z.string()).optional().describe('HUDOC importance level: ["Key cases"] for the leading authorities, or ["1"],["2"],["3"].'),
        doc_types: z.array(z.string()).optional().describe('Document type, e.g. ["Judgment (Merits and Just Satisfaction)"]. See echr_facets.'),
        date_from: z.string().optional().describe('Earliest judgment date, ISO "YYYY-MM-DD".'),
        date_to: z.string().optional().describe('Latest judgment date, ISO "YYYY-MM-DD".'),
        group: z.enum(['case', 'paragraph']).default('case').describe('"case" groups matched paragraphs under each judgment; "paragraph" returns a flat, independently ranked list of the best paragraphs.'),
        sort: z.enum(['relevance', 'date_desc', 'date_asc']).default('relevance').describe('Result ordering.'),
        translations: z.enum(['exclude', 'include', 'only']).default('exclude').describe('Unofficial English machine translations of judgments HUDOC publishes only in French (~2,500 of the most-cited): excluded by default; "include" adds them, "only" searches just them.'),
        include_headings: z.boolean().default(false).describe('Include section headings and boilerplate rows. Off by default — headings match keywords but carry no reasoning.'),
        limit: z.coerce.number().int().min(1).max(20).default(8).describe('Max cases (group="case") or paragraphs (group="paragraph") to return, 1-20.'),
        page: z.coerce.number().int().min(1).default(1).describe('Result page.'),
      },
    },
    async (a) => {
      const data = await apiGet('/search', {
        q: a.query,
        articles: csv(a.articles), states: csv(a.states), sections: csv(a.sections),
        importance: csv(a.importance), doc_types: csv(a.doc_types),
        date_from: a.date_from, date_to: a.date_to,
        group: a.group, sort: a.sort,
        exclude_roles: excludeRoles(a.include_headings),
        include_mt: { exclude: 'false', include: 'true', only: 'only' }[a.translations],
        page: a.page, page_size: a.limit,
      });
      const header =
        `${data.total_hits ?? 0} matching paragraph(s) across ${data.total_cases ?? 0} case(s) for ${a.query}` +
        (data.fallback ? ` — note: the server fell back to "${data.fallback}"` : '') +
        `\nPage ${data.page ?? a.page} · ${Math.round(data.search_time_ms ?? 0)}ms`;

      if (a.group === 'paragraph') {
        const hits = (data.hits || []).slice(0, a.limit);
        return ok(`${header}\n\n${hits.length ? hits.map(formatParaHit).join('\n\n') : 'No paragraphs matched. Try fewer filters, or drop the quotes to widen a phrase query.'}`);
      }
      const cases = (data.cases || []).slice(0, a.limit);
      return ok(`${header}\n\n${cases.length ? cases.map((c) => formatCaseResult(c, 4)).join('\n\n') : 'No cases matched. Try fewer filters, or drop the quotes to widen a phrase query.'}`);
    }
  );

  server.registerTool(
    'echr_get_case',
    {
      title: 'Get an ECtHR case record',
      description:
        'Fetch the full metadata record for one ECtHR case by its HUDOC id (e.g. "001-72346"): case name, application number, ECLI, date, respondent State, importance level, the Court\'s conclusion, the articles found violated / not violated, HUDOC keywords, and how many cases it cites and is cited by. Returns metadata only — use echr_get_paragraphs for the judgment text. Get case_ids from echr_search.',
      inputSchema: {
        case_id: z.string().min(1).describe('HUDOC case id, e.g. "001-72346". This is not the application number.'),
      },
    },
    async ({ case_id }) => {
      let c;
      try { c = await apiGet(`/cases/${encodeURIComponent(case_id)}`); }
      catch (e) { return fail(`Could not fetch case "${case_id}": ${e.message}`); }

      const lines = [caseHeader(c)];
      if (c.ecli) lines.push(`ECLI: ${c.ecli}`);
      if (c.conclusion) lines.push('', `Conclusion: ${c.conclusion}`);
      const vi = arr(c.violation_inferred), nvi = arr(c.non_violation_inferred);
      if (vi.length) lines.push(`Violation inferred from conclusion text (not tagged in HUDOC): Art. ${vi.join(', ')}`);
      if (nvi.length) lines.push(`No violation inferred from conclusion text: Art. ${nvi.join(', ')}`);
      if (arr(c.articles).length) lines.push(`All articles engaged: ${arr(c.articles).join(', ')}`);
      if (arr(c.keywords).length) lines.push('', `HUDOC keywords: ${arr(c.keywords).join('; ')}`);
      lines.push('', `Citations: cites ${c.cites_count ?? 0} case(s), cited by ${c.cited_by_count ?? 0}.`);
      lines.push(`Paragraphs available: ${(c.paragraphs || []).length}.`);
      if (c.hudoc_url) lines.push(`Source: ${c.hudoc_url}`);
      lines.push(`[case_id: ${c.case_id}]`);
      return ok(lines.join('\n'));
    }
  );

  server.registerTool(
    'echr_get_paragraphs',
    {
      title: 'Get the text of an ECtHR judgment',
      description:
        'Retrieve the verbatim text of an ECtHR judgment, paragraph by paragraph, each with its printed § number ready to cite. Filter to specific sections (e.g. only "Merits", or only "Separate Opinion") or to a § range, so you can read the Court\'s reasoning without pulling a 300-paragraph judgment into context. Use after echr_search or echr_get_case has given you a case_id.',
      inputSchema: {
        case_id: z.string().min(1).describe('HUDOC case id, e.g. "001-72346".'),
        sections: z.array(z.string()).optional().describe('Restrict to these sections, e.g. ["Merits"] or ["Operative part"]. Omit for the whole judgment. Typical values: Procedure, Circumstances, Merits, Just Satisfaction, Operative part, Separate Opinion, Appendix, Header.'),
        from_para: z.coerce.number().int().optional().describe('First printed § number to include, inclusive.'),
        to_para: z.coerce.number().int().optional().describe('Last printed § number to include, inclusive.'),
        include_headings: z.boolean().default(false).describe('Include section headings and boilerplate rows.'),
        limit: z.coerce.number().int().min(1).max(120).default(40).describe('Max paragraphs to return (1-120). Narrow with sections or a § range rather than raising this.'),
      },
    },
    async ({ case_id, sections, from_para, to_para, include_headings, limit }) => {
      let c;
      try { c = await apiGet(`/cases/${encodeURIComponent(case_id)}`); }
      catch (e) { return fail(`Could not fetch case "${case_id}": ${e.message}`); }

      const drop = new Set(excludeRoles(include_headings).split(','));
      const want = new Set(arr(sections).map((s) => s.toLowerCase()));
      let paras = (c.paragraphs || []).filter((p) => {
        if (p.row_role && drop.has(p.row_role)) return false;
        if (want.size && !want.has(String(p.section || '').toLowerCase())) return false;
        const n = paraNo(p);
        if (from_para != null && (n == null || n < from_para)) return false;
        if (to_para != null && (n == null || n > to_para)) return false;
        return true;
      });

      if (!paras.length) {
        const avail = [...new Set((c.paragraphs || []).map((p) => p.section).filter(Boolean))];
        return fail(`No paragraphs matched those filters in ${case_id}. Sections present in this judgment: ${avail.join(', ') || '(none)'}.`);
      }
      const shown = paras.slice(0, limit);
      const body = shown.map((p) => {
        const n = paraNo(p);
        return `${n != null ? `§ ${n}` : `(unnumbered, idx ${p.para_idx})`}${p.section ? ` · ${p.section}` : ''}\n${stripHtml(p.text)}`;
      }).join('\n\n');
      const more = paras.length > shown.length ? `\n\n… ${paras.length - shown.length} further paragraph(s) match; narrow with sections or from_para/to_para.` : '';
      return ok(`${citation(c, null)}${isMT(c) ? `\n${mtNote(c)}` : ''}\nShowing ${shown.length} of ${paras.length} matching paragraph(s).\n\n${body}${more}\n\n[case_id: ${c.case_id}]${c.hudoc_url ? `\nSource: ${c.hudoc_url}` : ''}`);
    }
  );

  const citationTool = (name, endpoint, title, description, render) =>
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: {
          case_id: z.string().min(1).describe('HUDOC case id, e.g. "001-72346".'),
          limit: z.coerce.number().int().min(1).max(200).default(20).describe('Max cases to return (1-200), newest first.'),
        },
      },
      async ({ case_id, limit }) => {
        let d;
        try { d = await apiGet(`/cases/${encodeURIComponent(case_id)}/${endpoint}`, { limit }); }
        catch (e) { return fail(`Could not fetch ${endpoint} for "${case_id}": ${e.message}`); }
        const rows = d[endpoint] || [];
        if (!rows.length) return ok(`No ${endpoint.replace('_', ' ')} records for ${case_id}.`);
        const body = rows.slice(0, limit).map((r) =>
          `${citation(r, null)}${r.respondent_state ? ` · ${r.respondent_state}` : ''}` +
          `${r.in_corpus === false ? ' · French only on HUDOC (an unofficial English translation may be available)' : ''}` +
          `${r.para_count != null ? ` — referenced in at least ${r.para_count} paragraph(s)` : ''}\n[case_id: ${r.case_id}]`
        ).join('\n\n');
        return ok(`${render(rows.length, case_id)}\n\n${body}`);
      }
    );

  // NB: the API returns at most `limit` rows and no total — the true count
  // lives on the case record (cites_count / cited_by_count), so the header
  // must say "showing", never assert a total.
  citationTool(
    'echr_cited_by', 'cited_by', 'Find later ECtHR cases citing this one',
    'List subsequent ECtHR judgments that cite a given case — the forward citation graph, for tracing how an authority was applied, distinguished or developed. Returns up to `limit` cases; the full count is the cited_by figure on echr_get_case.',
    (n, id) => `Showing ${n} case(s) citing ${id} (up to the requested limit; echr_get_case reports the full cited-by count). ` +
      `Cited by counts judgments, not mentions: a judgment that refers to the case in ten paragraphs counts once; ` +
      `the paragraph figure is a minimum, as later short references ("cited above") are not detected.`
  );

  citationTool(
    'echr_cites', 'cites', 'Find the authorities an ECtHR case relies on',
    'List the earlier ECtHR judgments that a given case cites — the backward citation graph, for finding the line of authority a judgment builds on. Returns up to `limit` cases; the full count is the cites figure on echr_get_case.',
    (n, id) => `Showing ${n} case(s) cited by ${id} (up to the requested limit; echr_get_case reports the full cites count).`
  );

  server.registerTool(
    'echr_facets',
    {
      title: 'List available ECtHR filter values',
      description:
        'List the valid filter values for echr_search — Convention articles, respondent States, judgment sections, importance levels, originating bodies, document types and the corpus date range, each with a case count. Call this before filtering if you are unsure how a State or article is spelled (e.g. "Türkiye" vs "Turkey"). Pass a query to scope the counts to that search.',
      inputSchema: {
        query: z.string().optional().describe('Optional search terms — scopes the facet counts to matching cases instead of the whole corpus.'),
        date_from: z.string().optional().describe('Earliest judgment date, ISO "YYYY-MM-DD".'),
        date_to: z.string().optional().describe('Latest judgment date, ISO "YYYY-MM-DD".'),
        top: z.coerce.number().int().min(1).max(100).default(25).describe('How many values to show per facet (1-100).'),
      },
    },
    async ({ query, date_from, date_to, top }) => {
      const d = await apiGet('/facets', { q: query, date_from, date_to });
      const fmt = (label, key) => {
        const rows = (d[key] || []).slice(0, top);
        if (!rows.length) return '';
        return `${label} (${(d[key] || []).length} distinct):\n` +
          rows.map((r) => `  ${r.value} — ${r.count}`).join('\n');
      };
      const range = d.date_range ? `Date range: ${d.date_range.min || '?'} to ${d.date_range.max || '?'}` : '';
      const blocks = [
        range,
        fmt('Articles', 'articles'),
        fmt('Respondent States', 'states'),
        fmt('Sections', 'sections'),
        fmt('Importance', 'importance'),
        fmt('Originating bodies', 'bodies'),
        fmt('Document types', 'doc_types'),
      ].filter(Boolean);
      return ok(blocks.join('\n\n'));
    }
  );

  server.registerTool(
    'echr_stats',
    {
      title: 'ECtHR corpus statistics',
      description: 'Report the size and coverage of the indexed ECtHR corpus — total cases, paragraphs, States and the date span. Use to check what the index actually contains before relying on a negative search result.',
      inputSchema: {},
    },
    async () => {
      const s = await apiGet('/stats');
      const line = (k, label) => (s[k] != null ? `${label}: ${s[k]}` : '');
      const out = [
        line('total_cases', 'Cases'),
        line('total_judgments', 'Judgments'),
        line('total_press_releases', 'Press releases'),
        line('total_paragraphs', 'Paragraphs'),
        line('citable_paragraphs', 'Citable (numbered) paragraphs'),
        line('total_countries', 'Respondent States'),
        line('date_from', 'Earliest document'),
        line('date_to', 'Latest document'),
        line('version', 'Index version'),
      ].filter(Boolean);
      return ok(out.length ? out.join('\n') : JSON.stringify(s, null, 1).slice(0, 2000));
    }
  );

  return server;
}
