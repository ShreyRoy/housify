import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { normalizeName, titleParts } from "../../lib/classification/matching.ts";
import { DEFAULT_POLICY, family, type Policy } from "./policy.ts";
import type { CatalogData, Category, Evidence, Family, Query, Result, Source } from "./types.ts";

type Row = { id: string; title: string; name: string; version: string; normalized_title: string; normalized_name: string; duration_ms: number | null; source_id: string };
type TagRow = { name: string; source_id: string; entity_type: "recording" | "release" };
type ProfileRow = { family: Family; recordings: number; tagged_recordings: number; total_recordings: number; source_ids: string };
type ReleaseContext = { release_id: string; release_type: string; track_count: number; style_count: number; source_url: string };

export class LocalCatalog {
  readonly db: DatabaseSync;
  constructor(path = ":memory:", readonly policy: Policy = DEFAULT_POLICY, readOnly = false) {
    if (!(policy.definitelyHouse > 50 && policy.definitelyHouse <= 100 && policy.notHouse >= 0 && policy.notHouse < 50 && policy.minArtistSupport > 0 && policy.minLabelSupport > 0 && policy.minProfileCoverage >= 0 && policy.minProfileCoverage <= 1)) throw new Error("Invalid local policy");
    const bounded = [...Object.values(policy.weights), policy.strongEvidence, policy.conflictStrength, policy.context.singleWeight, policy.context.epWeight, policy.context.albumWeight, policy.context.ambiguousWeight, policy.context.minSupportingProfile];
    if (bounded.some(value=>!Number.isFinite(value)||value<0||value>1)||!Number.isFinite(policy.context.minIdentity)||policy.context.minIdentity<0||policy.context.minIdentity>100||[policy.context.maxSingleTracks,policy.context.maxEpTracks,policy.context.maxStyles].some(value=>!Number.isInteger(value)||value<1)) throw new Error("Invalid contextual evidence policy");
    this.db = new DatabaseSync(path, { readOnly });
    if (!readOnly) {
      this.db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
      this.db.exec(readFileSync(new URL("./discogs/schema.sql", import.meta.url), "utf8"));
    }
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
    this.rebuildProfiles();
  }

