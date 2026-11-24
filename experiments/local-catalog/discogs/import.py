"""Offline, bounded-memory Discogs releases importer; Python standard library only.

Official dumps contain escaped text and <release> records. Framing skips unrelated
records before XML parsing; XMLPullParser parses retained records incrementally.
DTD, CDATA and comments are rejected, rather than ambiguously framing their text.
No network access. A checkpoint is committed atomically with each SQLite batch.
"""
import argparse
import gzip
from datetime import datetime, timezone
import hashlib
import html
import json
import os
from pathlib import Path
import re
import resource
import signal
import sqlite3
import time
import unicodedata
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
SCHEMA = HERE.parent / "schema.sql"
STOP = False
VERSION = "discogs-import-v2"


def normalize(value):
    value = "".join(c for c in unicodedata.normalize("NFKD", value) if not unicodedata.category(c).startswith("M"))
    value = value.lower().replace("&", " and ")
    return " ".join("".join(c if c.isalnum() or c.isspace() else " " for c in value).split())


def clean_artist(value):
    return re.sub(r"\s+\(\d+\)$", "", value).strip()


def parts(value):
    match = re.search(r"(?:[-–—]\s*|[([])([^()[\]]*\b(?:remix|mix|edit|dub|live|instrumental|version)\b[^()[\]]*)[)\]]?\s*$", value, re.I)
    base = value[:match.start()].strip() if match else value
    base = re.split(r"\s(?:feat\.?|ft\.?)\s|\s[([](?:feat\.?|ft\.?)\s", base, flags=re.I)[0]
    return normalize(base), normalize(match[1] if match else "")


def duration(value):
    if not re.fullmatch(r"\d{1,3}:\d{2}(?::\d{2})?", value):
        return None
    result = 0
    for number in value.split(":"):
        result = result * 60 + int(number)
    return result * 1000


def fragments(path):
    """Keep at most one release plus 1 MiB in memory; validate the envelope."""
    opener = gzip.open if str(path).endswith((".gz", ".part")) else open
    with opener(path, "rb") as handle:
        buffer = b""
        opened = False
        while True:
            chunk = handle.read(1024 * 1024)
            buffer += chunk
            if not opened:
                match = re.match(rb'\s*(?:<\?xml[^>]*>\s*)?<releases\s*>', buffer)
                if not match:
                    raise ValueError("Expected official <releases> XML envelope")
                buffer = buffer[match.end():]
                opened = True
            offset = 0
            while True:
                end = buffer.find(b"</release>", offset)
                if end < 0:
                    break
                record = buffer[offset:end + 10].strip()
                offset = end + 10
                if len(record) > 16 * 1024 * 1024:
                    raise ValueError("Release exceeded 16 MiB safety bound")
                if not re.match(rb"<release\s", record) or any(token in record for token in [b"<!DOCTYPE", b"<!ENTITY", b"<![CDATA[", b"<!--"]):
                    raise ValueError("Unsupported XML framing; no checkpoint advanced")
                yield record
            # Compact once per input chunk, not once per release. Repeatedly
            # slicing the 1 MiB suffix needlessly copied terabytes on full dumps.
            buffer = buffer[offset:]
            if len(buffer) > 16 * 1024 * 1024:
                raise ValueError("Unterminated release exceeded 16 MiB safety bound")
            if not chunk:
                if buffer.strip() != b"</releases>":
                    raise ValueError("Incomplete releases XML (gzip CRC is also checked)")
                return


def parse_release(fragment):
    parser = ET.XMLPullParser(events=("end",))
    for start in range(0, len(fragment), 65536):
        parser.feed(fragment[start:start + 65536])
    root = None
    for _, element in parser.read_events():
        if element.tag == "release":
            root = element
    parser.close()
    if root is None:
        raise ValueError("Missing release")
    return root


def texts(root, path):
    return [element.text.strip() for element in root.findall(path) if element.text and element.text.strip()]


