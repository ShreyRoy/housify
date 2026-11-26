import argparse,gzip,importlib.util,json,sqlite3,subprocess,tempfile,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('expanded_import',HERE/'import.py');imp=importlib.util.module_from_spec(spec);spec.loader.exec_module(imp)
def release(i,aid,name,genre='House',title='Song',extra=''):
    return f'<release id="{i}"><artists><artist><id>{aid}</id><name>{name}</name></artist></artists><title>Release {i}</title><genres><genre>{genre}</genre></genres><formats><format><descriptions><description>Single</description></descriptions></format></formats><tracklist><track><position>1</position><title>{title}</title><duration>4:00</duration>{extra}</track></tracklist></release>'
class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.path=Path(self.tmp.name)
        self.archive=self.path/'source.gz';self.target=self.path/'source.sqlite';self.taxonomy=self.path/'taxonomy.json'
        self.taxonomy.write_text(json.dumps({'policy':{},'families':{'House':'house','Rock':'other'}}))
    def run_import(self,max_processed=0):
        imp.run(argparse.Namespace(archive=str(self.archive),database=str(self.target),taxonomy=str(self.taxonomy),batch=1,max_processed=max_processed,max_total_gb=30,max_sqlite_gib=8))
    def write(self,records):
        with gzip.open(self.archive,'wb') as f:f.write(('<releases>'+''.join(records)+'</releases>').encode())
    def test_genre_discovery_then_mixed_discography_not_unrelated(self):
        self.write([release(1,500,'Previously Unknown Producer'),release(2,500,'Previously Unknown Producer','Rock','Other song'),release(3,999,'Unrelated artist','Rock')])
        self.run_import()
        with sqlite3.connect(self.target) as db:
            self.assertEqual(db.execute('SELECT id FROM releases ORDER BY id').fetchall(),[(1,),(2,)])
            self.assertEqual(db.execute('SELECT status FROM import_state').fetchone()[0],'complete')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM recordings').fetchone()[0],2)
    def test_dedup_pressings_but_keep_versions_and_remixer_credit(self):
        extra='<extraartists><artist><id>77</id><name>Remixer</name><role>Remix</role></artist></extraartists>'
        self.write([release(1,1,'Producer',title='Song (Original Mix)',extra=extra),release(2,1,'Producer',title='Song (Original Mix)'),release(3,1,'Producer',title='Song (Radio Edit)'),release(4,77,'Remixer','Rock','Remixer rock song')]);self.run_import()
        with sqlite3.connect(self.target) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM recordings').fetchone()[0],3)
            self.assertEqual(db.execute("SELECT artist_id FROM track_credits WHERE role='remixer'").fetchall(),[(77,)])
    def test_checkpoint_resume_and_options_guard(self):
        self.write([release(1,1,'Unknown producer'),release(2,1,'Unknown producer','Rock')]);self.run_import(1);self.run_import();self.run_import()
        with sqlite3.connect(self.target) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM releases').fetchone()[0],2)
        self.taxonomy.write_text(json.dumps({'policy':{'changed':True},'families':{}}))
        with self.assertRaisesRegex(ValueError,'Archive/policy changed'):self.run_import()
    def test_compilation_members_do_not_seed_unrelated_discographies(self):
        comp=release(1,9,'Compilation guest').replace('<description>Single</description>','<description>Compilation</description>')
        self.write([comp,release(2,9,'Compilation guest','Rock','Unrelated album'),release(3,1,'House artist')]);self.run_import()
        with sqlite3.connect(self.target) as db:
            self.assertEqual(db.execute('SELECT id FROM relevant_artists').fetchall(),[(1,)])
            self.assertIsNone(db.execute('SELECT id FROM releases WHERE id=2').fetchone())
    def test_same_source_evidence_yields_same_consensus_as_original_importer(self):
        records=[release(1,1,'Producer'),release(2,1,'Producer'),release(3,1,'Producer','Rock','Song'),release(4,1,'Producer',title='Song (Radio Edit)')]
        self.write(records);self.run_import()
        original=self.path/'original.sqlite'
        base=imp.base
        base.run(base.arguments([str(self.archive),str(original),'--scope','all','--snapshot','20261101']))
        outputs=[]
        for src,name in [(original,'original'),(self.target,'expanded')]:
            out=self.path/(name+'-index.sqlite')
            subprocess.run(['node','--experimental-transform-types',str(HERE.parent/'recall-first/build.ts'),str(src),str(out)],check=True,capture_output=True)
            with sqlite3.connect(out) as db:
                outputs.append((db.execute('SELECT artist,title,version,duration_min,duration_max,house,other,adjacent,conflict,strong_house,strong_other FROM track_index ORDER BY artist,title,version,cluster').fetchall(),db.execute('SELECT lookup,artist,sample_size,tagged,house_affinity,coverage,kind FROM artist_index ORDER BY lookup,artist').fetchall()))
        self.assertEqual(outputs[0],outputs[1])
    def test_storage_guard_rolls_back_uncommitted_batch(self):
        self.write([release(1,1,'Producer')])
        args=argparse.Namespace(archive=str(self.archive),database=str(self.target),taxonomy=str(self.taxonomy),batch=1,max_processed=0,max_total_gb=1,max_sqlite_gib=8,max_aggregate_sqlite_gib=None)
        with self.assertRaisesRegex(RuntimeError,'storage cap'):imp.run(args)
        with sqlite3.connect(self.target) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM recordings').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM progress').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT status FROM import_state').fetchone()[0],'incomplete')
    def test_cancel_during_resume_prefix_does_not_move_checkpoint(self):
        self.write([release(1,1,'Producer'),release(2,1,'Producer')]);self.run_import(1)
        original=imp.base.fragments
        def interrupted(path):
            for fragment in original(path):
                imp.STOP=True
                yield fragment
        imp.base.fragments=interrupted
        try:self.run_import()
        finally:imp.base.fragments=original
        with sqlite3.connect(self.target) as db:
            self.assertEqual(db.execute('SELECT processed,retained FROM progress WHERE pass=1').fetchone(),(1,1))
        self.run_import()
    def test_bounded_partitions_produce_identical_track_and_artist_tables(self):
        self.write([release(1,1,'Shared Name'),release(2,2,'Shared Name (2)'),release(3,1,'Shared Name','Rock'),release(4,100,'Other Producer',title='Song (Named Remix)'),release(5,101,'Third Producer',title='Song (Radio Edit)'),release(6,100,'Other Producer','Rock','Different Song')]);self.run_import()
        native=self.path/'native.sqlite';bounded=self.path/'bounded.sqlite'
        for script,out,extra in [(HERE.parent/'recall-first/build.ts',native,[]),(HERE/'build-index.ts',bounded,['4'])]:
            result=subprocess.run(['node','--experimental-transform-types',str(script),str(self.target),str(out),*extra],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr+'\n'+result.stdout[-3000:])
        with sqlite3.connect(native) as a,sqlite3.connect(bounded) as b:
            for table,order in [('track_index','artist,title,version,cluster'),('artist_index','lookup,artist')]:
                self.assertEqual(a.execute('SELECT * FROM '+table+' ORDER BY '+order).fetchall(),b.execute('SELECT * FROM '+table+' ORDER BY '+order).fetchall())
        self.assertFalse(any(self.path.glob('build-work-*')))
    def test_stage_can_feed_unchanged_builder_and_classifier(self):
        self.write([release(1,1,'Obscure house producer'),release(2,1,'Obscure house producer','Rock','Rock single')]);self.run_import()
        out=self.path/'index.sqlite'
        subprocess.run(['node','--experimental-transform-types',str(HERE.parent/'recall-first/build.ts'),str(self.target),str(out)],check=True,capture_output=True)
        with sqlite3.connect(out) as db:
            self.assertEqual(db.execute("SELECT strong_house FROM track_index WHERE title='song'").fetchone()[0],1)
            self.assertEqual(db.execute("SELECT strong_other FROM track_index WHERE title='rock single'").fetchone()[0],1)
            self.assertEqual(db.execute('SELECT house_affinity FROM artist_index').fetchone()[0],.5)
if __name__=='__main__':unittest.main()
