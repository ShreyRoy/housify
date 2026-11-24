# Local genre catalog: research and isolated proof of concept

Research date: **24 November 2026**. Production functionality is unchanged. Nothing in this directory is imported by an application route or component. No Spotify requests, playlist exports, audio, credentials, ML models or paid services were used. The optional collection scripts make public metadata requests; the classifier and evaluation run entirely offline.

## Recommendation

Use **Discogs release styles as contextual evidence**, MusicBrainz identifiers for recording identity, and a compact SQLite catalog with explicit provenance. Do not replace the production pipeline yet. The preliminary experiment does **not** establish adequate genre coverage: speed is promising, but reliable recording identity and recording-specific annotations remain the bottlenecks. A larger local database removes network latency; it cannot manufacture missing genre evidence.

Start with an independently selected, mixed-genre electronic reference catalog, not a worldwide mirror or a house-only selection. Keep `UNKNOWN` separate from `NOT_HOUSE`. Artist and label distributions may suggest review candidates; they must never establish that every recording by a DJ is house.

## Dataset comparison

Sizes below are compressed downloads unless stated otherwise. Official manifests and two HEAD responses are preserved in [source-manifests.json](results/source-manifests.json). **No dataset archives were downloaded. Extracted sizes are planning allowances, not measurements or publisher guarantees.** Decimal GB/MB and binary MiB are distinguished.

| Dataset / inspected snapshot | Download | Extracted storage allowance, unverified | Updates / license | Practical role |
|---|---|---|---|---|
| Discogs, 2026-11-01 XML | Releases 10.6 GB; artists 477.6 MB; labels 87.5 MB; masters 605.0 MB. Rounded official listing. | Releases roughly 60–100 GB XML; all four roughly 70–120 GB. Streaming extraction avoids retaining this XML. | Monthly; official bulk index states CC0. | Best candidate for house styles and label/release context; not a recording genre oracle. |
| MusicBrainz, 2026-11-21 PostgreSQL exports | Core 7,763,611,441 bytes + derived 531,728,816 bytes = 8.30 GB decimal. | Roughly 50–90 GB core TSV plus 3–10 GB derived; full PostgreSQL with indexes needs additional headroom. | Twice weekly; core CC0, supplementary tags/genre associations CC BY-NC-SA 3.0. | Recording IDs, ISRCs, credited artists, releases and labels; sparse community genre evidence. |
| AcousticBrainz Genre Dataset, 2019 | Six Discogs/Last.fm/Tagtraum train/validation label archives total **96,717,524 bytes**. Entire Zenodo record is about 36.8 GB, mostly unnecessary acoustic features. | Label-only files roughly 0.5–1.5 GB. | Historical fixed dataset; generally CC BY-NC-SA 4.0, with a stricter AllMusic exception. | Small historical genre supplement and evaluation research, weak fit for recent releases. |
| FMA metadata, 2017 | `fma_metadata.zip`: 342 MiB. | Roughly 1–3 GB metadata. | Historical snapshot; metadata CC BY 4.0, audio has separate licenses. | Legitimate alternative with 106,574 tracks and 161-genre taxonomy, but unlikely to cover the requested recent commercial house catalog. |

The extracted ranges are deliberately broad budgeting estimates. Check real archive expansion and peak temporary/indexing space before an approved import. They are not measured compression ratios.

### Discogs first

