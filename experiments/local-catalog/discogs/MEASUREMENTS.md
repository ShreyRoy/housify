# Actual Discogs experiment results

Snapshot: 2026-11-01. Evaluation generated 2026-11-24T19:39:54.559Z. Full machine-readable output: [results.json](results.json). Reproduction and architecture: [README.md](README.md).

## Import and storage

| Measurement | Observed |
|---|---:|
| Compressed archive, official SHA-256 verified | 11,361,019,345 bytes |
| Releases scanned to EOF | 19,575,942 |
| Releases retained | 259,405 |
| Unverified release-derived candidates | 1,375,385 |
| Artists / labels retained from release credits | 10,036 / 24,359 |
| Final SQLite database | 2,710,073,344 bytes (2.71 GB) |
| Archive plus final SQLite file | 14.07 GB |
| Selected import cumulative elapsed time | 1554.4 seconds (includes checkpoint/replay) |
| Maximum importer RSS across checkpoint/restart runs | 122.7 MB |
| TypeScript finalization / profile build | 39.04 seconds |
| Finalization peak RSS | 184.5 MB |
| Normalization rows checked / repaired | 1,375,385 / 0 |

The approved budget was 30 GB peak storage and an 8 GiB SQLite cap. The selected scan completed without hitting either import count or database cap. No uncompressed archive or additional dumps were retained. The initial superseded scope-development trial is excluded from these import timings and its database was removed. Its log remains ignored. The measured selected import includes an intentional interrupted/restarted run, confirming checkpoint replay on real data; restart-safe behavior is also tested independently.

The Beatles alone account for 430,821 candidates; Queen another 151,089. This is strong evidence that importing complete negative-control discographies is unnecessary for a compact house-focused research catalog. Those are candidate counts, including unresolved pressings/live versions, not verified unique studio recordings.

## Coverage

| Group | Compatible candidate exists | Unique candidate survives identity checks | Any classification evidence | Unknown |
|---|---:|---:|---:|---:|
| mainstream | 18/20 (90.0%) | 0/20 (0.0%) | 9/20 (45.0%) | 11/20 (55.0%) |
| underground | 15/20 (75.0%) | 5/20 (25.0%) | 15/20 (75.0%) | 5/20 (25.0%) |
| recent | 15/20 (75.0%) | 5/20 (25.0%) | 6/20 (30.0%) | 14/20 (70.0%) |
| adjacent | 20/20 (100.0%) | 0/20 (0.0%) | 9/20 (45.0%) | 11/20 (55.0%) |
| unrelated | 20/20 (100.0%) | 0/20 (0.0%) | 10/20 (50.0%) | 11/20 (55.0%) |

Overall candidate presence: **88/100 (88.0%)**; unambiguous candidate matches: **10/100 (10.0%)**; artist-name presence: **99/100 (99.0%)**. All **10/10** unambiguous candidates had release genre/style and label metadata. The other tracks were not verified to lack those fields; most had multiple plausible versions/pressings. Candidate presence is not verified exact-recording retrieval recall. Artist-name presence is not verified artist identity.

Decisions across all 100: **6 definitely, 42 possibly, 0 not house, 52 unknown**. No benchmark track was automatically excluded. The separate 2,000-candidate engineering batch did exercise NOT_HOUSE on real data; it is not accuracy gold.

## Genre evaluation and limits

There are **65 track-specific independent reference labels**, including **47 held out**. **35** rows remain outside strict accuracy denominators (31 without a reference label; others provisional/release-level). This fulfills the 100-candidate retrieval experiment, but **does not complete a fully adjudicated 100-recording genre/identity benchmark**. Reliable exact-version reference judgments remain outstanding; uncertain labels were not invented.

