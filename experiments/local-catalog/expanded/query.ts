import {RecallClassifier} from '../recall-first/classifier.ts';
import {Overrides} from '../recall-first/overrides.ts';
import {existsSync} from 'node:fs';
const [artist,title,duration,independentRecordingRef]=process.argv.slice(2);
if(!artist||!title)throw Error('Usage: query.ts "Artist" "Title (Mix)" [duration-ms] [independent-recording-ref]');
// Reuse an existing independent override store without replacing or seeding it.
const overridePath='experiments/local-catalog/recall-first/artifacts/overrides.sqlite';
const overrides=existsSync(overridePath)?new Overrides(overridePath):undefined;
const classifier=new RecallClassifier('experiments/local-catalog/expanded/artifacts/index.sqlite',overrides);
try{console.log(JSON.stringify(classifier.classify({artist,title,durationMs:duration?Number(duration):undefined,independentRecordingRef}),null,2));}finally{classifier.close();overrides?.close();}
