CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE track_index(
  artist TEXT NOT NULL,title TEXT NOT NULL,version TEXT NOT NULL,cluster INTEGER NOT NULL,
  duration_min INTEGER,duration_max INTEGER,house INTEGER NOT NULL,other INTEGER NOT NULL,adjacent INTEGER NOT NULL,
  conflict INTEGER NOT NULL,strong_house INTEGER NOT NULL,strong_other INTEGER NOT NULL,
  units INTEGER NOT NULL,house_units INTEGER NOT NULL,other_units INTEGER NOT NULL,
  tags TEXT NOT NULL,provenance TEXT NOT NULL,
  PRIMARY KEY(artist,title,version,cluster)
) WITHOUT ROWID;
CREATE TABLE artist_index(
  lookup TEXT NOT NULL,artist TEXT NOT NULL,aliases TEXT NOT NULL,
  sample_size INTEGER NOT NULL,tagged INTEGER NOT NULL,house_samples INTEGER NOT NULL,adjacent_samples INTEGER NOT NULL,
  house_affinity REAL NOT NULL,adjacent_affinity REAL NOT NULL,coverage REAL NOT NULL,kind TEXT NOT NULL,
  PRIMARY KEY(lookup,artist)
) WITHOUT ROWID;
