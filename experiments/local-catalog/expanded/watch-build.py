"""Reattach storage monitoring to an owned, paused preprocessing process group.
Limits come from the explicit user-approval record. This does not launch another
builder, alter metadata, or classify tracks. A limit stop preserves paused work.
"""
import argparse,json,os,signal,time
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('process_group',type=int);p.add_argument('--baseline-temp-reserve-mib',type=int,default=256);args=p.parse_args()
if args.process_group<=1:raise ValueError('An owned preprocessing process group is required')
here=Path(__file__).resolve().parent;art=here/'artifacts';folders=[here.parent/'discogs/artifacts',here.parent/'recall-first/artifacts',art]
def visible():return sum(v.stat().st_size for f in folders for v in f.rglob('*') if v.is_file())
def sqlbytes():return sum(v.stat().st_size for f in folders for v in f.rglob('*') if v.is_file() and ('.sqlite' in v.name or v.parent==art/'tmp') and not v.name.endswith('.json'))
def free():return os.statvfs(art).f_bavail*os.statvfs(art).f_frsize
def alive():
 try:os.killpg(args.process_group,0);return True
 except ProcessLookupError:return False
initial=visible();initial_free=free();reserve=args.baseline_temp_reserve_mib*1024**2;peak=initial+reserve;peak_sql=sqlbytes()+reserve;last_limits=None;samples=0;reason=None
while alive():
 limits=json.loads((here/'approved-limits.json').read_text());total_limit=limits['peakArtifactBytes'];sql_limit=limits['aggregateSqliteBytes']
 if (total_limit,sql_limit)!=last_limits:
  last_limits=(total_limit,sql_limit);print(json.dumps({'stage':'watching owned preprocessing group','processGroup':args.process_group,'peakArtifactLimitBytes':total_limit,'aggregateSqliteLimitBytes':sql_limit}),flush=True)
  (art/'monitor-ready.json').write_text(json.dumps({'processGroup':args.process_group,'limits':limits},indent=2))
 current=visible();unlinked=max(0,reserve+initial_free-free()-(current-initial));disk=current+unlinked;sqlite=sqlbytes()+unlinked;peak=max(peak,disk);peak_sql=max(peak_sql,sqlite);samples+=1
 if disk>total_limit-256*1024**2 or sqlite>sql_limit-256*1024**2:
  os.killpg(args.process_group,signal.SIGSTOP);reason='Approved storage threshold reached; owned job paused, not discarded';break
 time.sleep(1)
output=art/'index.sqlite';complete=reason is None and output.exists() and Path(str(output)+'.build.json').exists()
report={'exitCode':0 if complete else 2,'reason':reason,'reattachedProcessGroup':args.process_group,'peakArtifactBytesEstimate':peak,'peakAllSqliteBytesEstimate':peak_sql,'baselineTempReserveBytes':reserve,'samples':samples,'method':'Visible files plus positive unexplained filesystem free-space delta and a conservative handoff reserve. Limits refresh only from the explicit user-approval record. Concurrent disk activity can overestimate unlinked SQLite scratch; this is not exact process-attributed disk usage.'}
(art/'build-storage.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
if not complete:raise SystemExit(2)
