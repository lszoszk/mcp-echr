# mcp-echr

MCP server for European Court of Human Rights case law. Wraps the
[ECHR-Dashboard](https://github.com/lszoszk/ECHR-Dashboard) FastAPI backend
(~20,000 judgments and decisions, ~3.3M paragraphs, HUDOC-derived) as seven
tools for Claude Code / Claude Desktop.

The server owns **no search logic**: BM25F ranking, section weighting and
filters all stay in the dashboard API, so MCP results and the dashboard can
never drift apart.

## Tools

| Tool | Purpose |
|---|---|
| `echr_search` | Paragraph-level full-text search (phrase queries, article/State/section/date filters, by-case or by-paragraph grouping) |
| `echr_get_case` | Full metadata record for one case (conclusion, violations, keywords, citation counts) |
| `echr_get_paragraphs` | Verbatim judgment text, filterable by section or § range |
| `echr_cited_by` | Later cases citing this one (forward citation graph) |
| `echr_cites` | Authorities this case relies on (backward citation graph) |
| `echr_facets` | Valid filter values with counts (articles, States, sections, …) |
| `echr_stats` | Corpus size and coverage |

Every result carries a Strasbourg-style citation (case name, application
number, § number, date) and the `case_id` needed to chain into the next tool.

## Install

```bash
npm install
```

Register with Claude Code:

```bash
claude mcp add echr -s user -- node /path/to/mcp-echr/src/index.js
```

## Config (env)

| Variable | Default | Meaning |
|---|---|---|
| `ECHR_API_BASE` | `https://150.254.115.204/echr-api/api` | Dashboard API root |
| `ECHR_API_KEY` | *(none)* | Sent as `X-API-Key` if set |
| `ECHR_INSECURE_TLS` | `1` | Accept the VM's self-signed cert |
| `ECHR_TIMEOUT_MS` | `45000` | Cold FTS queries can take ~15 s; warm ~1.5 s |

## Test

```bash
npm run smoke
```

Spawns the server over stdio and exercises every tool against the live API,
including the error path.

## Notes

- `case_id` is the HUDOC id (`001-72346`), **not** the application number.
- Section headings and boilerplate rows are excluded from search results by
  default (`include_headings: true` restores them) — they match keywords but
  carry no reasoning.
- `para_idx` is an internal row index and is not citable; cite the printed
  `§` number the tools display.
