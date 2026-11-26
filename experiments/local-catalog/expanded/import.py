"""Genre-first two-pass, bounded offline staging for the unchanged compact builder.
Reuses Discogs framing/XML/credit/duration parsing; no network or benchmark input.
Integer IDs and shared raw title/artist/duration rows avoid the old pressing-level
SHA identity overhead. These are compatible candidates, not audio identities.
"""
import argparse, importlib.util, json, os, re, resource, signal, sqlite3, time
from datetime import datetime, timezone
from pathlib import Path
spec=importlib.util.spec_from_file_location('discogs_import',Path(__file__).resolve().parents[1]/'discogs/import.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
STOP=False
SCHEMA='''
PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-32768; PRAGMA temp_store=FILE;
CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,url TEXT,license TEXT,version TEXT);
CREATE TABLE IF NOT EXISTS catalog_scope(id INTEGER PRIMARY KEY,scope TEXT,limitation TEXT);
CREATE TABLE IF NOT EXISTS import_state(id INTEGER PRIMARY KEY,status TEXT);
CREATE TABLE IF NOT EXISTS progress(pass INTEGER PRIMARY KEY,processed INTEGER,retained INTEGER,elapsed REAL,status TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS artists(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE IF NOT EXISTS artist_aliases(artist_id INTEGER,name TEXT,PRIMARY KEY(artist_id,name)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS relevant_artists(id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS releases(id INTEGER PRIMARY KEY,title TEXT,compilation INTEGER,source_id TEXT);
CREATE TABLE IF NOT EXISTS release_context(release_id INTEGER PRIMARY KEY,track_count INTEGER,release_type TEXT);
CREATE TABLE IF NOT EXISTS genres(id INTEGER PRIMARY KEY,name TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS annotations(entity_type TEXT,entity_id INTEGER,genre_id INTEGER,PRIMARY KEY(entity_id,genre_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS recordings(id INTEGER PRIMARY KEY,title TEXT,primary_artist_id INTEGER,duration_ms INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS recording_identity ON recordings(primary_artist_id,title,COALESCE(duration_ms,-1));
CREATE TABLE IF NOT EXISTS release_tracks(release_id INTEGER,position INTEGER,recording_id INTEGER,PRIMARY KEY(release_id,position)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS track_credits(release_id INTEGER,position INTEGER,artist_id INTEGER,role TEXT,PRIMARY KEY(release_id,position,artist_id,role)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS diagnostics(key TEXT PRIMARY KEY,value INTEGER);
CREATE TRIGGER IF NOT EXISTS discover_noncompilation AFTER INSERT ON progress
WHEN NEW.pass=1 AND NEW.status='complete' BEGIN
 DELETE FROM relevant_artists;
 INSERT OR IGNORE INTO relevant_artists SELECT DISTINCT r.primary_artist_id FROM recordings r JOIN release_tracks rt ON rt.recording_id=r.id JOIN releases rel ON rel.id=rt.release_id WHERE rel.compilation=0;
 INSERT OR IGNORE INTO relevant_artists SELECT DISTINCT c.artist_id FROM track_credits c JOIN releases rel ON rel.id=c.release_id WHERE rel.compilation=0;
END;
'''

def tags(fragment):
    return [base.html.unescape(raw.decode('utf8')) for block in re.findall(rb'<(?:genres|styles)>(.*?)</(?:genres|styles)>',fragment,re.S) for raw in re.findall(rb'<(?:genre|style)>(.*?)</(?:genre|style)>',block,re.S)]

def artist_id(credit):return int(credit[0].rsplit(':',1)[1])

def release_tracks(root):
    tracks=[]
    for track in root.findall('tracklist/track'):
        if track.attrib.get('type')=='heading':continue
        tracks.extend(track.findall('sub_tracks/track') or [track])
    return [t for t in tracks if t.findtext('title','').strip() and t.findtext('position','').strip()]

def all_credits(root):
    credits=base.credits(root,'artists/artist')
    for track in release_tracks(root):
        credits+=base.credits(track,'artists/artist')
        credits += [c for c in base.credits(track,'extraartists/artist') if re.search(r'\bremix',c[2],re.I)]
    credits += [c for c in base.credits(root,'extraartists/artist') if re.search(r'\bremix',c[2],re.I)]
    return credits

def retain(db,root,source,relevant=None,genre_ids=None):
    rid=int(root.attrib['id'])
    if db.execute('SELECT 1 FROM releases WHERE id=?',(rid,)).fetchone():return 0
    tracks=release_tracks(root);formats=base.texts(root,'formats/format/descriptions/description')
    compilation=any(f.lower() in {'compilation','mixed','dj mix'} for f in formats)
    kind='single' if any(f.lower() in {'single','maxi-single'} for f in formats) else 'ep' if 'EP' in formats else 'album' if 'Album' in formats else 'unknown'
    db.execute('INSERT INTO releases VALUES(?,?,?,?)',(rid,root.findtext('title',''),int(compilation),source))
    db.execute('INSERT INTO release_context VALUES(?,?,?)',(rid,len(tracks),kind))
    for tag in base.texts(root,'genres/genre')+base.texts(root,'styles/style'):
        gid=genre_ids.get(tag) if genre_ids is not None else None
        if gid is None:
            db.execute('INSERT OR IGNORE INTO genres(name) VALUES(?)',(tag,))
            gid=db.execute('SELECT id FROM genres WHERE name=?',(tag,)).fetchone()[0]
            if genre_ids is not None:genre_ids[tag]=gid
        db.execute("INSERT OR IGNORE INTO annotations VALUES('release',?,?)",(rid,gid))
    release_artists=base.credits(root,'artists/artist')
    global_remixers=[c for c in base.credits(root,'extraartists/artist') if re.search(r'\bremix',c[2],re.I)]
    seen_credits=set() # Release-local only: repeated album credits need one write.
    for position,track in enumerate(tracks):
        artists=base.credits(track,'artists/artist') or release_artists
        remixers=[c for c in base.credits(track,'extraartists/artist') if re.search(r'\bremix',c[2],re.I)]
        remixers += [c for c in global_remixers if not c[3] or track.findtext('position','') in [p.strip() for p in c[3].split(',')]]
        if not artists or relevant is not None and not any(artist_id(c) in relevant for c in artists+remixers):continue
        for credit in artists+remixers:
            aid=artist_id(credit)
            key=(aid,credit[1],credit[4])
            if key in seen_credits:continue
            seen_credits.add(key)
            db.execute('INSERT OR IGNORE INTO artists VALUES(?,?)',(aid,credit[1]))
            db.execute('INSERT OR IGNORE INTO artist_aliases VALUES(?,?)',(aid,credit[4]))
        title=track.findtext('title','').strip();milliseconds=base.duration(track.findtext('duration',''))
        aid=artist_id(artists[0])
        inserted=db.execute('INSERT OR IGNORE INTO recordings(title,primary_artist_id,duration_ms) VALUES(?,?,?)',(title,aid,milliseconds))
        recording=inserted.lastrowid if inserted.rowcount==1 else db.execute('SELECT id FROM recordings WHERE primary_artist_id=? AND title=? AND COALESCE(duration_ms,-1)=?',(aid,title,milliseconds if milliseconds is not None else -1)).fetchone()[0]
        db.execute('INSERT INTO release_tracks VALUES(?,?,?)',(rid,position,recording))
        # Primary credit is already stored on recordings; avoid duplicating it per pressing.
        for c in artists[1:]:db.execute('INSERT OR IGNORE INTO track_credits VALUES(?,?,?,?)',(rid,position,artist_id(c),'featured'))
        for c in remixers:db.execute('INSERT OR IGNORE INTO track_credits VALUES(?,?,?,?)',(rid,position,artist_id(c),'remixer'))
    return 1

def sizes(paths):
    return sum(p.stat().st_size for root in paths for p in Path(root).rglob('*') if p.is_file())

def run(args):
    global STOP
    STOP=False
    archive=Path(args.archive).resolve();target=Path(args.database).resolve();target.parent.mkdir(parents=True,exist_ok=True)
    taxonomy=json.loads(Path(args.taxonomy).read_text());families=taxonomy['families']
    # All house/adjacent tags from the fixed policy, including broad Electronic.
    # This intentionally trades source size for broad coverage; never artist names.
    chosen={t for t,family in families.items() if family in {'house','adjacent'}}
    st=archive.stat();options=json.dumps({'archive':str(archive),'bytes':st.st_size,'mtime':st.st_mtime_ns,'taxonomy':taxonomy,'version':1},sort_keys=True)
    db=sqlite3.connect(target);db.executescript(SCHEMA)
    db.execute('DROP TRIGGER IF EXISTS controlled_checkpoint_restart')
    # A hard per-file bound prevents runaway SQLite growth between checkpoints.
    page_budget=args.max_sqlite_gib*1024**3-64*1024**2
    aggregate_limit=getattr(args,'max_aggregate_sqlite_gib',None)
    if aggregate_limit:
        other=sum(p.stat().st_size for folder in [Path(__file__).resolve().parents[1]/'discogs/artifacts',Path(__file__).resolve().parents[1]/'recall-first/artifacts',target.parent] for p in folder.rglob('*') if p.is_file() and '.sqlite' in p.name and not p.name.endswith('.json') and p.name not in {target.name,target.name+'-wal',target.name+'-shm'})
        page_budget=min(page_budget,aggregate_limit*1024**3-other-64*1024**2)
    if page_budget<4096:raise RuntimeError('No approved SQLite budget remains')
    db.execute('PRAGMA max_page_count='+str(int(page_budget/4096)))
    old=db.execute("SELECT value FROM settings WHERE key='options'").fetchone()
    if old and old[0]!=options:raise ValueError('Archive/policy changed; use a new output')
    db.execute("INSERT OR IGNORE INTO settings VALUES('options',?)",(options,))
    db.execute("INSERT OR IGNORE INTO sources VALUES('discogs:dump:20261101','https://data.discogs.com/','CC0-1.0','20261101')")
    db.execute("INSERT OR IGNORE INTO catalog_scope VALUES(1,'genre-first-two-pass','All fixed-policy house/adjacent releases, then all credited relevant-artist tracks across genres; partial metadata, not verified discographies')")
    db.execute("INSERT OR IGNORE INTO import_state VALUES(1,'incomplete')");db.commit()
    genre_ids={name:gid for gid,name in db.execute('SELECT id,name FROM genres')}
    peak_disk=0
    def guard():
        nonlocal peak_disk
        used=sizes([Path(__file__).resolve().parents[1]/'discogs/artifacts',Path(__file__).resolve().parents[1]/'recall-first/artifacts',target.parent]);peak_disk=max(peak_disk,used)
        sqlite_bytes=sum(p.stat().st_size for folder in [Path(__file__).resolve().parents[1]/'discogs/artifacts',Path(__file__).resolve().parents[1]/'recall-first/artifacts',target.parent] for p in folder.rglob('*') if p.is_file() and ('.sqlite' in p.name and not p.name.endswith('.json')))
        current_db=sum(p.stat().st_size for p in [target,Path(str(target)+'-wal')] if p.exists())
        if used>args.max_total_gb*10**9-64*1024**2 or current_db>args.max_sqlite_gib*1024**3-64*1024**2 or aggregate_limit and sqlite_bytes>aggregate_limit*1024**3-64*1024**2:raise RuntimeError('Approved storage cap reached; checkpoint preserved. Explicit approval required to increase limits.')
        if os.statvfs(target.parent).f_bavail*os.statvfs(target.parent).f_frsize<5*1024**3:raise RuntimeError('Less than 5 GiB free')
        return used,sqlite_bytes
    for pass_number in [1,2]:
        saved=db.execute('SELECT processed,retained,elapsed,status FROM progress WHERE pass=?',(pass_number,)).fetchone()
        if saved and saved[3]=='complete':continue
        checkpoint,retained,previous=(saved[:3] if saved else (0,0,0));started=time.monotonic();processed=0
        relevant={r[0] for r in db.execute('SELECT id FROM relevant_artists')} if pass_number==2 else None
        if pass_number==2 and not relevant:raise ValueError('Genre pass found no relevant artists')
        def commit(status):
            db.execute('INSERT OR REPLACE INTO progress VALUES(?,?,?,?,?)',(pass_number,processed,retained,time.monotonic()-started+previous,status));db.commit();db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            used,sqlbytes=guard()
            report={'pass':pass_number,'status':status,'scanned':processed,'retainedThisPass':retained,'elapsedSeconds':round(time.monotonic()-started+previous,2),'databaseBytes':target.stat().st_size,'sqliteBytesTotal':sqlbytes,'artifactBytesTotal':used,'peakArtifactBytes':peak_disk,'peakRssBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if os.uname().sysname=='Darwin' else 1024)}
            Path(str(target)+'.import.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
        try:
            db.execute('BEGIN')
            for fragment in base.fragments(archive):
                processed+=1
                if processed<=checkpoint:
                    if STOP:
                        db.rollback();db.close();print(json.dumps({'pass':pass_number,'status':'interrupted-during-prefix','savedCheckpoint':checkpoint}),flush=True);return
                    continue
                if STOP:processed-=1;commit('interrupted');db.close();return
                if pass_number==1:
                    if any(tag in chosen for tag in tags(fragment)):
                        root=base.parse_release(fragment)
                        for credit in all_credits(root):db.execute('INSERT OR IGNORE INTO relevant_artists VALUES(?)',(artist_id(credit),))
                        retained+=retain(db,root,'discogs:dump:20261101',genre_ids=genre_ids)
                else:
                    rid=re.match(rb'<release\s+id="(\d+)"',fragment)
                    # Avoid parsing already retained relevant releases.
                    if rid and db.execute('SELECT 1 FROM releases WHERE id=?',(int(rid[1]),)).fetchone():continue
                    # IDs must be in artist credit blocks, not label/master IDs.
                    ids=[int(raw) for block in re.findall(rb'<(?:artists|extraartists)>(.*?)</(?:artists|extraartists)>',fragment,re.S) for raw in re.findall(rb'<id>(\d+)</id>',block)]
                    if any(aid in relevant for aid in ids):
                        root=base.parse_release(fragment)
                        if any(artist_id(c) in relevant for c in all_credits(root)):retained+=retain(db,root,'discogs:dump:20261101',relevant,genre_ids)
                if processed%args.batch==0:
                    # Inspect WAL as well as main files before committing the batch.
                    guard();commit('running');db.execute('BEGIN')
                if args.max_processed and processed>=args.max_processed:
                    commit('capped');db.close();return
            commit('complete')
        except BaseException:
            db.rollback();db.close();raise
    db.execute("UPDATE import_state SET status='complete'");db.commit();db.execute('PRAGMA wal_checkpoint(TRUNCATE)');db.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive');parser.add_argument('database');parser.add_argument('taxonomy')
    parser.add_argument('--batch',type=int,default=10000);parser.add_argument('--max-processed',type=int,default=0)
    parser.add_argument('--max-total-gb',type=float,default=30);parser.add_argument('--max-sqlite-gib',type=float,default=8);parser.add_argument('--max-aggregate-sqlite-gib',type=float)
    args=parser.parse_args()
    def stop(*_):
        global STOP
        STOP=True
    signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGTERM,stop)
    run(args)