def credits(root, path):
    result = []
    for artist in root.findall(path):
        source_id, name = artist.findtext("id", ""), artist.findtext("name", "")
        if source_id and name and source_id not in {"194", "118760"}:  # Various / Unknown
            result.append(("discogs:artist:" + source_id, clean_artist(name), artist.findtext("role", ""), artist.findtext("tracks", ""), name))
    return result


def initialize(db):
    db.executescript(SCHEMA.read_text())
    db.executescript((HERE / "schema.sql").read_text())
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.execute("PRAGMA cache_size=-32768")
    db.execute("PRAGMA temp_store=FILE")


def retain_release(db, root, source, selected=None):
    rid = "discogs:release:" + root.attrib["id"]
    if db.execute("SELECT 1 FROM releases WHERE id=?", (rid,)).fetchone():
        return 0
    formats = texts(root, "formats/format/descriptions/description")
    compilation = any(item.lower() in {"compilation", "mixed", "dj mix"} for item in formats)
    release_type = "single" if any(item.lower() in {"single", "maxi-single"} for item in formats) else "ep" if "EP" in formats else "album" if "Album" in formats else "unknown"
    release_artists = credits(root, "artists/artist")
    global_remixers = [c for c in credits(root, "extraartists/artist") if re.search(r"\bremix", c[2], re.I)]
    tracks = []
    for track in root.findall("tracklist/track"):
        if track.attrib.get("type") == "heading":
            continue
        children = track.findall("sub_tracks/track")
        if children:
            tracks.extend(children)
        else:
            tracks.append(track)
    tracks = [track for track in tracks if track.findtext("title", "").strip() and track.findtext("position", "").strip()]
    genres, styles = texts(root, "genres/genre"), texts(root, "styles/style")
    master = root.findtext("master_id", "")
    db.execute("INSERT INTO releases VALUES(?,?,?,?,?)", (rid, root.findtext("title", ""), root.findtext("released"), int(compilation), source))
    db.execute("INSERT INTO release_context VALUES(?,?,?,?,?,?,?,?,?)", (rid, release_type, len(tracks), len(genres), len(styles), master, json.dumps(formats), "https://www.discogs.com/release/" + root.attrib["id"], VERSION))
    for label in root.findall("labels/label"):
        if not label.get("id") or not label.get("name"):
            continue
        lid = "discogs:label:" + label.get("id")
        name = clean_artist(label.get("name"))
        db.execute("INSERT OR IGNORE INTO labels VALUES(?,?,?,?)", (lid, name, normalize(name), source))
        db.execute("INSERT OR IGNORE INTO release_labels VALUES(?,?)", (rid, lid))
        db.execute("INSERT OR IGNORE INTO catalog_numbers VALUES(?,?,?)", (rid, lid, label.get("catno", "")))
    for kind, tags in [("genre", genres), ("style", styles)]:
        for tag in tags:
            db.execute("INSERT OR IGNORE INTO genres(name) VALUES(?)", (tag,))
            db.execute("INSERT OR IGNORE INTO annotations VALUES('release',?,(SELECT id FROM genres WHERE name=?),?)", (rid, tag, source))
            db.execute("INSERT OR IGNORE INTO release_tag_kinds VALUES(?,?,?)", (rid, tag, kind))
    for position, track in enumerate(tracks):
        title = track.findtext("title", "").strip()
        artists = credits(track, "artists/artist") or release_artists
        if not artists:
            continue  # Do not attribute compilation tracks to Various Artists.
        remixers = [c for c in credits(track, "extraartists/artist") if re.search(r"\bremix", c[2], re.I)]
        # A release credit applying to only some tracks must not leak to all tracks.
        remixers += [c for c in global_remixers if not c[3] or track.findtext("position", "") in [p.strip() for p in c[3].split(",")]]
        if selected and not any(normalize(c[1]) in selected for c in artists + remixers):
            continue
        for aid, name, _, _, raw in artists + remixers:
            db.execute("INSERT OR IGNORE INTO artists VALUES(?,?,?,?)", (aid, name, normalize(name), source))
            db.execute("INSERT OR IGNORE INTO artist_aliases VALUES(?,?,?)", (aid, raw, normalize(clean_artist(raw))))
        base, version = parts(title)
        milliseconds = duration(track.findtext("duration", ""))
        # Candidate grouping is NOT a claim of verified recording identity. Known
        # master plus exact credit/title/duration can group duplicate pressings.
        # Without a master or duration, stay release-local to avoid false merges.
        identity = [artists, base, version, milliseconds, sorted(c[0] for c in remixers), master if master and milliseconds is not None else rid, position if not master or milliseconds is None else None]
        signature = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        recording = "discogs:candidate:" + signature
        db.execute("INSERT OR IGNORE INTO recordings VALUES(?,?,?,?,?,?,?)", (recording, title, base, version, artists[0][0], milliseconds, source))
        db.execute("INSERT OR IGNORE INTO recording_context VALUES(?,?,?,?)", (recording, "release-derived-candidate", signature, 0))
        for index, credit in enumerate(artists):
            db.execute("INSERT OR IGNORE INTO recording_artists VALUES(?,?,?)", (recording, credit[0], "primary" if index == 0 else "featured"))
        for credit in remixers:
            db.execute("INSERT OR IGNORE INTO recording_artists VALUES(?,?,?)", (recording, credit[0], "remixer"))
        db.execute("INSERT OR IGNORE INTO release_tracks VALUES(?,?,?)", (rid, position, recording))
        db.execute("INSERT OR IGNORE INTO release_track_details VALUES(?,?,?,?,?)", (rid, position, track.findtext("position", ""), title, json.dumps(artists + remixers)))
    return 1


