import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { normalizeName, titleParts } from "../../lib/classification/matching.ts";
import { DEFAULT_POLICY, family, type Policy } from "./policy.ts";
import type { CatalogData, Category, Evidence, Family, Query, Result, Source } from "./types.ts";

type Row = { id: string; title: string; name: string; version: string; normalized_title: string; normalized_name: string; duration_ms: number | null; source_id: string };
type TagRow = { name: string; source_id: string; entity_type: "recording" | "release" };
type ProfileRow = { family: Family; recordings: number; tagged_recordings: number; total_recordings: number; source_ids: string };

export class LocalCatalog {
  readonly db: DatabaseSync;
  constructor(path = ":memory:", readonly policy: Policy = DEFAULT_POLICY) {
    if (!(policy.definitelyHouse > 50 && policy.definitelyHouse <= 100 && policy.notHouse >= 0 && policy.notHouse < 50 && policy.minArtistSupport > 0 && policy.minLabelSupport > 0 && policy.minProfileCoverage >= 0 && policy.minProfileCoverage <= 1)) throw new Error("Invalid local policy");
    this.db = new DatabaseSync(path);
    this.db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  }
  close() { this.db.close(); }
  import(data: CatalogData) {
    this.db.exec("BEGIN");
    try {
      const source = this.db.prepare("INSERT OR REPLACE INTO sources VALUES(?,?,?,?,?,?)");
      for (const item of data.sources) source.run(item.id, item.name, item.url, item.license, item.version, item.obtainedAt);
      for (const table of ["artists", "labels"] as const) {
        const insert = this.db.prepare(`INSERT OR REPLACE INTO ${table} VALUES(?,?,?,?)`);
        for (const item of data[table]) insert.run(item.id, item.name, normalizeName(item.name), item.sourceId);
      }
      const record = this.db.prepare("INSERT OR REPLACE INTO recordings VALUES(?,?,?,?,?,?,?)");
      const credit = this.db.prepare("INSERT OR IGNORE INTO recording_artists VALUES(?,?,?)");
      const identifier = this.db.prepare("INSERT OR IGNORE INTO recording_identifiers VALUES(?,?,?,?)");
      for (const item of data.recordings) {
        if (!item.artistIds.length) throw new Error("Recording requires a primary artist");
        const parts = titleParts(item.title);
        record.run(item.id, item.title, parts.base, parts.version, item.artistIds[0], item.durationMs ?? null, item.sourceId);
        item.artistIds.forEach((artist, index) => credit.run(item.id, artist, index === 0 ? "primary" : "featured"));
        for (const remixer of item.remixerIds || []) credit.run(item.id, remixer, "remixer");
        for (const isrc of item.isrcs) identifier.run(item.id, "isrc", isrc.toUpperCase().replace(/[^A-Z0-9]/g, ""), item.sourceId);
      }
      const release = this.db.prepare("INSERT OR REPLACE INTO releases VALUES(?,?,?,?,?)");
      const releaseTrack = this.db.prepare("INSERT OR IGNORE INTO release_tracks VALUES(?,?,?)");
      const releaseLabel = this.db.prepare("INSERT OR IGNORE INTO release_labels VALUES(?,?)");
      for (const item of data.releases) {
        release.run(item.id, item.title, item.date || null, item.compilation ? 1 : 0, item.sourceId);
        item.recordingIds.forEach((recording, index) => releaseTrack.run(item.id, index, recording));
        item.labels.forEach(label => releaseLabel.run(item.id, label));
      }
      const genre = this.db.prepare("INSERT OR IGNORE INTO genres(name) VALUES(?)");
      const annotation = this.db.prepare("INSERT OR IGNORE INTO annotations VALUES(?,?,(SELECT id FROM genres WHERE name=?),?)");
      for (const item of data.annotations) { genre.run(item.genre); annotation.run(item.entity, item.entityId, item.genre, item.sourceId); }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.precomputeProfiles();
  }

  private precomputeProfiles() {
    const tagged = new Map<string, { families: Set<Family>; sources: Set<string> }>();
    const rows = this.db.prepare(`SELECT a.entity_id AS recording_id,g.name,a.source_id FROM annotations a JOIN genres g ON g.id=a.genre_id WHERE a.entity_type='recording'
      UNION ALL SELECT rt.recording_id,g.name,a.source_id FROM annotations a JOIN genres g ON g.id=a.genre_id JOIN releases r ON a.entity_id=r.id AND r.compilation=0 JOIN release_tracks rt ON rt.release_id=r.id WHERE a.entity_type='release'`).all() as { recording_id: string; name: string; source_id: string }[];
    for (const row of rows) {
      const classification = family(row.name, this.policy);
      if (classification === "unknown") continue;
      const value = tagged.get(row.recording_id) || { families: new Set<Family>(), sources: new Set<string>() };
      value.families.add(classification); value.sources.add(row.source_id); tagged.set(row.recording_id, value);
    }
    this.db.exec("DELETE FROM genre_distributions");
    const insert = this.db.prepare("INSERT INTO genre_distributions VALUES(?,?,?,?,?,?,?,?)");
    for (const kind of ["artist", "label"] as const) {
      const memberships = kind === "artist" ? this.db.prepare("SELECT artist_id AS entity_id, recording_id FROM recording_artists").all() : this.db.prepare("SELECT rl.label_id AS entity_id,rt.recording_id FROM release_labels rl JOIN releases r ON r.id=rl.release_id AND r.compilation=0 JOIN release_tracks rt ON rt.release_id=r.id").all();
      const members = new Map<string, Set<string>>();
      for (const row of memberships as { entity_id: string; recording_id: string }[]) { const ids = members.get(row.entity_id) || new Set(); ids.add(row.recording_id); members.set(row.entity_id, ids); }
      for (const [id, recordings] of members) {
        const known = [...recordings].map(recording => tagged.get(recording)).filter(value => !!value);
        const sources = [...new Set(known.flatMap(item => [...item.sources]))];
        for (const value of ["house", "adjacent", "other"] as const) insert.run(kind, id, value, known.filter(item => item.families.has(value)).length, known.length, recordings.size, JSON.stringify(this.policy), JSON.stringify(sources));
      }
    }
  }

  classify(query: Query): Result {
    const parts = titleParts(query.title);
    const name = normalizeName(query.artist);
    const select = "SELECT r.*,a.name,a.normalized_name FROM recordings r JOIN artists a ON a.id=r.primary_artist_id";
    let method = "normalized-title-artist-version";
    let candidates: Row[] = [];
    if (query.recordingId) { candidates = this.db.prepare(`${select} WHERE r.id=?`).all(query.recordingId) as Row[]; method = "recording-id"; }
    else if (query.isrc) { candidates = this.db.prepare(`${select} JOIN recording_identifiers i ON i.recording_id=r.id WHERE i.namespace='isrc' AND i.value=?`).all(query.isrc.toUpperCase().replace(/[^A-Z0-9]/g, "")) as Row[]; method = "isrc"; }
    if (!candidates.length && !query.recordingId && !query.isrc) candidates = this.db.prepare(`${select} WHERE r.normalized_title=? AND a.normalized_name=?`).all(parts.base, name) as Row[];
    candidates = candidates.filter(candidate => candidate.normalized_title === parts.base && candidate.normalized_name === name && candidate.version === parts.version && (query.durationMs === undefined || candidate.duration_ms === null || Math.abs(query.durationMs - candidate.duration_ms) <= 12000));
    const matched = candidates.length === 1 ? candidates[0] : null;
    const explanation = [matched ? `Matched by ${method}; title, primary artist, version and any supplied duration agree.` : candidates.length > 1 ? "Multiple versions/recordings remain plausible; recording evidence withheld." : "No corroborated local recording match. This is not evidence against house."];
    const evidence: Evidence[] = [];
    const sources = new Set<string>();
    const matchConfidence = matched ? method === "recording-id" ? 100 : method === "isrc" ? 99 : 95 : 0;
    if (matched) {
      sources.add(matched.source_id);
      const tags = this.db.prepare(`SELECT a.entity_type,g.name,a.source_id FROM annotations a JOIN genres g ON g.id=a.genre_id WHERE a.entity_type='recording' AND a.entity_id=?
        UNION ALL SELECT a.entity_type,g.name,a.source_id FROM annotations a JOIN genres g ON g.id=a.genre_id JOIN releases r ON r.id=a.entity_id AND r.compilation=0 JOIN release_tracks rt ON rt.release_id=r.id WHERE a.entity_type='release' AND rt.recording_id=?`).all(matched.id, matched.id) as TagRow[];
      for (const tag of tags) {
        const group = family(tag.name, this.policy); if (group === "unknown") continue;
        sources.add(tag.source_id);
        evidence.push({ level: tag.entity_type, family: group, tag: tag.name, strength: (tag.entity_type === "recording" ? .9 : .55) * matchConfidence / 100, source: tag.source_id, provenance: [tag.source_id] });
      }
    }
    const profile = (kind: "artist" | "label", id: string, level: "artist" | "remixer" | "label") => {
      const rows = this.db.prepare("SELECT * FROM genre_distributions WHERE entity_type=? AND entity_id=? AND policy_version=?").all(kind, id, JSON.stringify(this.policy)) as ProfileRow[];
      for (const row of rows) {
        const coverage = row.total_recordings ? row.tagged_recordings / row.total_recordings : 0;
        const minimum = kind === "artist" ? this.policy.minArtistSupport : this.policy.minLabelSupport;
        if (row.recordings < minimum || coverage < this.policy.minProfileCoverage || !row.tagged_recordings) continue;
        const provenance: string[] = JSON.parse(row.source_ids); provenance.forEach(source => sources.add(source));
        evidence.push({ level, family: row.family, tag: `${row.family}: ${row.recordings}/${row.tagged_recordings} tagged catalog recordings`, strength: (level === "artist" ? .25 : level === "remixer" ? .2 : .15) * row.recordings / row.tagged_recordings * coverage, source: "derived local catalog distribution", provenance, support: row.recordings, coverage });
      }
    };
    const artistIds = this.db.prepare("SELECT id FROM artists WHERE normalized_name=?").all(name) as { id: string }[];
    if (artistIds.length === 1) profile("artist", artistIds[0].id, "artist");
    if (query.remixer) {
      const ids = this.db.prepare("SELECT id FROM artists WHERE normalized_name=?").all(normalizeName(query.remixer)) as { id: string }[];
      if (ids.length === 1) profile("artist", ids[0].id, "remixer");
    }
    if (matched) for (const row of this.db.prepare("SELECT DISTINCT label_id AS id FROM release_labels rl JOIN release_tracks rt ON rl.release_id=rt.release_id JOIN releases r ON r.id=rt.release_id AND r.compilation=0 WHERE rt.recording_id=?").all(matched.id) as { id: string }[]) profile("label", row.id, "label");
    else if (query.label) {
      const ids = this.db.prepare("SELECT id FROM labels WHERE normalized_name=?").all(normalizeName(query.label)) as { id: string }[];
      if (ids.length === 1) profile("label", ids[0].id, "label");
    }
    // Correlated release/artist/label signals never accumulate into certainty.
    const positive = Math.max(0, ...evidence.filter(item => item.family === "house").map(item => item.strength));
    const negative = Math.max(0, ...evidence.filter(item => item.family === "other").map(item => item.strength));
    const adjacent = Math.max(0, ...evidence.filter(item => item.family === "adjacent").map(item => item.strength));
    const houseScore = Math.round(Math.max(0, Math.min(100, 50 + 50 * positive - 50 * negative)));
    const directHouse = evidence.some(item => item.level === "recording" && item.family === "house" && item.strength >= .7);
    const directOther = evidence.some(item => item.level === "recording" && item.family === "other" && item.strength >= .7);
    const conflict = positive >= .3 && negative >= .3;
    let classification: Category = "UNKNOWN";
    if (!conflict && directHouse && houseScore >= this.policy.definitelyHouse) classification = "DEFINITELY_HOUSE";
    else if (!conflict && directOther && houseScore <= this.policy.notHouse) classification = "NOT_HOUSE";
    else if (positive > 0 || adjacent > 0 || matched && evidence.length > 0) classification = "POSSIBLY_HOUSE";
    if (conflict) explanation.push("Conflicting house/non-house evidence requires human review.");
    if (classification === "UNKNOWN") explanation.push("No sufficient independent evidence. Missing metadata is never an automatic exclusion.");
    if (!directHouse && !directOther && evidence.length) explanation.push("Release styles and artist/remixer/label distributions are context, not proof of this recording's genre.");
    explanation.push("Heuristic scores only; no model, audio, runtime HTTP request or Spotify data is used.");
    const metadataSources = [...sources].map(id => this.db.prepare("SELECT id,name,url,license,version,obtained_at AS obtainedAt FROM sources WHERE id=?").get(id) as Source).filter(Boolean);
    return { classification, confidence: classification === "UNKNOWN" ? 0 : Math.round(100 * Math.max(positive, negative, adjacent) * (conflict ? .5 : 1)), houseScore, matchConfidence, matchedRecording: matched ? { id: matched.id, title: matched.title, artist: matched.name, method } : null, metadataSources, evidence, explanation };
  }
}
