import { RecallClassifier } from "./classifier.ts";
import { Overrides } from "./overrides.ts";
const [artist,title,durationMs,independentRecordingRef]=process.argv.slice(2);
if(!artist||!title)throw new Error('Usage: query.ts "Artist" "Title (Mix)" [duration-ms] [independent-recording-ref]');
const overrides=new Overrides("experiments/local-catalog/recall-first/artifacts/overrides.sqlite");
const classifier=new RecallClassifier("experiments/local-catalog/recall-first/artifacts/index.sqlite",overrides);
try{console.log(JSON.stringify(classifier.classify({artist,title,durationMs:durationMs?Number(durationMs):undefined,independentRecordingRef}),null,2));}finally{classifier.close();overrides.close();}
