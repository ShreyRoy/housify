# Genre-first catalog expansion

This experiment expands the **data**, retaining the existing recall-first policy, consensus logic, classifier, review queue and override mechanism. It does not connect to Spotify or change production UI/authentication. No dataset downloads, services, runtime enrichment or dependencies were added.

## Completed results

Both import passes, all 32 compact-index partitions, integrity checks and evaluations completed. The final index is **8.92 GB**, with **23.63 million duration-specific lookup rows**, **18.35 million normalized title/version groups** and **1.24 million canonical artist keys**. Peak artifacts were conservatively estimated at **34.37 GB**, aggregate SQLite at **21.43 GiB**, within the user-approved 45 GB / 24 GiB limits.

House recall across definite plus possible improved from **9/14 to 14/14** on the existing set and **5/12 to 12/12** on the fresh set. No adjudicated house tracks were excluded. Automatic definite recall remains low and most tracks still require review. Read [REPORT.md](REPORT.md) for precision denominators, review ranking, failures, timings and recommendations; raw measurements are in [results.json](results.json), [probe-results.json](probe-results.json) and [preprocessing-measurements.json](preprocessing-measurements.json).

Validation completed: TypeScript checks, 54 application tests, 30 existing catalog tests, 9 expansion tests, and production build. Production functionality is unchanged. The previously paused job resumed under explicit 24 GiB approval and completed; no fictional or partial results substitute for the evaluation.

## Extraction

The existing November 2026 releases archive contains 19,575,942 records. A bounded scan enumerated its 769 genre/style labels. `taxonomy.ts` evaluates these using the existing TypeScript `genreFamily` and fixed `POLICY`; Python does not implement a second taxonomy. Tags are read only from genre/style XML elements. Broad Electronic is included because the current policy treats it as adjacent. Genre counts overlap: 5,028,304 Electronic, 722,772 House, 222,410 Tech House, 213,588 Deep House, 503,807 Techno, 294,135 Trance, 43,842 Garage House, 41,626 UK Garage and 92,774 Breaks annotations. These counts are not unique-track counts.

Pass 1 retains **every** release with any house/adjacent tag from that fixed taxonomy, with all available tracks/versions and primary, featured and remixer credits. Artist names never determine pass-1 scope. Compilation tracks remain candidates but the unchanged builder supplies them no genre votes. Only artists credited on non-compilation genre-first releases seed pass 2, preventing a stray compilation appearance from importing unrelated discographies.

Pass 2 scans the same archive and retains broader releases across all genres for those discovered artist IDs. On otherwise unrelated multi-artist releases, only tracks credited to discovered artists/remixers are retained. Full release track counts, compilation status and original release-context genre tags remain available to the existing reliability rules. Thus profiles are not computed exclusively from house-tagged releases. This still produces a selected metadata sample, not a claim of exhaustive discographies or audio identity.

`import.py` reuses the existing streaming XML framing/parser, credit reader, duration parser and safety checks. The new staging schema stores only fields needed by the current builder, plus featured/remixer credits and raw aliases. Numeric Discogs IDs and shared exact raw-title/primary-artist/duration candidates avoid label tables, catalog numbers and pressing-level SHA candidate overhead. This is storage engineering, not additional identity resolution: separate releases still supply their original annotations; exact textual/duration candidates are not claimed to be the same audio recording. The runtime normalization/version and consensus rules remain unchanged. Provenance release IDs in this staging input are numeric Discogs release IDs.

A source-equivalence regression test imports the same independent synthetic evidence through the old and new staging writers, builds both indexes, and compares track evidence/decisions and artist statistics. Other tests cover genre discovery, broader non-house evidence, version and remixer retention, compilation safeguards and checkpoint/resume consistency.

## Run and storage

From the repository root with Node 22.16+ and Python 3, using the existing downloaded archive:

