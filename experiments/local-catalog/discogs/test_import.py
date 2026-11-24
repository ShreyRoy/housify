import gzip
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("discogs_import", HERE / "import.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def release(number, title="Track (Extended Mix)", compilation=False, style="Deep House", artist="Example Artist", master="100"):
    return f'''<release id="{number}"><artists><artist><id>1</id><name>{artist}</name></artist></artists><title>Release</title><labels><label id="2" name="Example Label" catno="CAT-1"/></labels><formats><format name="File"><descriptions><description>{"Compilation" if compilation else "Single"}</description></descriptions></format></formats><genres><genre>Electronic</genre></genres><styles><style>{style}</style></styles><released>2026-01-01</released><master_id>{master}</master_id><tracklist><track><position>1</position><title>{title}</title><duration>5:00</duration><extraartists><artist><id>3</id><name>Example Remixer</name><role>Remix</role></artist></extraartists></track></tracklist></release>'''


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "sample.xml.gz"
        self.db = self.root / "catalog.sqlite"

    def write(self, records):
        with gzip.open(self.archive, "wb") as handle:
            handle.write(("<releases>\n" + "\n".join(records) + "\n</releases>").encode())

    def run_import(self, *flags):
        importer.run(importer.arguments([str(self.archive), str(self.db), "--snapshot", "2026-11-01", "--batch", "1", *flags]))

    def test_pressings_versions_scope_and_credits(self):
        self.write([release(1), release(2), release(3, "Track (Radio Edit)"), release(4, compilation=True)])
        self.run_import()
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM releases").fetchone()[0], 4)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM recordings").fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM annotations WHERE entity_type='recording'").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM recording_artists WHERE role='remixer'").fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM releases WHERE compilation=1").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT SUM(verified) FROM recording_context").fetchone()[0], 0)

    def test_capped_restart_is_idempotent(self):
        self.write([release(1), release(2), release(3)])
        self.run_import("--max-processed", "1")
        self.run_import()
        self.run_import()
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM releases").fetchone()[0], 3)
            self.assertEqual(db.execute("SELECT processed,status FROM import_state").fetchone(), (3, "complete"))

    def test_artist_scope_keeps_non_house_discography(self):
        self.write([release(1, style="Tech House"), release(2, style="Rock"), release(3, artist="Other Artist")])
        artists = self.root / "artists.json"
        artists.write_text(json.dumps(["Example Artist"]))
        self.run_import("--scope", "artists", "--artists", str(artists))
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM releases").fetchone()[0], 2)
            self.assertIsNotNone(db.execute("SELECT id FROM genres WHERE name='Rock'").fetchone())

    def test_corruption_does_not_advance_uncommitted_checkpoint(self):
        self.write([release(1), '<release id="2"><broken></release>'])
        with self.assertRaises(Exception):
            self.run_import("--scope", "all")
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT processed FROM import_state").fetchone()[0], 1)

    def test_changed_snapshot_refuses_resume(self):
        self.write([release(1)])
        self.run_import()
        self.write([release(2)])
        with self.assertRaisesRegex(ValueError, "Archive/options changed"):
            self.run_import()

    def test_source_metadata_cannot_change_on_completed_import(self):
        self.write([release(1)])
        self.run_import()
        with self.assertRaisesRegex(ValueError, "Source snapshot/URL changed"):
            self.run_import("--snapshot", "2026-12-01")

    def test_canceling_prefix_replay_never_regresses_checkpoint(self):
        self.write([release(1), release(2), release(3)])
        self.run_import("--max-processed", "2")
        original = importer.fragments
        def interrupted(path):
            for fragment in original(path):
                importer.STOP = True
                yield fragment
        importer.fragments = interrupted
        try:
            self.run_import()
        finally:
            importer.fragments = original
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT processed,retained FROM import_state").fetchone(), (2, 2))
            self.assertEqual(db.execute("SELECT COUNT(*) FROM releases").fetchone()[0], 2)
        self.run_import()
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT processed,status FROM import_state").fetchone(), (3, "complete"))

    def test_ambiguous_xml_framing_is_rejected(self):
        self.write([release(1).replace("<title>Release</title>", "<title><![CDATA[x </release>]]></title>")])
        with self.assertRaises(ValueError):
            list(importer.fragments(self.archive))


if __name__ == "__main__":
    unittest.main()