| Metric | All independently labeled rows | Held-out independently labeled rows |
|---|---:|---:|
| Definitely-house precision | 4/4 (100.0%) | 2/2 (100.0%) |
| Definitely-house recall, including abstentions | 4/31 (12.9%) | 2/22 (9.1%) |
| Definitely + possibly house recall | 13/31 (41.9%) | 9/22 (40.9%) |
| Definite-house false-positive rate | 0/34 (0.0%) | 0/25 (0.0%) |
| Definite + possible false-positive rate | 15/34 (44.1%) | 10/25 (40.0%) |

The precision point estimates use only four scored definite predictions overall and two held out. They do **not** establish production precision. Two additional definite predictions lack eligible track-specific genre gold. Overall manual-review rate is **94/100 (94.0%)**. Actual exact-recording identity precision and verified retrieval recall remain **unmeasured**, not 100%: no independently audited expected-recording mapping exists for all queries.

Examples that really ran offline: Prospa's Don't Stop (Extended Mix), Josh Baker's My Place and Down To The Bone, and Franky Rizardo's Love Me Right received definite-house results from explicit release styles. KETTAMA's Comes and Goes remained possible with Techno evidence; house-adjacent classification disagreements are visible. Famous songs such as One More Time have hundreds of compatible candidates, so the matcher does not arbitrarily choose one. Source locations and explanations are in the JSON output.

The held-out split was fixed before real-data evaluation and classification rules were not retuned after inspecting it. Artist-targeted scope, album correlations, partially reviewed genre references and incomplete identity gold limit generalization. A MusicBrainz pilot with different queries/durations and candidate retrieval procedures is not a controlled accuracy comparison.

## Runtime measurements

| Latest measured workload | Observed |
|---|---:|
| First connection's first lookup | 69.89 ms |
| Fresh connection + lookup median / p95 | 1.84 / 26.12 ms |
| Warm lookup median / p95 | 0.41 / 7.99 ms |
| 2,000 distinct imported-candidate queries with candidate ID | 1.98 seconds; 1012/s |
| Same 2,000 distinct recordings, title/artist/duration only | 25.27 seconds; 79/s |
| Evaluation process peak RSS | 266.5 MB |

Timing was cache/workload sensitive: an earlier observed run took 0.57 seconds for the ID batch and 4.00 seconds for the title-only batch, versus the latest 1.98 / 25.27 seconds. The later measurement overlapped archive checksum verification initially; OS cache state was not controlled. Both are actual observations, not promised throughput. Fresh-connection latency is **not an OS-cold disk benchmark**. System caches were not purged. Engineering batches are catalog-derived, not independent accuracy labels.

## Recommendation from the measurements

Discogs provides useful release styles and demonstrably classifies some real recent/underground tracks without runtime API calls. It is **not ready to replace the current production classifier**: only 10/100 candidates resolved unambiguously and 94/100 need review under these rules.

1. Keep release-derived identity separate from verified recordings. Add independently verified recording/ISRC links or a reviewed pressing/variant map. A targeted, cached MusicBrainz identity bridge may help; a full mirror is not yet justified and was not downloaded. Its benefit remains unmeasured.
2. Shrink the core to target electronic artists while retaining all their genre variants. Use a bounded set of unrelated controls instead of entire Beatles/Queen discographies. Keep artist/label sampling limits visible; do not switch to a house-only profile corpus.
3. Complete the remaining genre adjudication and build an independent identity audit before relaxing matching. Add a fresh artist/album-independent held-out set before further tuning.
4. Tighten low-proportion profile fallbacks in a future policy version: tiny house proportions in rock/jazz discographies currently generate some noisy possible-house results. Do not use the current held-out results to claim an unbiased improvement after tuning.
5. Recheck policy before any Spotify integration. Production functionality remains unchanged; independent metadata and a working importer do not imply Spotify approval.

Validation: eight Python importer tests, nineteen TypeScript experimental tests, fifty-four existing application tests, TypeScript checking and the production build passed. The real archive's official SHA-256 was verified, every retained candidate passed TypeScript normalization finalization, and the real offline query CLI was exercised. Large artifacts are ignored by Git.
