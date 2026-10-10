# mcp-echr

[![MCP](https://img.shields.io/badge/MCP-Server-blue)](https://modelcontextprotocol.io) [![Node](https://img.shields.io/badge/Node-18%2B-brightgreen)](https://nodejs.org) [![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue.svg)](LICENSE)

Model Context Protocol server for **European Court of Human Rights case law**:
paragraph-level search over the ~20,000 judgments of
[HUDOC Researcher](https://lszoszk.github.io/ECHR-Dashboard/), with each
paragraph's case name, application number, date and § number, plus the
citation graph between judgments.

It is a thin wrapper over the live HUDOC Researcher API: BM25F ranking, section
weighting and filters all stay in the API, so an assistant and the website
always return the same results. Every result is the **verbatim** text of the
judgment, so answers stay citable to the paragraph.

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

## Hosted connector (nothing to install)

**https://150.254.115.204/echr-api/mcp** — Streamable HTTP, no token.

- **Claude (claude.ai / Desktop):** Settings → Connectors → Add custom connector → paste the address.
- **Claude Code:** `claude mcp add --transport http echr https://150.254.115.204/echr-api/mcp -s user`
- Any other MCP client that supports remote (HTTP) servers: the same address.

The local install below is for running the server yourself.

## Skill: ECtHR research

[`skills/echr-research`](skills/echr-research/SKILL.md) teaches Claude how to use these tools well:
find the case-law on an issue, identify the leading case, quote paragraphs verbatim with OSCOLA
pinpoints, and check the ECtHR citations in a draft.

- **claude.ai / Desktop:** download [`skills/echr-research.zip`](skills/echr-research.zip), then
  Settings → Capabilities → Skills → Upload skill.
- **Claude Code:** copy the `skills/echr-research` folder into `~/.claude/skills/`.

The skill needs the connector above.

## Requirements

- Node.js ≥ 18
- Network access to the HUDOC Researcher API

## Install

```bash
git clone https://github.com/lszoszk/mcp-echr.git
cd mcp-echr
npm install
```

## Wire into Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(Windows: `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "echr": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mcp-echr/src/index.js"]
    }
  }
}
```

Replace `/ABSOLUTE/PATH/TO/` with the directory where you cloned this repo
(the output of `pwd` from inside it), then restart Claude Desktop; the seven
tools appear under the connectors menu.

### Claude Code

```bash
claude mcp add echr -s user -- node /ABSOLUTE/PATH/TO/mcp-echr/src/index.js
```

Use `-s user` for all your projects, or `-s local` for the current one.

### Other clients

Any MCP client that can launch a stdio server works: the command is
`node /ABSOLUTE/PATH/TO/mcp-echr/src/index.js`.

## Config (env)

| Variable | Default | Meaning |
|---|---|---|
| `ECHR_API_BASE` | `https://150.254.115.204/echr-api/api` | HUDOC Researcher API root |
| `ECHR_API_KEY` | *(none)* | Sent as `X-API-Key` if set |
| `ECHR_INSECURE_TLS` | `0` | `1` accepts an untrusted certificate (only for a self-hosted API behind a self-signed cert); scoped to this server's own HTTPS agent |
| `ECHR_TIMEOUT_MS` | `45000` | Cold full-text queries can take ~15 s; warm ~1.5 s |

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
- About 2,500 of the most-cited judgments that HUDOC publishes only in French are available in an
  unofficial English machine translation. Search leaves them out unless `translations` is `"include"`
  or `"only"`; every record and paragraph listing of one carries an `UNOFFICIAL MACHINE TRANSLATION`
  line naming the French original.
- HUDOC (https://hudoc.echr.coe.int) is the authoritative source of every
  judgment: check a passage there before relying on it. This is an independent
  research tool, not affiliated with the Court, and not legal advice.

## Licence

Code: [PolyForm Noncommercial 1.0.0](LICENSE) — research, education,
non-profit and personal use are permitted; commercial use needs a separate
licence. The judgments and metadata the server returns are © Council of Europe /
European Court of Human Rights and are reused under the Court's terms for HUDOC
content; the HUDOC Researcher curated dataset is licensed CC BY-NC-SA 4.0.

Authors: [Łukasz Szoszkiewicz](https://lszoszk.github.io/) and Sebastian
Marcisz, Adam Mickiewicz University, Poznań. Contact: l.szoszkiewicz@amu.edu.pl