```sh
python3 -u experiments/local-catalog/expanded/census.py experiments/local-catalog/discogs/artifacts/discogs_20261101_releases.xml.gz experiments/local-catalog/expanded/artifacts/census.json
python3 -u experiments/local-catalog/expanded/run-import.py --max-total-gb 45 --max-sqlite-gib 24 --max-aggregate-sqlite-gib 24
python3 experiments/local-catalog/expanded/build.py --max-total-gb 45 --max-sqlite-gib 24 --max-aggregate-sqlite-gib 24
node --experimental-transform-types experiments/local-catalog/expanded/evaluate.ts
node --experimental-transform-types experiments/local-catalog/expanded/probes.ts
node --experimental-transform-types experiments/local-catalog/expanded/query.ts 'DJ BORING' 'Winona'
python3 -m unittest discover -s experiments/local-catalog/expanded -p 'test_*.py'
```

The importer commits resumable checkpoints and refuses changed archive metadata or taxonomy options. Restart repeats the gzip prefix; it is not random-access seeking. SIGINT/SIGTERM stops at a release boundary. Completed passes are skipped. Each pass must finish before the compact builder accepts the source. The vocabulary scan and diagnostic audit also validate the archive envelope and gzip integrity but only selected release XML is parsed by the importer.

Initial free disk was approximately 598 GB. Existing archive, old catalog and old index total approximately 14.1 GB. The original budget was 30 GB total / 8 GiB per database; the later explicit approval supersedes it with 45 GB total / 24 GiB aggregate SQLite. The first 100,000-record pilot used 63,975,424 bytes; its heavily electronic prefix was not representative of the full archive. Import checks source size, WAL growth, free space and progress every 10,000 records. SQLite page limits additionally prevent unbounded file growth. A storage stop preserves committed checkpoints, never a falsely complete source.

`build.py` runs the existing builder against new output paths, monitoring visible artifacts plus unexplained filesystem free-space loss to account conservatively for unlinked SQLite temp files. Concurrent disk activity can inflate that estimate; it is not exact process-attributed disk accounting. The old catalog, old compact index, old results and independent manual override database are preserved. No new overrides are seeded or used in accuracy evaluation. `query.ts` can read the existing independent override store using the same explicit independent-reference key; rebuilding never replaces it. All large artifacts and logs are ignored under `artifacts/`.

## Evaluation design

`evaluate.ts` compares **both compact catalogs using the same RecallClassifier and POLICY**, identical queries and no manual overrides. It reruns the previous 40 candidates and adds 22 fresh candidates in `holdout.ts`, with zero artist/title/version overlap against both previous sets. Seventeen fresh candidates have independently sourced labels; five stay unadjudicated, including remixes whose original labels do not establish their genre. References are recording-specific reviews or version-specific retailer metadata where available, with fallibility and boundary judgments explicitly noted. They are not derived from the Discogs catalog being evaluated.

`frozen-inputs.json` records the classifier, consensus, policy, override and fresh-case hashes before expanded results. Final independent-reference verification before running expanded evaluation left the extended DJ Koze version unadjudicated: a retailer calls it Nu Disco while the original has disco-house reviews. No rule/ranking tuning is part of this experiment. The shared builder's only changes are source-scope reporting and bounded memoization of its existing pure title/name helpers; classification calculations are unchanged.

Metrics separate DEFINITELY_HOUSE, POSSIBLY_HOUSE and UNKNOWN. UNKNOWN is accessible in review; 100% retained-house recall alone does not establish usefulness. Accuracy denominators exclude unadjudicated labels. Review ranking includes original ordering and 20 label-independent deterministic permutations to expose input-order sensitivity. Timing workloads contain 2,000 distinct catalog recording/version/duration groups from each catalog, submitted identically to both engines. Neither timing set supplies accuracy ground truth; machine cache/order/load are uncontrolled.

`audit.py` is a separate **read-only diagnostic** whose probe names never control extraction. Its full-archive results are retained in `source-audit.json`: 13 exact original-title matches for Drake — Massive, 12 Falling Back, 9 DJ BORING — Winona, 15 Palms Trax — Equation, and 8 Barry Can't Swim — Sunsleeper. Duplicate pressings are not independent genre evidence. The audit establishes that source records exist under those titles/credits, not that their release tags establish the track genre. `probes.ts` checks which of those releases survive extraction, whether the fixed matcher reaches the compact groups, and the resulting decisions. Other candidate diagnoses distinguish retained-source absence, version/duration matching limitations, compaction omissions, and insufficient/conflicting evidence; absence in retained data alone is never called full-archive absence.

