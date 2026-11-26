# Expanded catalog results — 26 November 2026

The completed genre-first catalog materially improves recall with the existing classifier. It is suitable as a local review aid, but does not yet justify mostly automatic playlist curation. No production integration was changed.

## Measured scale

| Measurement | Result |
|---|---:|
| Archive records scanned | 19,575,942 per pass, two complete passes |
| Retained releases | 12,731,321 |
| Source recording entries | 46,142,612 |
| Retained normalized title/version groups | 18,353,957 |
| Duration-specific lookup rows | 23,634,551 |
| Canonical artist keys / alias lookup rows | 1,237,902 / 1,237,929 |
| Source / compact SQLite | 10.06 GB / 8.92 GB |
| Import time | 143.2 minutes, including replay |
| Preprocessing excluding recorded pauses | approximately 65.4 minutes |
| Conservative peak artifacts / aggregate SQLite | 34.37 GB / 21.43 GiB |
| Observed importer peak RSS | 224.5 MB |
| Preprocessor parent + largest worker RSS upper bound | 3.55 GB |

Preprocessing raw wall time was 41.79 hours because it includes the approval pause. The pause-adjusted estimate is not CPU time. Parent and worker peaks need not coincide. Disk estimates include visible artifacts, a conservative temporary-space reserve and filesystem free-space changes; unrelated disk activity can overestimate usage. The final index passed row-count and SQLite quick-check verification before atomic publication. Old catalogs and manual overrides were preserved.

## Identical-query comparison

Only independently adjudicated cases enter precision/recall denominators: 20/40 old-set cases, 17/22 fresh-set cases. Remaining labels are unresolved, including versions whose original-track label is insufficient. No overrides or policy tuning were used.

| Metric | Existing 40: old → expanded | Fresh 22: old → expanded |
|---|---|
| Definite precision, adjudicated only | 2/2 → 5/5 | undefined (0 predictions) → 1/1 |
| Definite house recall | 2/14 → 5/14 | 0/12 → 1/12 |
| Definite + possible house recall | 9/14 → 14/14 | 5/12 → 12/12 |
| Labeled house incorrectly excluded | 0 → 0 | 0 → 0 |
| Manual review | 35/40 → 32/40 | 22/22 → 19/22 |
| UNKNOWN | 9/40 → 1/40 | 13/22 → 1/22 |
| POSSIBLY_HOUSE | 26/40 → 31/40 | 9/22 → 18/22 |
| Judged house among review candidates | 12/18 → 9/15 | 12/17 → 11/16 |
| Original-order review NDCG@10 | .756 → .906 | .572 → .779 |
| Mean NDCG@10, 20 input permutations | .668 → .771 | .540 → .653 |
| Mean judged top-five precision, permutations | .60 → .75 | .51 → .63 |

The apparent 100% definite precision rests on only five and one adjudicated predictions. It is not a population accuracy estimate. Two additional fresh definite predictions (extended DJ Koze and Sammy Virji) have unresolved labels and are excluded from that precision claim. UNKNOWN stays reviewable, so retained-house recall is 100% for both catalogs and is not itself an improvement. Most candidates still require review; unrelated controls also frequently enter POSSIBLY_HOUSE.

On the same 2,000 old-catalog queries: old 145 ms, expanded 193 ms. On the same 2,000 expanded-catalog queries: old 38 ms (mostly UNKNOWN), expanded 264 ms. Expanded p95 latency was .337/.434 ms respectively. These local measurements have uncontrolled cache, order and load; catalog-derived workloads do not establish accuracy.

## Five requested recordings

| Recording | Full-archive exact credited releases / retained | Expanded result |
|---|---:|---|
| Drake — Massive | 13 / 13 | POSSIBLY_HOUSE |
| Drake — Falling Back | 12 / 12 | POSSIBLY_HOUSE |
| DJ BORING — Winona | 9 / 9 | POSSIBLY_HOUSE |
| Palms Trax — Equation | 15 / 15 | DEFINITELY_HOUSE |
| Barry Can't Swim — Sunsleeper | 8 / 8 | DEFINITELY_HOUSE |

All five have source evidence, retain it through extraction, and match compact groups. Neither Drake track is lost: mixed album-level house/hip-hop context remains conservatively reviewable. Winona also remains reviewable; Equation and Sunsleeper become definite. Pressings are not independent genre votes. These probe queries use observed archive durations; the direct evaluation retains its original frozen query durations.

## Remaining coverage and classification limits

Niche cases Leon Vynehall and Sofia Kourtesis, emerging-style Swimming Paul, and multi-genre Four Tet now have track matches and enter POSSIBLY_HOUSE. Recent Mau P’s exact extended mix becomes definite; Chris Lake and Sonny Fodera remain reviewable. Skepta, Beyoncé and Madonna house tracks remain reviewable rather than being excluded by artist reputation. This is useful coverage, with small qualitative strata rather than representative sampling.

The fresh unresolved its murph recording remains UNKNOWN: there is no exact normalized artist/base-title candidate in retained source. That is not proof of full-archive absence. The old-set KETTAMA Think Of You and Josh Baker Souvenir queries also lack exact retained-source candidates and use artist fallback. Exact candidates exist for some other fallback queries (Prospa This Rhythm, the DJ Premier remix, Tourist remix), but no compatible retained compact group is reached; their omission/matching boundary needs case-specific investigation before calling it an extraction defect. The five-recording full archive audit found no eligible extraction omissions, but does not prove completeness for every candidate.

Skepta Shutdown matches insufficient usable context and stays UNKNOWN. House/adjacent conflicts, heterogeneous album tags, compilation safeguards, textual version signatures, durations and aliases remain limitations of the fixed rules. Non-house controls often remain POSSIBLY_HOUSE, showing that improved recall does not eliminate review noise. Genre evidence is release context, not verified audio identity.

## Recommendation and reproduction

Use the expanded catalog for independent local music review and retain UNKNOWN/manual correction. It is a meaningful improvement over a roughly 60-artist seed, but insufficient for reliable automatic selection across arbitrary playlists. The next product value is reviewing real candidates with explanations and durable overrides, subject to the separate unresolved Spotify integration policy question. No classifier redesign is proposed by this experiment.

See [README.md](README.md) for commands, [results.json](results.json) for every query and subgroup, [probe-results.json](probe-results.json) for provenance, and [preprocessing-measurements.json](preprocessing-measurements.json) for resource methodology. Fictional fixtures were used only for tests, never these evaluation results.
