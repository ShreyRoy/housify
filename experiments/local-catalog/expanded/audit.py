"""Read-only full-archive diagnostics. Probe names NEVER control extraction."""
import importlib.util,json,re,sys,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('expanded',Path(__file__).with_name('import.py'));imp=importlib.util.module_from_spec(spec);spec.loader.exec_module(imp)
base=imp.base
probes=[('Drake','Massive'),('Drake','Falling Back'),('DJ BORING','Winona'),('Palms Trax','Equation'),("Barry Can't Swim",'Sunsleeper')]
keys={(base.normalize(a),base.normalize(t)):[] for a,t in probes}
# Name test is only a diagnostic fast path, not an extraction selector.
pattern=re.compile(rb'<name>(?:Drake|DJ BORING|Palms Trax|Barry Can(?:\x27|&apos;|&#39;)?t Swim)(?: \(\d+\))?</name>',re.I)
n=0;started=time.monotonic()
for fragment in base.fragments(sys.argv[1]):
    n+=1
    if pattern.search(fragment):
        root=base.parse_release(fragment);rartists=base.credits(root,'artists/artist')
        for track in imp.release_tracks(root):
            artists=base.credits(track,'artists/artist') or rartists
            for a in artists:
                key=(base.normalize(a[1]),base.normalize(track.findtext('title','')))
                if key in keys:
                    keys[key].append({'releaseId':root.attrib['id'],'releaseTitle':root.findtext('title'),'artistId':imp.artist_id(a),'artist':a[1],'title':track.findtext('title'),'durationMs':base.duration(track.findtext('duration','')),'tags':base.texts(root,'genres/genre')+base.texts(root,'styles/style'),'formats':base.texts(root,'formats/format/descriptions/description')})
    if n%1000000==0:print(json.dumps({'scanned':n,'elapsedSeconds':round(time.monotonic()-started,1),'matches':{a+' — '+t:len(keys[(base.normalize(a),base.normalize(t))]) for a,t in probes}}),flush=True)
Path(sys.argv[2]).write_text(json.dumps({'scanned':n,'elapsedSeconds':time.monotonic()-started,'probes':[{'artist':a,'title':t,'matches':keys[(base.normalize(a),base.normalize(t))]} for a,t in probes],'limitation':'Exact normalized title and expected credit name; does not prove absence under unrelated aliases/version spellings.'},indent=2))