def run(args):
    global STOP
    STOP = False
    path, target = Path(args.archive).resolve(), Path(args.database).resolve()
    if not path.exists():
        raise ValueError("Archive does not exist")
    target.parent.mkdir(parents=True, exist_ok=True)
    file_stat = path.stat()
    # Fast restart fingerprint includes file metadata and first/last 64 KiB.
    with path.open("rb") as handle:
        edge = handle.read(65536)
        handle.seek(max(0, file_stat.st_size - 65536))
        edge += handle.read(65536)
    fingerprint = hashlib.sha256(edge + str((file_stat.st_size, file_stat.st_mtime_ns)).encode()).hexdigest()
    artists = json.loads(Path(args.artists).read_text()) if args.artists else []
    selected = {normalize(clean_artist(name)) for name in artists}
    needles = [re.escape(html.escape(clean_artist(name), quote=False).encode()) for name in artists]
    artist_pattern = re.compile(rb"<name>(?:" + b"|".join(needles) + rb")(?: \(\d+\))?</name>", re.I) if needles else None
    if args.scope == "artists" and not selected:
        raise ValueError("Artist scope requires a nonempty JSON array via --artists")
    options = json.dumps({"scope": args.scope, "artists": sorted(selected), "version": VERSION}, sort_keys=True)
    db = sqlite3.connect(target)
    initialize(db)
    state = db.execute("SELECT * FROM import_state WHERE id=1").fetchone()
    if state and (state[1] != fingerprint or state[2] != options):
        raise ValueError("Archive/options changed. Use a new database; refusing to mix snapshots.")
    checkpoint = state[3] if state else 0
    retained = state[4] if state else 0
    previous_seconds = state[6] if state else 0
    source = "discogs:dump:" + args.snapshot
    if state and not db.execute("SELECT 1 FROM sources WHERE id=? AND version=? AND url=?", (source, args.snapshot, args.source_url)).fetchone():
        raise ValueError("Source snapshot/URL changed. Use a new database.")
    if state and state[5] == "complete":
        print(json.dumps({"status": "already-complete", "processedReleases": checkpoint, "retainedReleases": retained}), flush=True)
        db.close()
        return
    db.execute("INSERT OR IGNORE INTO sources VALUES(?,?,?,?,?,?)", (source, "Discogs community releases bulk dump", args.source_url, "CC0-1.0", args.snapshot, datetime.now(timezone.utc).isoformat()))
    db.execute("INSERT OR IGNORE INTO catalog_scope VALUES(1,?,?)", (args.scope, "Partial imported catalog; profiles do not represent complete discographies"))
    db.commit()
    started = time.monotonic()
    processed, pending, reason = 0, 0, "complete"

    def stats(status):
        db_bytes = sum(p.stat().st_size for p in [target, Path(str(target) + "-wal")] if p.exists())
        return {"status": status, "processedReleases": processed, "retainedReleases": retained, "retainedCandidates": db.execute("SELECT COUNT(*) FROM recordings").fetchone()[0], "elapsedSeconds": round(time.monotonic() - started + previous_seconds, 3), "databaseBytesIncludingWal": db_bytes, "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if os.uname().sysname == "Darwin" else 1024), "archiveBytes": file_stat.st_size, "scope": args.scope, "importVersion": VERSION}

    def commit(status):
        elapsed = time.monotonic() - started + previous_seconds
        db.execute("INSERT OR REPLACE INTO import_state VALUES(1,?,?,?,?,?,?)", (fingerprint, options, processed, retained, status, elapsed))
        db.commit()
        report = stats(status)
        print(json.dumps(report), flush=True)
        Path(str(target) + ".import.json").write_text(json.dumps(report, indent=2))
        if report["databaseBytesIncludingWal"] > args.max_database_gib * 1024 ** 3:
            raise RuntimeError("Database storage cap reached; safely checkpointed. Raise cap explicitly to resume.")
        if os.statvfs(target.parent).f_bavail * os.statvfs(target.parent).f_frsize < 5 * 1024 ** 3:
            raise RuntimeError("Less than 5 GiB free; import stopped at safe checkpoint")

    try:
        db.execute("BEGIN")
        for fragment in fragments(path):
            processed += 1
            if processed <= checkpoint:
                if STOP:
                    processed = checkpoint  # Never move a saved checkpoint backwards.
                    reason = "interrupted-during-prefix"
                    break
                if processed % args.batch == 0:
                    print(json.dumps({**stats("replaying-prefix"), "savedCheckpoint": checkpoint}), flush=True)
                continue
            if STOP or (args.max_processed and processed > args.max_processed) or retained >= args.max_retained:
                processed -= 1
                reason = "interrupted" if STOP else "capped"
                break
            keep = args.scope == "all" or (args.scope == "electronic" and b"<genre>Electronic</genre>" in fragment)
            if args.scope == "artists":
                keep = bool(artist_pattern.search(fragment))
            if keep:
                root = parse_release(fragment)
                relevant = credits(root, "artists/artist") + credits(root, "tracklist/track/artists/artist")
                relevant += [c for c in credits(root, "extraartists/artist") + credits(root, "tracklist/track/extraartists/artist") if re.search(r"\bremix", c[2], re.I)]
                if args.scope != "artists" or any(normalize(c[1]) in selected for c in relevant):
                    retained += retain_release(db, root, source, selected if args.scope == "artists" else None)
            pending += 1
            if pending >= args.batch:
                commit("running")
                db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                db.execute("BEGIN")
                pending = 0
        commit(reason)
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except BaseException:
        db.rollback()  # Last partial batch discarded; prior checkpoint remains valid.
        raise
    finally:
        db.close()


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("database")
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--source-url", default="https://data.discogs.com/")
    parser.add_argument("--scope", choices=["artists", "electronic", "all"], default="electronic")
    parser.add_argument("--artists")
    parser.add_argument("--batch", type=int, default=10000, help="Processed releases per atomic checkpoint")
    parser.add_argument("--max-retained", type=int, default=50000)
    parser.add_argument("--max-processed", type=int, default=0, help="0 scans to EOF, while retaining at most --max-retained releases")
    parser.add_argument("--max-database-gib", type=float, default=8)
    args = parser.parse_args(argv)
    if args.batch <= 0 or args.max_retained <= 0 or args.max_processed < 0 or args.max_database_gib <= 0:
        parser.error("Limits must be positive (max-processed may be zero)")
    return args


if __name__ == "__main__":
    def stop(*_):
        global STOP
        STOP = True
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    run(arguments())