  rebuildProfiles() {
    // SQL aggregation bounds JS memory even for large offline imports.
    this.db.exec("BEGIN");
    try {
      this.db.exec(`DROP TABLE IF EXISTS temp.profile_families;
        CREATE TEMP TABLE profile_families(genre_id INTEGER PRIMARY KEY,family TEXT NOT NULL);
        DROP TABLE IF EXISTS temp.profile_known;
        CREATE TEMP TABLE profile_known(recording_id TEXT,family TEXT,source_id TEXT,PRIMARY KEY(recording_id,family,source_id));
        DROP TABLE IF EXISTS temp.profile_members;
        CREATE TEMP TABLE profile_members(entity_type TEXT,entity_id TEXT,recording_id TEXT,PRIMARY KEY(entity_type,entity_id,recording_id));
        DROP TABLE IF EXISTS temp.profile_keys;
        CREATE TEMP TABLE profile_keys AS SELECT id,normalized_title||'|'||version||'|'||primary_artist_id||'|'||COALESCE(duration_ms,'unknown') AS work_key FROM recordings;
        CREATE UNIQUE INDEX profile_key_idx ON profile_keys(id);`);
      const insertFamily = this.db.prepare("INSERT INTO profile_families VALUES(?,?)");
      for (const row of this.db.prepare("SELECT id,name FROM genres").iterate() as Iterable<{id: number; name: string}>) {
        const value = family(row.name, this.policy);
        if (value !== "unknown") insertFamily.run(row.id, value);
      }
      this.db.exec(`INSERT OR IGNORE INTO profile_known
        SELECT p.work_key,f.family,a.source_id FROM annotations a JOIN profile_families f ON f.genre_id=a.genre_id JOIN profile_keys p ON p.id=a.entity_id WHERE a.entity_type='recording';
        INSERT OR IGNORE INTO profile_known
        SELECT p.work_key,f.family,a.source_id FROM annotations a JOIN profile_families f ON f.genre_id=a.genre_id
        JOIN releases r ON r.id=a.entity_id AND r.compilation=0 JOIN release_tracks rt ON rt.release_id=r.id JOIN profile_keys p ON p.id=rt.recording_id WHERE a.entity_type='release';
        INSERT OR IGNORE INTO profile_members SELECT 'artist',ra.artist_id,p.work_key FROM recording_artists ra JOIN profile_keys p ON p.id=ra.recording_id;
        INSERT OR IGNORE INTO profile_members SELECT 'label',rl.label_id,p.work_key FROM release_labels rl JOIN releases r ON r.id=rl.release_id AND r.compilation=0 JOIN release_tracks rt ON rt.release_id=r.id JOIN profile_keys p ON p.id=rt.recording_id;
        DELETE FROM genre_distributions;`);
      this.db.prepare(`INSERT INTO genre_distributions
        SELECT m.entity_type,m.entity_id,f.family,
          COUNT(DISTINCT CASE WHEN k.family=f.family THEN k.recording_id END),
          COUNT(DISTINCT k.recording_id),COUNT(DISTINCT m.recording_id),?,
          COALESCE(json_group_array(DISTINCT k.source_id) FILTER(WHERE k.source_id IS NOT NULL),'[]')
        FROM profile_members m CROSS JOIN (SELECT 'house' AS family UNION ALL SELECT 'adjacent' UNION ALL SELECT 'other') f
        LEFT JOIN profile_known k ON k.recording_id=m.recording_id
        GROUP BY m.entity_type,m.entity_id,f.family`).run(JSON.stringify(this.policy));
      this.db.exec("DROP TABLE profile_members; DROP TABLE profile_known; DROP TABLE profile_families; DROP TABLE profile_keys; COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
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
    const explanation = [matched ? `Matched by ${method}; title, primary artist and version agree; available durations are corroborated.` : candidates.length > 1 ? "Multiple versions/recordings remain plausible; recording evidence withheld." : "No corroborated local recording match. This is not evidence against house."];
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
        evidence.push({ level: tag.entity_type, family: group, tag: tag.name, strength: this.policy.weights[tag.entity_type] * matchConfidence / 100, source: tag.source_id, provenance: [tag.source_id], definiteEligible: tag.entity_type === "recording" });
      }
    }
    const profile = (kind: "artist" | "label", id: string, level: "artist" | "remixer" | "label") => {
      const rows = this.db.prepare("SELECT * FROM genre_distributions WHERE entity_type=? AND entity_id=? AND policy_version=?").all(kind, id, JSON.stringify(this.policy)) as ProfileRow[];
      for (const row of rows) {
        const coverage = row.total_recordings ? row.tagged_recordings / row.total_recordings : 0;
        const minimum = kind === "artist" ? this.policy.minArtistSupport : this.policy.minLabelSupport;
        if (row.recordings < minimum || coverage < this.policy.minProfileCoverage || !row.tagged_recordings) continue;
        const provenance: string[] = JSON.parse(row.source_ids); provenance.forEach(source => sources.add(source));
        evidence.push({ level, family: row.family, tag: `${row.family}: ${row.recordings}/${row.tagged_recordings} tagged catalog recordings`, strength: this.policy.weights[level] * row.recordings / row.tagged_recordings * coverage, source: "derived local catalog distribution", provenance, support: row.recordings, coverage });
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
    if (matched && this.policy.context.enabled) {
      const contexts = this.db.prepare(`SELECT DISTINCT c.* FROM release_context c JOIN release_tracks rt ON rt.release_id=c.release_id JOIN releases r ON r.id=c.release_id WHERE rt.recording_id=? AND r.compilation=0`).all(matched.id) as ReleaseContext[];
      // Replace legacy release evidence only for contextualized Discogs sources.
      const contextSources = new Set((this.db.prepare(`SELECT DISTINCT r.source_id FROM releases r JOIN release_context c ON c.release_id=r.id JOIN release_tracks rt ON rt.release_id=r.id WHERE rt.recording_id=?`).all(matched.id) as {source_id:string}[]).map(row => row.source_id));
      for (let i = evidence.length - 1; i >= 0; i--) if (evidence[i].level === "release" && contextSources.has(evidence[i].source)) evidence.splice(i, 1);
      for (const context of contexts) {
        const tags = this.db.prepare(`SELECT g.name,a.source_id FROM annotations a JOIN genres g ON g.id=a.genre_id WHERE a.entity_type='release' AND a.entity_id=?`).all(context.release_id) as TagRow[];
        const known = tags.filter(tag => family(tag.name, this.policy) !== "unknown");
        const families = new Set(known.map(tag => family(tag.name, this.policy)));
        const styleRows = this.db.prepare("SELECT tag FROM release_tag_kinds WHERE release_id=? AND kind='style'").all(context.release_id) as {tag:string}[];
        const unknownStyles = styleRows.some(row => family(row.tag,this.policy)==="unknown");
        const uniform = families.size === 1 && !unknownStyles && context.style_count > 0 && context.style_count <= this.policy.context.maxStyles;
        const single = uniform && context.track_count > 0 && context.track_count <= this.policy.context.maxSingleTracks && context.release_type !== "album";
        const supported = known.some(tag => evidence.some(item => ["artist", "remixer"].includes(item.level) && item.family === family(tag.name, this.policy) && item.strength >= this.policy.context.minSupportingProfile));
        const shortEp = uniform && context.release_type === "ep" && context.track_count <= this.policy.context.maxEpTracks && supported;
        let weight = context.release_type === "album" ? this.policy.context.albumWeight : this.policy.weights.release;
        if (!uniform) weight = Math.min(weight, this.policy.context.ambiguousWeight);
        else if (single) weight = this.policy.context.singleWeight;
        else if (shortEp) weight = this.policy.context.epWeight;
        const eligible = (single || shortEp) && matchConfidence >= this.policy.context.minIdentity;
        for (const tag of known) {
          sources.add(tag.source_id);
          evidence.push({ level: "release", family: family(tag.name, this.policy), tag: tag.name, strength: weight * matchConfidence / 100, source: tag.source_id, provenance: [tag.source_id], definiteEligible: eligible, sourceUrl: context.source_url, context: `${context.release_type}; ${context.track_count} tracks; ${context.style_count} styles; ${uniform ? "one known genre family" : "mixed or insufficient style specificity"}; ${eligible ? "eligible contextual evidence" : "review context only"}` });
        }
      }
      if (contextSources.size) explanation.push("Discogs identity is a release-derived candidate, not a verified recording ID. Release scope and pressing provenance are retained.");
    }
    // Correlated release/artist/label signals never accumulate into certainty.
    const positive = Math.max(0, ...evidence.filter(item => item.family === "house").map(item => item.strength));
    const negative = Math.max(0, ...evidence.filter(item => item.family === "other").map(item => item.strength));
    const adjacent = Math.max(0, ...evidence.filter(item => item.family === "adjacent").map(item => item.strength));
    const houseScore = Math.round(Math.max(0, Math.min(100, 50 + 50 * positive - 50 * negative)));
    const directHouse = evidence.some(item => item.definiteEligible && item.family === "house" && item.strength >= this.policy.strongEvidence);
    const directOther = evidence.some(item => item.definiteEligible && item.family === "other" && item.strength >= this.policy.strongEvidence);
    const conflict = positive >= this.policy.conflictStrength && (negative >= this.policy.conflictStrength || adjacent >= this.policy.conflictStrength);
    let classification: Category = "UNKNOWN";
    if (!conflict && directHouse && houseScore >= this.policy.definitelyHouse) classification = "DEFINITELY_HOUSE";
    else if (!conflict && directOther && houseScore <= this.policy.notHouse) classification = "NOT_HOUSE";
    else if (positive > 0 || adjacent > 0 || matched && evidence.length > 0) classification = "POSSIBLY_HOUSE";
    if (conflict) explanation.push("Conflicting house/non-house evidence requires human review.");
    if (classification === "UNKNOWN") explanation.push("No sufficient independent evidence. Missing metadata is never an automatic exclusion.");
    if (!directHouse && !directOther && evidence.length) explanation.push("Available release/artist/remixer/label context is insufficient for a definite recording classification.");
    explanation.push("Heuristic scores only; no model, audio, runtime HTTP request or Spotify data is used.");
    const metadataSources = [...sources].map(id => this.db.prepare("SELECT id,name,url,license,version,obtained_at AS obtainedAt FROM sources WHERE id=?").get(id) as Source).filter(Boolean);
    return { classification, confidence: classification === "UNKNOWN" ? 0 : Math.round(100 * Math.max(positive, negative, adjacent) * (conflict ? .5 : 1)), houseScore, matchConfidence, matchedRecording: matched ? { id: matched.id, title: matched.title, artist: matched.name, method } : null, metadataSources, evidence, explanation };
  }
}