The [official dump index](https://data.discogs.com/?prefix=data%2F2026%2F) publishes release, master, artist and label XML. Release records provide tracklists, positions, durations, credited artists, labels, catalog numbers, genres and detailed styles. Artist/label records add identity and descriptive information. Genre/style annotations describe **releases**, not independently labeled recordings. A multi-style album or compilation cannot safely assign all styles to every song. Master IDs group releases; they do not identify the exact audio recording or remix. ISRC is not a consistently populated, normalized per-track join key in these dumps.

My expectation that Discogs is the strongest candidate for underground house is based on its release/style structure and collector focus; **coverage was not measured against its dump**. Recent releases may appear quickly or late depending on contributors. It is not a guaranteed comprehensive catalog.

Stream the compressed release XML through a SAX-style parser, retaining selected release tracks and their contextual annotations. Keep referenced artist/label IDs, then stream those smaller files to resolve them. Skip masters initially unless pressing deduplication requires them. This still requires downloading/scanning the release archive; streaming is not selective remote access. Never infer recording equality solely from matching titles across pressings. Retain a source-specific release-track surrogate until a recording link is verified.

The bulk index's CC0 notice is the basis for this proposal. The [Discogs API terms](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use) distinguish permitted data from restricted material and impose separate API conditions. Do not assume a bulk license grants unrestricted retention of API responses, images, marketplace or user data. This prototype does not use the Discogs API, artwork, or marketplace data. Confirm the chosen dump's notice and any fields outside its stated scope before redistribution.

### MusicBrainz

The [official dataset description](https://metabrainz.org/datasets/postgres-dumps) and [data license](https://musicbrainz.org/doc/About/Data_License) separate core facts from supplementary data. Recordings, credited artists, releases, labels, durations, relationships and ISRCs can support identity. Genre/tag associations can exist at recording, release, release-group or artist scope; scope must be retained. Recording-level annotations outrank release and artist context. ISRCs can be missing or duplicated across entities, so corroboration is still necessary.

A PostgreSQL export is a set of related tables, not a ready SQLite catalog. A compact import requires joining recording/artist-credit/track/release/label/identifier/tag tables. An initial offline importer or temporary PostgreSQL staging instance may be justified for that step, but no new always-running service is needed for Housify. This PoC does not implement a full dump importer.

Beware the JSON shortcut: the inspected recording JSON archive is only about 34 MB because it contains **standalone recordings**; recordings attached to releases are embedded in the much larger release JSON archive (about 21 GB compressed). This behavior is explicit in MusicBrainz's [official DumpJSON implementation](https://github.com/metabrainz/musicbrainz-server/blob/master/admin/DumpJSON). It is not a small complete recording catalog. Artist and label JSON archives alone cannot provide reliable track genres.

### AcousticBrainz and FMA

The [AcousticBrainz Genre Dataset project](https://mtg.github.io/acousticbrainz-genre-dataset/) combines four sources. AllMusic and Discogs labels originate at album/release scope; Last.fm and Tagtraum provide track tags. Retain the original scope even where the distributed table attaches a release label to a recording ID. Recording MBIDs offer useful joins, subject to redirects and dataset age. It is not a comprehensive current artist/label/ISRC catalog.

The [Zenodo metadata](https://zenodo.org/records/2553414) distinguishes small label archives from large feature archives. AllMusic is separately distributed and limited to noncommercial scientific research; personal application use should not be presumed covered. Other components' noncommercial/share-alike requirements still matter. AcousticBrainz feature licensing is not the genre dataset's license. The [AcousticBrainz project](https://acousticbrainz.org/) stopped collecting new submissions in 2022; this particular genre snapshot is older still. It cannot cover 2026 releases. No features or audio are needed here.

The [FMA authors' repository](https://github.com/mdeff/fma) documents a metadata-only download, artist/album/track information and genre taxonomy. It is useful for independent music research, not a demonstrated source of KETTAMA/Prospa coverage. Neither FMA nor AcousticBrainz should be the primary source for this project. A manually maintained catalog of licensed artist/label submissions could supplement difficult recent recordings, but would require permission and ongoing editorial work; restricted store scraping is not proposed.

## Preliminary coverage experiment

[benchmark.ts](benchmark.ts) selects **18 real recordings independently of Spotify**, with public identity/reference URLs. This is the explicitly permitted smaller preliminary experiment, not the requested full 100-recording evaluation. Mainstream, underground, recent and unrelated strata have three examples each; adjacent has six. “Recent” means the preceding 12 months as of the research date. Popularity strata are qualitative selections, not measured audience rankings.

Examples include Daft Punk and Stardust; KETTAMA's Ard House Mix and Comes and Goes; Prospa's Don't Stop (Extended Mix); Josh Baker's Back It Up and My Place collaboration; Franky Rizardo's Shinjuku; Fred again..'s contrasting Marea and leavemealone; Bicep's Glue and Four Tet remix; garage, trance, techno candidates; and country, rock and jazz controls. Version/date and genre sources are separate where possible. Some entries remain unadjudicated; a title containing “House Mix” is not ground truth.

Public MusicBrainz discovery made **41 requests**, downloaded **533,849 response bytes**, with at least 1.5 seconds between starts, a public contact User-Agent, timeouts and bounded retries. It searched up to ten recording candidates per query and inspected details plus one release only after a corroborated candidate match. This bounds requests but limits recall. This is **API discovery coverage under this matching procedure**, not full-dump coverage.

| Stratum | Artist-name found | Unambiguous title/version candidate | Recording genre/tag evidence among matched candidates | Label among inspected releases |
|---|---:|---:|---:|---:|
| Mainstream | 3/3 | 0/3 | Not observed | Not observed |
| Underground | 3/3 | 0/3 | Not observed | Not observed |
| Recent | 3/3 | 2/3 | 0/2 | 2/2 |
| Adjacent | 6/6 | 1/6 | 1/1 (tag, not genre field) | 1/1 |
| Unrelated | 3/3 | 0/3 | Not observed | Not observed |
| Total | **18/18** | **3/18** | **1/3** | **3/3** |

All three matched recording objects contained ISRCs. All three recording `genres` arrays and inspected release genre/tag arrays were empty. Fred again..'s leavemealone supplied a recording `drum n bass` tag. Franky Rizardo and Josh Baker matches supplied identity but no usable genre evidence. Uninspected fields are null/not observed, not counted as confirmed absent.

**Exact recording match accuracy and ISRC matching accuracy remain unmeasured**: the benchmark did not provide independently verified recording IDs, durations or input ISRCs. The 3/18 figure is a conservative name/version proxy, not exact identity accuracy. Ambiguity among versions, duplicate entries and restrictive candidate selection explain many failures; a failed match does not prove MusicBrainz lacks the song. Artist-name presence is not verified person/entity identity either. No mainstream-versus-underground coverage conclusion is justified by three candidates in each group.

Only **six entries** have recording-specific independent reference labels suitable for strict preliminary scoring; provisional, release-level and missing gold are excluded. The offline classifier returned **17 UNKNOWN and 1 POSSIBLY_HOUSE**, with no definite positives or exclusions. There were zero definite false positives and zero explicit false negatives, but all three strict-gold house recordings were abstentions: definite-house recall including abstentions is **0%**, and definite-house precision is undefined. This is **not evidence of good accuracy**. Full results, explanations, denominators and caveats are in [pilot-results.json](results/pilot-results.json); collection observations are in [coverage-observations.json](results/coverage-observations.json).

For a useful next evaluation, curate 20 entries per requested stratum with exact version, independently sourced ISRC/MBID where possible, duration, release date and track-specific reference label. Have a second reviewer adjudicate ambiguous genre boundaries; preserve genuine ambiguity. Freeze a catalog snapshot and hold the benchmark out of catalog selection. Report retrieval recall, identity precision, field coverage, classification precision/recall, abstention rate, remix errors and each stratum separately. Compare Discogs contextual coverage against MusicBrainz identity coverage before choosing a production strategy.

## SQLite architecture and matching

[schema.sql](schema.sql) implements sources; artists; labels; recordings; recording artists with primary/featured/remixer roles; recording identifiers; releases; ordered release tracks; release labels; genres; scoped annotations; and cached artist/label genre distributions. Source rows carry URL, license, version and collection time. Annotation provenance survives classification. Indexes cover IDs, normalized artist names, title/version/primary-artist combinations and ISRCs.

Runtime is a local TypeScript lookup in the existing server backend, with a read-only SQLite file in a future integration. Importing and precomputing distributions happen offline. This experiment uses Node 22's built-in experimental `node:sqlite`, adding no dependencies. Validate the project's deployed Node/runtime support before production use; synchronous methods should be batched/yielded or moved to a worker for very large jobs. Do not bundle a database into browser JavaScript.

The implemented order is recording ID, then ISRC, otherwise normalized title + primary artist + exact normalized version signature. Any supplied identifier still requires title/artist/version corroboration; supplied durations must agree within 12 seconds when catalog duration exists. Identifier conflicts abstain rather than silently falling back to another recording. Multiple candidates abstain. An absent catalog duration does not verify duration agreement. Aliases, transliteration, changed punctuation and artist-credit order remain limitations; production pure normalization/version helpers are reused, but no broad fuzzy match is trusted.

Future additions should include source-specific alias tables and reviewed cross-source recording links. Preserve featured credits and remixer identity separately from the primary artist; require exact version context before merging an original, radio edit, extended mix or remix. Discogs releases sharing a master must not collapse all versions into one recording.

Profiles count **unique catalog recordings**, excluding compilation release context and duplicate pressings. Store house/adjacent/other counts, tagged count, total catalog count, source IDs and the entire policy configuration. Minimum support is five recordings for artist/remixer fallback and ten for label fallback, with at least 40% tagged coverage. This is a distribution over the imported sample, **not a complete discography**. House-only extraction would bias it badly; retain adjacent and unrelated recordings for the same artists/labels, disclose scope, and prefer minimum independent-release support before production use. A multi-tagged recording can contribute to more than one family; these are overlapping proportions, not probabilities summing to one.

## Deterministic classification

[policy.ts](policy.ts) reuses the existing genre taxonomy, including house subgenres, with per-tag overrides for subjective boundaries such as garage. Existing production categories are untouched; the experimental four-category type is separate.

Implemented weights are recording 0.90, release 0.55, artist 0.25, remixer 0.20, label 0.15. Recording/release weights scale by match confidence; profile weights scale by family proportion and catalog tag coverage. Correlated evidence is combined by taking the strongest signal per family, **not summing release, artist and label evidence into false certainty**.

`houseScore = clamp(50 + 50 × strongestHouse − 50 × strongestOther, 0, 100)`.

- `DEFINITELY_HOUSE`: recording-level house strength at least 0.70, score at least 80, and no substantial house/non-house conflict.
- `NOT_HOUSE`: recording-level other-genre strength at least 0.70, score at most 20, and no substantial conflict.
- `POSSIBLY_HOUSE`: house context, adjacent genre evidence, or matched but inconclusive evidence; conflicting strengths of at least 0.30 require review.
- `UNKNOWN`: no sufficient evidence. Profile-only non-house evidence cannot automatically exclude a recording.

Release-only house annotations therefore suggest review rather than a definite inclusion. This deliberately limits the usefulness of Discogs-only classification and must be evaluated before relaxing the rule. Confidence is the strongest evidence strength × 100, halved for substantive conflict, with UNKNOWN forced to zero. It expresses **heuristic evidence strength**, not a calibrated probability of house; an adjacent recording can have high evidence confidence and a neutral house score. Results include match confidence separately, matched identity, source licenses, individual evidence and explanations.

## Measured performance and storage

The public pilot's three-recording database occupied **143,360 bytes**; import took about **2.16 ms**, with 360 warm in-memory lookups at median **0.035 ms**, p95 **0.140 ms**. This tiny query-selected catalog says little about real capacity.

The separate synthetic engineering test imported **10,000 recordings**, artist/label memberships and annotations into a **9,404,416-byte SQLite file** in about **741 ms**. Across 5,000 warm lookups, median was **0.188 ms**, p95 **0.257 ms** on this machine (Node 22.16.0). This measures code/index operation, not coverage, genre accuracy, cold I/O or concurrent Next.js workloads. See [synthetic-performance.json](results/synthetic-performance.json).

Linear extrapolation at this sparse synthetic shape gives approximately **94 MB for 100,000 recordings**, not a measured production database size. Budget approximately **100–500 MB** for a 100,000-recording subset with richer aliases, identifiers, releases, provenance and indexes, then measure an actual import. Do not project warm lookup timings linearly into a promised playlist completion time. UI batching, database opening, worker scheduling and result serialization are not benchmarked. Worldwide catalog import time and expanded size remain unverified.

## Running and checking the isolated PoC

From the repository root, using Node 22.16 or compatible Node 22 with built-in SQLite:

```sh
node --experimental-transform-types --test experiments/local-catalog/catalog.test.ts
node --experimental-transform-types experiments/local-catalog/evaluate.ts
node --experimental-transform-types experiments/local-catalog/stress.ts
npm run typecheck
npm test
npm run build
```

Evaluation uses the checked-in public metadata sample and writes local SQLite/results files; it makes no HTTP requests. Stress data is explicitly synthetic engineering data, separate from real-song coverage. SQLite files are ignored by this directory's `.gitignore`. No environment variables or Spotify login are required. Node prints experimental API warnings.

Validation completed: 11 isolated classifier tests and 54 existing repository tests passed; TypeScript checking and the production build passed. New files are confined to this experiment directory. Existing diagnostic files were left unchanged.

Optional research refresh commands, **which do use the network**, are:

```sh
node --experimental-transform-types experiments/local-catalog/inspect-sources.ts
node --experimental-transform-types experiments/local-catalog/collect-pilot.ts
```

The first requests small public manifests and HEAD sizes only; it does not download archives. Its snapshot paths are fixed and should be reviewed for a future research date. The second overwrites the small MusicBrainz pilot artifacts, caps requests/responses/time, uses the public repository contact, and respects rate limits with bounded retry. It is not a runtime enrichment provider. It examines only one release per matched recording, so missing release annotations are not a catalog-wide absence. [data/LICENSE.md](data/LICENSE.md) records attribution and license boundaries.

## Policy separation and implementation plan

The independent data licenses govern this catalog; they do not automatically authorize a later Spotify integration. Before connecting it, separately review the then-current [Spotify Developer Policy](https://developer.spotify.com/policy), particularly III.13 (analysis), III.9 (transfers), III.5 (cross-service integration), and III.14 (AI/ML), together with the [Developer Terms](https://developer.spotify.com/terms). Ambiguities include whether deterministic genre categorization of linked playlist tracks is prohibited analysis, and whether identifier/name joins or associated transfers fall within restrictions. Local/personal operation is not an assumed exception. This work makes no assertion of Spotify approval and does not test those boundaries through production behavior.

Recommended next steps, after review:

1. Finish the independent 100-recording benchmark and identity/gold adjudication first. Do not lower matching standards to improve a headline coverage number.
2. Review the source licenses and storage budget; explicitly approve the large-download/import step. Stream one fixed Discogs snapshot into a mixed-genre subset, preserving release-only scope. Add MusicBrainz identity data where justified by measured joins. This importer is **not implemented** here.
3. Measure coverage on held-out recent/underground/remix examples, compare distributions with their true catalog support, and measure database/import costs. Stop or use manual review if evidence remains too sparse. More deterministic evidence is a better next investment than an ML model on incomplete labels.
4. If coverage and policy review support proceeding, adapt the local provider behind the current server-side enrichment interface. Keep Spotify IDs/order in the existing application layer; independent catalog IDs and provenance remain separate. Preserve auth/UI and the existing pipeline until explicitly choosing to switch. Provide bounded batches, cancellation and partial results at that later integration step.
5. Refresh imports offline on an intentional monthly cadence, rebuild a versioned SQLite file and atomically swap it after checks; retain the previous file for rollback. Do not add a database server or background scheduler for this personal MVP.

Open limitations: no full-dump coverage measurements, no dump importer, no independently verified exact-recording/ISRC benchmark, no validated 100-track accuracy, sparse genre evidence, incomplete artist/label discographies, conservative matching that loses recall, experimental Node SQLite support, and unresolved future Spotify policy interpretation. These are reasons to review before replacing the working production pipeline.
