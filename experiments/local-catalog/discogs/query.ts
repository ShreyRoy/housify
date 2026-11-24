import { LocalCatalog } from "../catalog.ts";
const [artist,title,duration]=process.argv.slice(2);
if(!artist||!title)throw new Error('Usage: query.ts "Artist" "Title (Exact Mix)" [duration-ms]');
if(duration&&(!Number.isFinite(Number(duration))||Number(duration)<0))throw new Error("Duration must be a nonnegative number of milliseconds");
const catalog=new LocalCatalog("experiments/local-catalog/discogs/artifacts/selected.sqlite",undefined,true);
try{console.log(JSON.stringify(catalog.classify({artist,title,durationMs:duration?Number(duration):undefined}),null,2));}finally{catalog.close();}
