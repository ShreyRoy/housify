"""Full archive genre vocabulary and genre-first coverage census, no network."""
import importlib.util, json, re, sys, time
from pathlib import Path
spec=importlib.util.spec_from_file_location('discogs_import',Path(__file__).resolve().parents[1]/'discogs/import.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
archive,output=sys.argv[1:3]
tags={}; n=0; started=time.monotonic()
for fragment in base.fragments(archive):
    n+=1
    # Tags only inside their proper elements, not titles/descriptions/notes.
    for block in re.findall(rb'<(?:genres|styles)>(.*?)</(?:genres|styles)>',fragment,re.S):
        for raw in re.findall(rb'<(?:genre|style)>(.*?)</(?:genre|style)>',block,re.S):
            tag=base.html.unescape(raw.decode('utf8'));tags[tag]=tags.get(tag,0)+1
    if n%250000==0:print(json.dumps({'stage':'vocabulary','scanned':n,'seconds':round(time.monotonic()-started,1)}),flush=True)
Path(output).write_text(json.dumps({'releasesScanned':n,'tagCounts':tags,'elapsedSeconds':time.monotonic()-started},indent=2))
Path(output+'.tags.json').write_text(json.dumps(sorted(tags)))
print(json.dumps({'stage':'complete','scanned':n,'tags':len(tags),'seconds':time.monotonic()-started}),flush=True)
