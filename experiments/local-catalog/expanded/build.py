"""Run the existing preprocessor with aggregate storage monitoring, no rule changes."""
import argparse,json,os,shutil,signal,subprocess,sys,time
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--max-total-gb',type=float,default=30);parser.add_argument('--max-sqlite-gib',type=float,default=8);parser.add_argument('--max-aggregate-sqlite-gib',type=float);args=parser.parse_args()
here=Path(__file__).resolve().parent;art=here/'artifacts';temp=art/'tmp';temp.mkdir(exist_ok=True)
folders=[here.parent/'discogs/artifacts',here.parent/'recall-first/artifacts',art]
def visible():return sum(p.stat().st_size for f in folders for p in f.rglob('*') if p.is_file())
def sqlbytes():return sum(p.stat().st_size for f in folders for p in f.rglob('*') if p.is_file() and ('.sqlite' in p.name or p.parent==temp) and not p.name.endswith('.json'))
def largest_database():
 groups={}
 for f in folders:
  for p in f.rglob('*'):
   if p.is_file() and '.sqlite' in p.name and not p.name.endswith('.json'):
    key=str(p.parent/(p.name.split('.sqlite')[0]+'.sqlite'));groups[key]=groups.get(key,0)+p.stat().st_size
 return max(groups.values(),default=0)
def free():return os.statvfs(art).f_bavail*os.statvfs(art).f_frsize
initial=visible();initial_free=free();peak=initial;peak_sql=sqlbytes();samples=0;reason=None
with (art/'build.log').open('w') as log:
 child=subprocess.Popen(['node','--experimental-transform-types',str(here/'build-index.ts'),str(art/'source.sqlite'),str(art/'index.sqlite')],stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'TMPDIR':str(temp)},start_new_session=True)
 while child.poll() is None:
  current=visible();unlinked=max(0,initial_free-free()-(current-initial));observed=current+unlinked;current_sql=sqlbytes()+unlinked
  peak=max(peak,observed);peak_sql=max(peak_sql,current_sql);samples+=1
  if observed>args.max_total_gb*10**9-256*1024**2 or largest_database()>args.max_sqlite_gib*1024**3-256*1024**2 or args.max_aggregate_sqlite_gib and current_sql>args.max_aggregate_sqlite_gib*1024**3-256*1024**2:
   reason='Approved storage budget reached (including conservative filesystem-delta estimate of unlinked SQLite temporary files)';os.killpg(child.pid,signal.SIGINT);child.wait();break
  time.sleep(1)
 code=child.wait()
if code!=0:
 for path in art.glob('build-work-'+str(child.pid)+'-*'):shutil.rmtree(path)
 partial=art/('index.sqlite.building-'+str(child.pid))
 if partial.exists():partial.unlink()
report={'limits':vars(args),'exitCode':code,'reason':reason,'peakArtifactBytesEstimate':peak,'peakAllSqliteBytesEstimate':peak_sql,'sqliteCapScope':'Per-database limit plus explicit aggregate cap, when supplied; includes preserved databases and conservative temp-file estimate','samples':samples,'method':'One-second visible artifact sizes plus positive unexplained filesystem free-space delta, including unlinked temporary files; concurrent disk activity can overestimate usage. Not an exact process-attributed disk high-water mark.'}
(art/'build-storage.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
if code!=0:sys.exit(1)