## Scope limits

Release annotations can leak across heterogeneous albums; the unchanged classifier therefore still routes many tracks to review. Remixer credits are retained as metadata, but the existing compact key uses named title/version signatures and primary artist identity, not a new credit-based identity resolver. Missing version names, aliases, duration differences, artist-name collisions and incomplete community submissions remain limitations. Artist affinities never justify automatic exclusion. Rare house releases from otherwise non-house artists are admitted by release metadata without needing any known-artist list.

This is independent local Discogs metadata only. Existing CC0 source provenance is retained. No audio/artwork rights or Spotify approval are inferred; Spotify production integration remains a separate unresolved policy question. The experiment makes no Spotify requests and processes no Spotify Content.

### Measured storage warning

[storage-pilot.json](storage-pilot.json) records a separate bounded storage-only sample: 44,015 candidate rows selected by primary artist ID modulo 100 from 4,567,715 candidate rows then available in the chronological prefix. The sample compact index used **12,046,336 bytes**, implying roughly **1.25 GB** of compact data for that prefix. This is a rough, nonrandom storage extrapolation, not classification evaluation or a complete imported catalog; it excludes the broader second pass. This warned of substantial full-catalog storage but was not a reliable final-size estimate. Current authorization and the preserved checkpoint are recorded above and in [approved-limits.json](approved-limits.json). The commands enforce the approved limits; they are reproducibility commands; the completed published index is already available.

Importer write optimization: genre IDs are cached in a small per-run dictionary, identical artist/alias writes are deduplicated within each release, and newly inserted recording IDs come from the insert cursor instead of an unnecessary second lookup. These do not change selection, title/version normalization, consensus or scoring. The source-equivalence regression test covers the resulting track evidence and artist profiles. A controlled transaction abort restarted the live second pass at its last committed checkpoint (3,970,000 scanned); the deliberate restart is visible in `artifacts/import.log`. Committed data was preserved and the gzip prefix is replayed on resume. Both full passes subsequently finished successfully; the source completion marker is set.

### Bounded offline preprocessing

`build-index.ts` sorts existing normalized canonical artist keys into 32 contiguous UTF-8 work partitions. All IDs and aliases sharing that key stay together, along with their full track/release evidence; no names, titles or gold labels select a partition's scope. It creates one temporary source subset, invokes the **existing recall-first consensus/profile builder with the same rules**, merges its two lookup tables, then removes that subset before proceeding. Original full release track counts and annotations remain intact. A reverse recording-to-release index is added to the new staging catalog for efficient copying; no source data rows change.

A regression test compares **every track-index and artist-index field**, including provenance, between the original whole-source build and partitioned build on independent fixtures. It covers colliding normalized artist names across different Discogs IDs, conflicting evidence and version distinctions. This is a scratch-storage bound, not a new classification algorithm or runtime architecture.

Only the disposable, unpublished merged index uses journal OFF during bulk assembly, avoiding a large rollback journal. It is integrity-checked, flushed, restored to normal journal mode, and atomically published after every partition succeeds. Source data, existing indexes and manual overrides never use that setting. Failed intermediate files can be discarded and rebuilt; a published prior index remains intact. The contiguous ranges allow the merged track table to be written in primary-key order. The ordinary storage supervisor signals the entire preprocessing process group on a limit stop and cleans only its own unpublished work files. The attached `watch-build.py` monitor instead pauses the current owned process group with SIGSTOP and preserves all work, reading only explicitly approved limits from `approved-limits.json`; resuming requires an authorized budget and an active replacement monitor.

Preprocessing memory is reported as observed parent and largest sequential worker RSS peaks, plus their conservative sum as a process-tree upper bound. This is not an exact simultaneous RSS measurement. Peak disk sampling remains conservative and includes temporary files through filesystem free-space changes.

The shared offline builder memoizes exact results from its existing pure title/version and name normalizers (at most 50,000 entries per cache). Base and version extraction therefore reuse the same parsed result, including across duplicate pressings. This changes neither normalized values nor scoring, and adds no runtime classifier cache or dependency.
