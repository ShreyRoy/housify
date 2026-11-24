# Recall-first local classification experiment

Isolated offline experiment, not connected to Spotify or the application UI. No production code, dependencies, audio processing, network enrichment, or new datasets were added. It reads the previously imported Discogs SQLite catalog and reuses the existing normalization and genre helpers. Large databases and manual decisions stay in ignored `artifacts/`.

## Run

From the repository root, with Node 22.16+ (native SQLite/type transformation are experimental):

```sh
# Rebuild from the existing local source; approximately 80 seconds here.
node --experimental-transform-types experiments/local-catalog/recall-first/build.ts
# Query independent metadata. Duration is optional, in milliseconds.
node --experimental-transform-types experiments/local-catalog/recall-first/query.ts 'Fred again..' 'Delilah (Pull Me Out Of This)'
# Compare the unchanged previous experimental baseline and compact lookup.
node --experimental-transform-types experiments/local-catalog/recall-first/evaluate.ts
node --experimental-transform-types --test experiments/local-catalog/recall-first/classifier.test.ts
```

The builder also accepts positional source and output SQLite paths. Query/evaluation defaults use `artifacts/index.sqlite`. Rebuilding atomically replaces that file; it does not replace the separate manual override database. Changing `policy.ts` requires rebuilding; runtime rejects incompatible policy signatures. No download is triggered by any command.

## Architecture and decisions

- `build.ts`, `schema.sql`, `consensus.ts`: expensive processing happens offline. The runtime needs only two lookup tables plus a small metadata table. Track keys contain normalized artist/title, explicit version, and duration cluster. Duration clusters cannot span more than eight seconds; missing durations remain separate alternatives. Originals, named remixes, extended/radio edits, live versions and instrumentals are distinguished. This remains text matching, not verified audio identity.
- Duplicate pressings are collapsed by logical release title and artist. Counts never increase classification certainty, even across differently named release copies. Maximum source reliability is used: single 0.95, short EP 0.85, album 0.65; compilations provide no assigned track genre evidence. These are configurable heuristic assumptions, not validated genre probabilities. No exact release identity is resolved at runtime.
- Release-context tags are precomputed into house/other/adjacent/conflict flags and minimal provenance. Consistent compatible house evidence can classify without choosing a pressing. A house/other contradiction or competing adjacent-only alternative remains reviewable. House and disco can legitimately coexist. Strong house needs reliability >=0.85; strong exclusion needs >=0.95. Album agreement alone is insufficient for automatic decisions. Unknown alternatives prevent unsupported exclusion.
- Artist profiles count unique title/version samples before retention caps, preserving mixed-genre evidence and unknown coverage denominators. House/adjacent title/version groups are retained without a cap; generic non-house-only groups are limited to 64 per artist, keeping all duration alternatives for retained groups. Ranking for this reservoir uses support and deterministic hashes, never benchmark identities. All duration alternatives also remain for house/adjacent groups. Pure no-evidence track groups are omitted; artist fallback or UNKNOWN handles them.
- `policy.ts` reuses the broad house taxonomy and adds configurable aliases/family overrides. Reliable genre labels ending in “house” can extend the family; exceptions such as witch house and trap house avoid blindly accepting misleading names. This rule only reads genre labels, never song titles. Electronic/techno/trance/garage/breaks remain review signals.
- `classifier.ts`: override → compatible precomputed track evidence → artist affinity → UNKNOWN. Artist evidence never automatically includes or excludes. Scores (90 strong house, 95 strong other, lower tiers for ambiguity/affinity) are evidence heuristics. A manual override uses 100 to indicate an explicit decision, not factual certainty. Output includes evidence flags, tags, provenance, explanations and review priority.
- `reviewQueue` keeps **every** unresolved recording, including UNKNOWN. Priorities are conflict, unrecognized predominantly-house artist, mixed house affinity, adjacent/weak evidence, completely unknown, and supported predominantly-other artist. Ties preserve input order; priority never excludes tracks.
- `overrides.ts`: a separate persistent table keys an independent recording reference plus normalized artist/title/version and duration. Decisions do not spread to other versions or an artist's discography. The origin declaration and Spotify-reference rejection are guardrails, not an automated provenance/legal verification system.

