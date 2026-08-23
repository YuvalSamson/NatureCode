# Function ontology registry

**Hand-written. Not generated. One row per card — update it when a card is added, revised or retired.**

The files numbered 10 and above are distilled index cards, each generated from a workbook that is not loaded into this prompt. This registry says what exists, how complete it is, and — most importantly — what does not exist yet.

| Card | Domain | Status | Version | Strategies | Evidence base | Reach for it when |
|---|---|---|---|---|---|---|
| 10 | Repair and self-healing | Complete | v2 | 16 (NR01–NR16) + S1–S10 bridge | 60 mapped papers | Damage prevention, detection, sealing, rebuilding, remodelling |
| 11a | Patterns — core | Complete | v3 | ~50 pattern families, ~55 generative mechanisms, ~56 governing rules | ~250 evidence sources | Form, arrangement, distribution, self-organisation |
| 11b | Patterns — Aizenberg and Mazzoleni | Complete | v3 | 2 research corpora | ~60 records | Worked precedents at material and product scale |
| 11c | Patterns — Pawlyn | Complete | v3 | ~18 strategies | Case studies + sources | Buildings, infrastructure, closed resource loops |
| 11d | Patterns — Menges | Complete | v3 | ~20 strategies | Case studies + sources | Material systems that respond without sensors or actuators |
| 12 | Heat and temperature regulation | Complete | v1 integrated | NT control layer + NC heat-removal layer | 30 thermal + 34 cooling papers | Holding a temperature band, or shedding heat |
| 13 | Nature-inspired algorithms | Complete | v1 | ~16 strategies across 5 families | 48 papers | Search, optimisation, routing, allocation, distributed coordination |
| 14 | Adhesion and attachment | Version 1 — narrower | v1 | ~16 strategies | 50 papers | Bonding, gripping, sealing to a surface, controlled release |

**Retired:** the standalone Nature Cooling ontology. Its content lives inside card 12 as the heat-removal layer, where every cooling strategy reports to a control-layer parent. Do not treat cooling as a sibling domain.

## What is not covered

There is no card for optics and colour, water capture and transport, sensing and signalling, locomotion, or structural mechanics as a domain in its own right. When a challenge lands squarely in one of those, say plainly that the curated base does not cover it and work from the four-drawer structure in file 04 plus live search. Do not stretch a neighbouring card to cover ground it was not built on — a repair strategy pressed into service as an adhesion answer is worse than an honest gap.

## How to use a card

1. **Classify the challenge before selecting a strategy.** Every card has a challenge-trigger table. That table is the retrieval layer; the strategy list is not meant to be scanned top to bottom.
2. **Check the scope boundary first.** Each card opens with what it covers and what it does not, and which sibling card owns the adjacent ground.
3. **Carry the codes.** NR01, S1–S10, NT and NC codes, pattern and mechanism IDs are more precise than the general vocabulary. Keep them internally. Translate to plain language for the founder.
4. **Cross the bridge.** Each card maps its codes to the main ontology's functions, strategies and operating principles. That mapping is how a specialist finding reaches Drawer 4.
5. **Treat every row as a pointer, not a finding.** A strategy code is a hypothesis to verify against current sources, never a citation in itself.
6. **Search anyway.** The card is an index of a seed. Every proposed direction is checked against current literature, patents, standards and manufacturer data before it reaches the founder, and any contradiction between a card and what the search returns is stated openly.

## Adding an ontology

The knowledge base is an ongoing build, not a finished asset. Adding one is four steps and no code change:

1. Put the workbook in `ontology/xlsx/`.
2. Add an entry to `scripts/ontology-manifest.json` — the card number, the sheets to distil, the columns to pull, a hand-written scope boundary and a size budget.
3. Run `node scripts/build-knowledge.js`.
4. Add a row to the table above, and remove it from the "not covered" list.

Then `POST /api/reload-knowledge` — no redeploy needed.

Files 01 to 05 are hand-written and the distiller never touches them. Files 10 and above are generated and must never be edited directly; an edit there is silently destroyed on the next build. Fix the workbook or the manifest instead.
