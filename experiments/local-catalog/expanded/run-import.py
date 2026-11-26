"""Wait for census, export authoritative TS taxonomy, run pilot then full passes."""
import argparse,json,os,sqlite3,subprocess,sys,time
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--max-total-gb',type=float,default=30);parser.add_argument('--max-sqlite-gib',type=float,default=8);parser.add_argument('--max-aggregate-sqlite-gib',type=float);args=parser.parse_args()
here=Path(__file__).resolve().parent;art=here/'artifacts';root=here.parents[2]
census=art/'census.json'
if not census.exists():raise FileNotFoundError('Run census.py to completion before run-import.py')
subprocess.run(['node','--experimental-transform-types',str(here/'taxonomy.ts'),str(census)+'.tags.json',str(art/'taxonomy.json')],check=True)
folders=[here.parent/'discogs/artifacts',here.parent/'recall-first/artifacts',art]
existing=sum(p.stat().st_size for f in folders for p in f.rglob('*') if p.is_file())
preflight={'freeBytes':os.statvfs(art).f_bavail*os.statvfs(art).f_frsize,'existingArtifactBytes':existing,'limits':{'totalArtifactBytes':args.max_total_gb*10**9,'perDatabaseBytesIncludingWal':args.max_sqlite_gib*1024**3,'aggregateSqliteBytes':args.max_aggregate_sqlite_gib*1024**3 if args.max_aggregate_sqlite_gib else None},'peakBudgetEstimate':'Existing ~14.1 GB plus expanded source/index and temporary files, bounded by the approved total artifact cap and per-database cap. Expected final size remains unmeasured; source/index pilot scaling is provisional and processing stops rather than exceeding the caps.','sourceArchive':str(here.parent/'discogs/artifacts/discogs_20261101_releases.xml.gz')}
(art/('preflight-'+str(time.time_ns())+'.json')).write_text(json.dumps(preflight,indent=2));(art/'preflight.json').write_text(json.dumps(preflight,indent=2));print(json.dumps(preflight),flush=True)
cmd=[sys.executable,'-u',str(here/'import.py'),preflight['sourceArchive'],str(art/'source.sqlite'),str(art/'taxonomy.json'),*sys.argv[1:]]
# Pause after a measurable pilot, then continue under the SAME storage guards.
needs_pilot=not (art/'source.sqlite').exists()
if needs_pilot:
 subprocess.run(cmd+['--max-processed','100000'],check=True)
 print(json.dumps({'pilot':json.loads((art/'source.sqlite.import.json').read_text()),'note':'Prefix is not representative; do not extrapolate its genre distribution as full-dump ground truth.'}),flush=True)
subprocess.run(cmd,check=True)