Example of an isolated manual decision (the reference must actually identify the independent recording):

```ts
import { Overrides } from './overrides.ts';
import { RecallClassifier } from './classifier.ts';
const overrides = new Overrides('/path/to/manual.sqlite');
const query = {artist: 'Independent Artist', title: 'Track (Named Remix)', independentRecordingRef: 'your-independent-recording-reference'};
overrides.set(query, 'DEFINITELY_HOUSE', 'independent');
const classifier = new RecallClassifier('/path/to/index.sqlite', overrides);
console.log(classifier.classify(query));
classifier.close();
overrides.close();
```

Omitting/changing the reference or duration does not silently propagate a saved decision. The CLI accepts an independent reference as its fourth positional argument, after duration. No benchmark overrides are seeded.

## Measured results — 24 November 2026

Full reproducible outputs: [results.json](results.json), [build-results.json](build-results.json), independent references/uncertainty: [holdout.ts](holdout.ts).

The fresh set has 40 real track/version candidates across ten requested groups, with no artist/title/version overlap with the previous 100-case benchmark. Only **20** have independent genre labels: 14 house, 6 non-house. The remaining 20 preserve uncertainty and are excluded from accuracy denominators. Generic artist/release links are not treated as proof of a remix's genre. Labels and benchmark names are never read by preprocessing or classification.

| Metric | Previous experimental baseline | Compact consensus |
|---|---:|---:|
| Definitely-house precision, independently labeled subset | 1/1 | 2/2 |
| Definitely-house recall, 14 labeled house tracks | 1/14 (7.1%) | 2/14 (14.3%) |
| Definitely or POSSIBLY, excluding UNKNOWN | 7/14 (50%) | 9/14 (64.3%) |
| Definitely or any review, including UNKNOWN | 14/14 | 14/14 |
| Labeled house incorrectly excluded | 0 | 0 |
| Manual review, all 40 | 39 (97.5%) | 35 (87.5%) |
| UNKNOWN, all 40 | 22 (55%) | 9 (22.5%) |
| POSSIBLY_HOUSE, all 40 | 17 (42.5%) | 26 (65%) |
| House among independently labeled review candidates | 13/19 (68.4%) | 12/18 (66.7%) |
| Automatic decisions, all 40 | 1 | 5 |

Three of the five compact automatic house decisions lack independent gold; do not count them as verified successes. No NOT_HOUSE decision occurred in these 40 cases, so this set does not validate exclusion accuracy. Retaining 100% of house is easy when everything uncertain stays reviewable; **87.5% still needs review**. This is an assistive improvement, not a solved automatic classifier.

Review ranking also remains weak. On genre-grouped original input, judged-only NDCG@10 fell from 1.000 to 0.756. Because that input conveniently puts house first, evaluation additionally checks 20 deterministic label-independent permutations: mean NDCG@10 0.710 baseline versus 0.660 compact; mean judged precision@5 0.71 versus 0.60. Unadjudicated rows are filtered, not counted as negatives. This sensitivity check was added after inspecting grouped-order bias; no classifier/ranking rules were retuned. It uses the same small test pool, not a separate validation. There is no evidence yet that the proposed priority scheme improves review efficiency.

### Storage and runtime

- Source: **2,710,073,344 bytes**; compact: **27,004,928 bytes**, approximately 100× smaller (99.0% reduction).
- 60,639 track duration rows, 2,996 artist alias lookup rows, from 147,753 title/version groups. 64,974 generic non-house-only groups omitted. Artist statistics are calculated before this omission.
- Offline build: **79.91 seconds**, peak RSS **945,700,864 bytes**. This is a substantial temporary preprocessing cost, not runtime footprint; source remains unchanged on disk.
- Beatles now has 1,919 duration rows / 320 title-version groups; Queen 2,413 / 550. More than 64 remain because house/adjacent contexts and all their ambiguity guards are retained. A generic Electronic tag can therefore retain unrelated material: the cap reduces excess without claiming to eliminate it.
- **2,000 distinct catalog-derived recording/version/duration queries**, identical metadata supplied to both engines: baseline **5,064.59 ms**, compact **83.34 ms** (~61× faster). Compact median 0.0346 ms, p95 0.0727 ms. No pressing IDs supplied. This is an engineering throughput sample, not an independent accuracy benchmark; caches, execution order and machine load were uncontrolled.
- The timing sample generated 95 DEFINITELY_HOUSE, 1,412 POSSIBLY_HOUSE, 476 UNKNOWN and 17 NOT_HOUSE results. These are unlabeled, not accuracy claims. Per-query real held-out results and separate profile-present/group metrics are in JSON.

