# ontology/

Source of truth. **Never loaded into the prompt.**

- `xlsx/` — the ontology workbooks. Roughly 1.5M characters in total; putting these in the system prompt would take about 400k tokens against a 200k window.
- `docs/` — the human-facing masters: the four-drawer specification and the principle dictionary.

What the engine reads is `knowledge/`, built from these by `scripts/build-knowledge.js`.
Change the workbook, rerun the distiller, POST to `/api/reload-knowledge`.
