---
name: echr-research
description: Research the case-law of the European Court of Human Rights (ECtHR) with HUDOC Researcher's tools — find the judgments and paragraphs on an issue, identify the leading case, quote paragraphs verbatim with OSCOLA pinpoint citations, and check the ECtHR citations in a draft. Use whenever the user asks about Strasbourg case-law, a Convention Article, a named ECtHR judgment, "what does the Court say about…", or wants citations to ECtHR judgments written or verified. Requires the HUDOC Researcher MCP connector (tools named echr_*).
---

# ECtHR research with HUDOC Researcher

HUDOC Researcher holds the judgments of the European Court of Human Rights in English, split into the
Court's own numbered paragraphs (§), with the citation links between judgments. Its MCP connector gives
you seven tools:

| Tool | Use it to |
|---|---|
| `echr_search` | find paragraphs by words or phrases, with filters (Article, State, section, dates) |
| `echr_get_case` | read a judgment's record: title, application number, date, formation, findings, importance, Cites / Cited by counts |
| `echr_get_paragraphs` | read the judgment's own text, by section or § range |
| `echr_cited_by` | later judgments that cite a judgment |
| `echr_cites` | the judgments a judgment relies on |
| `echr_facets` | valid filter values (Articles, States, sections) |
| `echr_stats` | what the corpus covers |

If these tools are not available, say so and point the user to the setup page:
https://lszoszk.github.io/ECHR-Dashboard/about.html#mcp (connector address
`https://150.254.115.204/echr-api/mcp`). Do not answer from memory as if you had searched.

## Ground rules

1. **Quote, don't paraphrase, the Court.** When you state what the Court held, quote the paragraph
   verbatim from `echr_get_paragraphs` or a search hit, and give its pinpoint. Never write a quotation
   you have not read through the tools in this conversation.
2. **Cite the paragraph the tools give.** Use the § number the tool prints. Never cite `para_idx` (an
   internal row number) and never guess a paragraph number. A row printed `(unnumbered, idx N)` has no §:
   cite it without a pinpoint.
3. **The case_id is the HUDOC item id** (`001-58920`), not the application number. Use it to chain tools.
   One application number can have two judgments (Chamber and Grand Chamber, e.g. *Hatton*): match the
   date and formation.
4. **Know what you are citing.**
   - A paragraph in *Separate Opinion* is a judge's opinion, not the Court's holding.
   - *Legal Framework* paragraphs quote domestic or international law, not the Court's reasoning.
   - *Facts*, *Procedure* and *Circumstances* describe the case; the Court's reasoning is in *Merits*
     (and *Admissibility*).
   - A judgment marked **UNOFFICIAL MACHINE TRANSLATION** exists only in French on HUDOC; its English
     text is unofficial. Say so whenever you quote it, and cite the French original (the HUDOC item the
     tool names). Search leaves these out unless you pass `translations: "include"`. In citation lists,
     "French only on HUDOC" marks the same judgments.
5. **HUDOC is the authoritative text.** Give the HUDOC link for every judgment you rely on, and remind
   the user to check a passage there before relying on it. This is a research aid, not legal advice.
6. **Cited by counts judgments, not mentions**, and it includes judgments that exist only in French and
   citations in separate opinions. It measures how often the Court builds on a judgment, not approval.

## Citing (OSCOLA)

`Name v State [GC] App no 12345/67 (ECtHR, 26 October 2000), para 152`

- Name from the title without "CASE OF" (the record is in capitals and drops diacritics: restore them,
  KUDLA → Kudła, and check on HUDOC), "v" without a full stop, *the* in lower case after "v"
  ("Hatton and Others v the United Kingdom").
- `[GC]` for the Grand Chamber; `(dec)` after the name for a decision.
- One application: `App no 30210/96`; two: `App nos 1874/13 and 8567/13`; more: `App no 1874/13 and
  3 others`.
- Date written out: `(ECtHR, 26 October 2000)`.
- Pinpoint: `para 152`; several: `paras 152–153`; operative part: `operative provisions, point 3`.
- In running text the short form after the first full citation is `Kudła (n 3) para 152` or
  `Kudła, para 152`, following the user's style.

## Workflows

### "What does the Court say about X?"
1. `echr_search` with the key legal terms (use a quoted phrase for a term of art, e.g.
   `"margin of appreciation"`), and an Article filter when the user names one. **Every word is
   required**: use 2–4 terms or one phrase, and drop terms if fewer than five hits come back. Once you
   find the Court's stock formula, search it as a phrase (e.g. `"favourable environment"`). Check
   `echr_facets` for State spellings (Turkey and Türkiye both occur).
2. Group the hits by judgment. For the two or three most relevant judgments, read the surrounding
   paragraphs with `echr_get_paragraphs` so you quote the Court's reasoning, not a fact summary.
3. Find the **leading case**: check `echr_get_case` for `Importance: Key cases` (or 1–3),
   `Formation: Court (Grand Chamber)` and Cited by (`importance: ["Key cases"]` filters search to them);
   if the hits keep citing one earlier judgment, read that judgment's general-principles paragraphs.
4. Answer with: the principle in one or two sentences; the leading case quoted with its pinpoint; one or
   two applications; the HUDOC links; any limits (separate opinions, translations, dates).

### "Find the leading case on X"
1. Search as above; collect the judgments cited by most of the results (`echr_cites` on the top
   results, or `echr_get_case` Cited by counts).
2. Prefer Grand Chamber and Key cases; state how many later judgments cite it.
3. Quote the paragraph that states the general principle (usually in *Merits*, "The Court reiterates…").

### "Check the citations in my text"
For each ECtHR citation in the user's draft:
1. Identify the judgment: `echr_search` with the query `case:30210/96` lists every judgment under that
   application number (Chamber and Grand Chamber), or search the name; confirm with `echr_get_case`.
2. Check the name, application number, date and formation against the record.
3. Check the pinpoint: read the cited § with `echr_get_paragraphs` and confirm it says what the draft
   claims; for a quotation, compare it word for word.
4. Report each citation as correct / wrong detail (say which) / not supported by the cited paragraph,
   with the corrected OSCOLA citation.

### "Which later judgments followed X?"
`echr_cited_by` on X lists citing judgments newest first (up to 200), without the citing text. Run it on
both the Chamber and the Grand Chamber judgment where both exist: a citation can attach to either. For a
topic, search `<Name> <topic term>` with `sections: ["Merits"]` to reach the citing paragraphs directly.
Read the citing paragraph in two or three of the most recent or most important judgments before
characterising how they used X.

## Answer format

- Lead with the answer, then the authorities.
- Every quotation in quotation marks, followed by its OSCOLA pinpoint.
- End with the HUDOC links of the judgments relied on and, where relevant, one line on limits
  (separate opinion, machine translation, coverage up to the corpus date from `echr_stats`).
