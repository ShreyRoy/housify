"""Bounded storage estimate only, never an accuracy or full-coverage result."""
import json,sqlite3,subprocess,time
from pathlib import Path
here=Path(__file__).resolve().parent;art=here/'artifacts';src=art/'source.sqlite';pilot=art/'storage-pilot.sqlite'
if pilot.exists():raise ValueError('Pilot already exists; refusing to overwrite measurements')
db=sqlite3.connect(pilot);db.execute('ATTACH DATABASE ? AS src',('file:'+str(src)+'?mode=ro',));db.execute('BEGIN')
for name,query in {
 'recordings':'SELECT * FROM src.recordings WHERE primary_artist_id%100=0',
 'release_tracks':'SELECT rt.* FROM src.release_tracks rt JOIN recordings r ON r.id=rt.recording_id',
 'releases':'SELECT * FROM src.releases WHERE id IN (SELECT release_id FROM release_tracks)',
 'release_context':'SELECT * FROM src.release_context WHERE release_id IN (SELECT id FROM releases)',
 'annotations':'SELECT * FROM src.annotations WHERE entity_id IN (SELECT id FROM releases)',
 'genres':'SELECT * FROM src.genres',
 'artists':'SELECT * FROM src.artists WHERE id IN (SELECT primary_artist_id FROM recordings)',
 'artist_aliases':'SELECT * FROM src.artist_aliases WHERE artist_id IN (SELECT id FROM artists)',
 'sources':'SELECT * FROM src.sources',
}.items():
 db.execute('CREATE TABLE '+name+' AS '+query)
 if name in ['recordings','releases']:db.execute('CREATE INDEX '+name+'_id ON '+name+'(id)')
db.executescript("CREATE TABLE import_state(status TEXT);INSERT INTO import_state VALUES('complete');CREATE TABLE catalog_scope(id INTEGER,scope TEXT,limitation TEXT);INSERT INTO catalog_scope VALUES(1,'storage-pilot','Completed bounded prefix/artist-ID modulo sample, NOT a completed full import or accuracy benchmark');")
source_count=db.execute('SELECT COUNT(*) FROM src.recordings').fetchone()[0];pilot_count=db.execute('SELECT COUNT(*) FROM recordings').fetchone()[0];progress=db.execute('SELECT * FROM src.progress').fetchall();db.commit();db.close()
output=art/'storage-pilot-index.sqlite'
subprocess.run(['node','--experimental-transform-types',str(here.parent/'recall-first/build.ts'),str(pilot),str(output)],check=True,stdout=(art/'storage-pilot-build.log').open('w'),stderr=subprocess.STDOUT)
result={'sourceRecordingsAtSnapshot':source_count,'sampleRecordings':pilot_count,'sourceProgressAtSnapshot':progress,'sampleSourceBytes':pilot.stat().st_size,'sampleIndexBytes':output.stat().st_size,'prefixIndexEstimateBytes':output.stat().st_size*source_count/max(1,pilot_count),'limitations':'One-percent artist-ID modulo sample of the current chronological genre-prefix import. Artist IDs and release ordering are not random. Extrapolation excludes second-pass evidence and is a rough storage warning only.'}
(art/'storage-pilot.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