### Representative behavior and failures

- Jonas Blue — *Edge Of Desire (Franky Rizardo Extended Remix)* and Fred again.. — *Delilah (Pull Me Out Of This)*: DEFINITELY_HOUSE, matching independent house labels.
- Daft Punk — *Burnin'* / *Revolution 909*: POSSIBLY_HOUSE, meaningful house tags conflict with other release-context tags. Broad album context still creates avoidable review.
- Drake — *Massive* / *Falling Back*: UNKNOWN, not excluded, but low review priority because the inherited catalog contains an incomplete non-house artist profile. Real rapper-house recall is still poor. Synthetic regression tests verify that actual track-specific house evidence outranks rap-artist context; they do not substitute for this missing real evidence.
- DJ BORING — *Winona*, Palms Trax — *Equation*, and Barry Can't Swim — *Sunsleeper*: UNKNOWN where useful catalog evidence is missing. Niche/emerging coverage is not established merely because the taxonomy recognizes their genres.
- Queen — *We Will Rock You*: POSSIBLY_HOUSE from conflicting release contexts; Beatles — *Let It Be*: POSSIBLY_HOUSE from weak/adjacent context. Both illustrate unnecessary review from release-level genre leakage.

## Recommendation and limits

Use this compact lookup as the simpler **experimental** engine for independently sourced metadata. It makes runtime/storage practical and improves supported-house coverage while protecting unknowns, but current evidence is insufficient to replace Housify's production classifier or promise low-effort review. The priority scheme needs independent validation; do not tune it against this same holdout. Better generic source coverage and more recording-specific evidence would be more useful than added runtime complexity.

The inherited SQLite input was selected around 60 artist names for the previous experiment. This builder processes all of it generically and introduces no benchmark artist filters, but cannot undo that source bias. Artist profiles are partial samples, normalized names may collide, inconsistent version spelling can miss matches, release tags can leak onto unrelated tracks, and textual aliases/durations cannot prove recording identity. Emerging/remix cases without trustworthy independent labels remain unadjudicated. No ISRC/audio matching claims are made.

This experiment uses only local Discogs metadata under the existing source's recorded provenance; Discogs describes its bulk database dumps as CC0 (see https://data.discogs.com/). CC0 metadata does not grant rights to audio/artwork or imply Spotify approval. No Spotify Content is ingested here, and no API terms interpretation is needed to run these independent local lookups. The previously identified Spotify analysis/transfer questions remain unresolved for any future integration: review current policy and obtain clarification as needed before connecting this experiment to Spotify-derived input or production review. No production permission is inferred from personal/local use.

## Validation

New tests exercise broad/configurable taxonomy, remix/featured-title normalization, independent rapper-house evidence, unknown rapper/house-artist priorities, mixed artist support, aliases, duration ambiguity, untagged alternatives, duplicate-pressing invariance, multi-genre/conflicting evidence, persistent overrides across reopen/index rebuild, no-network runtime, and pre-cap artist statistics. Test fixtures are synthetic and confined to tests; the reported evaluation uses the real local catalog.

Completed checks: `npm run typecheck`, `npm test`, Node tests for `local-catalog/*.test.ts`, `discogs/*.test.ts` and the new recall-first test file, Python Discogs importer tests (8), `npm run build`, and `git diff --check`. All passed. Native SQLite/type-stripping experimental warnings remain expected on this Node version.

Files added in this directory: `schema.sql`, `build.ts`, `consensus.ts`, `policy.ts`, `types.ts`, `classifier.ts`, `overrides.ts`, `query.ts`, `classifier.test.ts`, `holdout.ts`, `evaluate.ts`, `build-results.json`, `results.json`, and this README. The parent README links this experiment and its `.gitignore` excludes `recall-first/artifacts/`. Previous experimental work was preserved.
