# Discogs implementation experiment

**Measured results:** [MEASUREMENTS.md](MEASUREMENTS.md), with the full [results.json](results.json). The approved archive was imported and evaluated: 19.58 million releases scanned, a 2.71 GB SQLite catalog generated, and 100 real candidates tested. Identity ambiguity and a high manual-review rate still prevent recommending a production switch. Genre gold is independently reviewed for 65 entries; a fully audited 100-recording genre/identity benchmark remains unfinished.

This is an offline experiment. Production authentication, routes, playlist behavior and UI are unchanged. It reuses the experimental SQLite schema and TypeScript classifier, along with the production **pure** normalization and genre helpers. It does not import Spotify data or connect the catalog to Spotify. Python is used only for the bulk import; classification stays in TypeScript. No dependencies, services, audio processing or ML were added.

## Source and storage approval

The fixed source is the [official 2026-11-01 releases dump](https://data.discogs.com/?download=data%2F2026%2Fdiscogs_20261101_releases.xml.gz). Exact compressed size: **11,361,019,345 bytes**. The preflight found approximately **611 GB free** and estimated a **30 GB peak budget**, with an **8 GiB SQLite cap**. The user explicitly approved the download and capped import. No artist, label, master or MusicBrainz dump was downloaded. The XML is decompressed as a stream and never saved uncompressed.

[preflight.json](preflight.json) records the size/approval. The server omitted size on HEAD and ignored a one-byte Range request; that response body was canceled after reading its size header. [checksums.txt](checksums.txt) is the small official manifest; [verification.json](verification.json) records the downloaded archive's matching SHA-256. Large archives, databases, journals and logs live in ignored `artifacts/` and must not be committed.

`archive.ts` verifies the official SHA-256 before promoting a completed `.part` download. Interrupted HTTP downloads can resume only if the server honors Range; otherwise the utility refuses to append a second archive and requires explicit `--restart-partial`. This is separate from SQLite import checkpoint/resume.

## What is implemented

- `import.py`: standard-library gzip reader, bounded XML release framing and incremental `XMLPullParser`, prepared SQLite statements, batched transactions, progress statistics, database/free-space guards and safe checkpoints. Each committed checkpoint includes its data; an interrupted partial batch rolls back.
- `schema.sql`: additional release type/track count/style count/format/master context, explicit unverified candidate identities, source positions/credits, label catalog numbers, tag kinds, aliases and import state. Original release annotations remain release-scoped.
- `prepare.ts`: streams retained records through the existing TypeScript normalization helpers, corrects any Python normalization differences, builds profiles using SQL aggregation and runs SQLite statistics. No giant JavaScript object graph is required.
- Contextual release rules in `../policy.ts` and `../catalog.ts`. `query.ts` performs a real offline lookup. `evaluate.ts` produces the actual-data benchmark and performance report.
- Python restart/corruption/import tests and TypeScript contextual/cross-language integration tests. Synthetic test inputs are only tests; they are not used for real-data coverage metrics.

The reader buffers at most a 16 MiB release plus a 1 MiB input chunk and parser overhead. It rejects DTDs, CDATA and XML comments because those require different framing; it does not silently misparse them. This is appropriate for the inspected official dump format, not a universal XML parser. Skipped releases are framed but not XML-parsed. Selected records, the envelope and gzip integrity are checked; a corrupt selected record fails without advancing its transaction checkpoint.

SIGINT/SIGTERM requests stop at a release boundary. Resume validates the archive fingerprint, extraction options and source metadata, replays gzip from the beginning, skips already committed releases, then continues. It does **not** claim efficient random seeking into gzip. A completed import is an immediate no-op on rerun. A different archive/options combination requires a new database. Count caps can be explicitly increased on restart. The directory contains a fixed snapshot experiment, not an automatic background importer.

Prefix replay emits progress and can be canceled without moving the saved checkpoint backwards. It is finite but may take minutes for a large checkpoint; it is not an efficient seek implementation.

## Scope and sampling

`--scope electronic` retains Electronic releases across all styles; `--scope all` retains everything, subject to caps. `--scope artists --artists artists.json` scans the entire releases snapshot for an explicit independent artist list, retaining their credited tracks across **all genres**, including collaborations and remix credits. Only relevant tracks are retained from unrelated-artist releases/compilations; original track positions and **full source track counts** remain available. Primary and featured credits are separate from remixer credits. Unscoped release-level remix credits are interpreted as applying to the release; ambiguous source crediting remains a data-quality limitation.

The measured experiment uses the artist scope and the checked-in 60-name list, fixed before classification evaluation. This is deliberately targeted to the benchmark artists. It tests retrieval within that scope, not coverage of arbitrary music. Label profiles consequently describe those artists' imported releases, **not complete label catalogs**. No claim of complete artist discographies is made: missing entries, artist aliases, credit variants and snapshot lag still apply.

Tradeoffs:

| Scope | Advantage | Cost / bias |
|---|---|---|
| House-only | Smallest catalog | Strong selection bias; cannot estimate artist/label genre distributions or meaningful negative coverage. Not implemented as a recommended scope. |
| All electronic styles | House, techno, garage, trance and electronic negatives together | Larger; misses non-electronic work by otherwise electronic artists and biases their profiles. |
| Selected artists, all genres | Compact, includes multi-genre work and unrelated controls | Does not generalize beyond the selected artists; labels remain incomplete. Used here. |
| Broad mixed-genre catalog | Better distribution denominators and wider identity retrieval | Much larger database and import cost; must measure before broadening the approved budget. |

A later second pass could retain non-electronic releases for discovered artist IDs and the complete catalogs of a bounded set of labels. Reuse the same releases archive; do not download new dumps. Very large labels can cause an explosion in scope, so select and budget them explicitly. This experiment avoids that expansion: artist/remixer profiles can gate short-EP promotion, but **label profiles alone cannot promote a release to definite**.

Duplicate pressings with a known master, exact artist credits, normalized title/version, duration and remixer credits can share a **candidate group**. Without corroborating master/duration context they remain release-local candidates. No Discogs track is declared a verified recording. Multiple plausible candidates still abstain. For profile support only, identical normalized title/version/primary-artist/duration keys are counted once across pressings, preventing repeated releases from manufacturing support. That aggregation is not a recording-identity assertion. No release-level ISRC is assigned to every track.

## Revised contextual policy

All weights and thresholds are in [policy.ts](../policy.ts). Four categories remain separate. Missing metadata still yields `UNKNOWN`, not `NOT_HOUSE`. Identity checks remain exact on normalized title, primary artist and version; available durations must agree within the existing 12-second bound. Competing candidates are not resolved by choosing the most house-like one.

Evidence uses the **maximum strength per genre family**, so correlated release/artist/remixer/label signals do not add up to artificial certainty. House score remains `clamp(50 + 50 × house − 50 × other)`. House-versus-other **or house-versus-adjacent** conflicts at 0.30 require review.

- Recording-level annotations retain weight 0.90.
- An unambiguous single-track, non-album, non-compilation release with explicit styles from one known family and no unknown styles can use weight **0.94**, scaled by identity confidence. At name-match confidence 95, its house score is about 95 and it can be `DEFINITELY_HOUSE`.
- A short EP (up to four source tracks) with homogeneous styles can use **0.80** only with sufficiently supported artist/remixer context. This is a conditional gate, not additive scoring.
- Albums use **0.35**; mixed/insufficiently specific release context is capped at **0.40**. Other release context remains **0.55**. Compilations and DJ-mixed releases provide no track-assigned release genre evidence.
- Artist, remixer and label profiles retain weights **0.25 / 0.20 / 0.15**, minimum support **5 / 5 / 10** and 40% tagged coverage. Profiles alone cannot create definite inclusion/exclusion.
- Definite decisions require eligible evidence strength at least **0.70**, identity confidence at least **95** for contextual promotion, house score at least **80** or at most **20**, and no substantial conflict. Up to three styles are allowed for homogeneous context. These are precision-oriented initial heuristics, not calibrated probabilities.

Each result explains the match, source scope, weights, release type/track count/style count and why promotion was or was not allowed. Evidence links back to original Discogs releases. `confidence` describes evidence strength; `houseScore` describes house support. They are not interchangeable probabilities. Source ambiguity and disagreements between independent genre references remain reasons for manual review.

## Benchmark and measurement interpretation

[benchmark.ts](benchmark.ts) contains 100 independently selected real candidates: 20 each mainstream, underground, recent, adjacent and unrelated. It includes the requested artists, remixes, extended mixes, collaborations, multi-genre artists and difficult versions. Dates refer to independent references, not dates discovered from the classifier catalog. Recent-only metrics require an independently established release date in the trailing year. Album tracks released earlier as singles may be reissued within that window; this is not necessarily their first-ever release.

[references.ts](references.ts) contains track-specific genre reference judgments reviewed separately from Discogs; URLs are embedded in every gold entry. Original studio references do not automatically label arbitrary remixes/live versions. Retailer track genres are editorial/catalog judgments, not universally agreed musical truth. Conflicting reviews, unresolved identities and unadjudicated genres remain outside strict accuracy denominators. The report exposes those counts. **100 candidates does not mean 100 fully audited ground-truth recordings.**

The split is fixed before real-data evaluation: every fourth candidate is tuning, others held out. Rules were developed with separate synthetic policy fixtures, not tuned to held-out classification results. Related tracks from the same album appear across splits, so this is not an artist/album-independent generalization test. Artist-targeted extraction is another source of selection bias.

The generated `results.json` reports candidate retrieval, artist-name presence, direct genre/style availability, definite-house precision/recall, definite-plus-possible recall, definite false-positive rate, unknown/manual-review rates, and strata separately, always with numerators/denominators. Unknowns remain in recall denominators. Exact recording retrieval recall and identity precision are explicitly unavailable without a separately audited identity gold set. Title/version/duration corroboration is a proxy; it must not be mislabeled as exact accuracy.

Performance measurement uses the actual imported catalog. It records import elapsed time/RSS, counts and final SQLite size; fresh-connection and warm latency; and distinct 2,000-record batches with ID lookup and title-only matching separately. Fresh-connection measurements include opening the database, but the OS filesystem cache is warm from import. **OS-cold disk latency is not measured**; no system-wide cache purge is performed. Catalog-derived queries measure throughput only, not accuracy. Import timings include intentional checkpoint/replay overhead and exclude the initial scope-development trial.

## Reproduce and inspect

Use Python 3.10+ on macOS/Linux and this project's Node 22 with experimental built-in SQLite. From the repository root:

```sh
# Offline verification if archive already exists. Substantial download requires
# explicit authorization: add --download-approved only after reviewing preflight.
node --experimental-transform-types experiments/local-catalog/discogs/archive.ts

python3 experiments/local-catalog/discogs/import.py \
  experiments/local-catalog/discogs/artifacts/discogs_20261101_releases.xml.gz \
  experiments/local-catalog/discogs/artifacts/selected.sqlite \
  --snapshot 2026-11-01 \
  --source-url 'https://data.discogs.com/?download=data%2F2026%2Fdiscogs_20261101_releases.xml.gz' \
  --scope artists --artists experiments/local-catalog/discogs/artists.json \
  --max-retained 1000000 --max-database-gib 8 --batch 50000

node --experimental-transform-types experiments/local-catalog/discogs/prepare.ts
node --experimental-transform-types experiments/local-catalog/discogs/evaluate.ts
node --experimental-transform-types experiments/local-catalog/discogs/query.ts \
  'Franky Rizardo' 'Love Me Right' 188000
```

Do not run finalization/evaluation while the importer is writing. They require a complete import, not a capped/partial scan. Read-only classification does not mutate the database. For a deliberate fresh rebuild, use a new database filename; pass it to `prepare.ts` and `evaluate.ts`. Source snapshot, importer, artist list, policy and normalization are all versioned inputs. Reproducibility means equivalent catalog content/rules, not byte-identical SQLite files or collection timestamps.

```sh
python3 -m unittest discover -s experiments/local-catalog/discogs -p 'test_*.py'
node --experimental-transform-types --test experiments/local-catalog/catalog.test.ts experiments/local-catalog/discogs/*.test.ts
npm run typecheck
npm test
npm run build
```

## Licensing and what remains separate

The [official bulk index](https://data.discogs.com/) states CC0 for its downloadable data. This import retains catalog facts, styles and credits with release/snapshot provenance; it excludes images, audio, marketplace records and user profiles. It uses no Discogs API or restricted scraping. The [API terms](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use) have separate restrictions, so do not substitute API responses and assume identical offline retention rights. Independent benchmark references are factual observations and links, not copied articles or a second scraped catalog. No affiliation/endorsement is claimed.

MusicBrainz may still be useful as an **optional identity bridge** for independently sourced ISRCs/recording IDs and ambiguous versions; its genre API need not remain a per-track runtime dependency. A full MusicBrainz mirror is not justified by this experiment. Whether a targeted identity bridge improves measured identity precision/recall still needs a verified identity gold set. Stronger aliases/credit handling, explicit reviewed recording links and carefully bounded label expansion should be evaluated before any ML approach.

Remaining limits include source contribution/snapshot lag, ambiguous versions and durations, incomplete aliases and credits, candidate grouping that is not verified audio identity, incomplete label profiles, partially adjudicated genre/identity gold, correlated benchmark albums, OS-warm performance measurements, and Node's experimental SQLite API. Future Spotify integration policy questions remain unresolved; this experiment does not connect independent classifications to Spotify or assert Spotify approval.
