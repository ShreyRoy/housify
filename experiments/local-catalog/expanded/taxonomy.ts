// Export the existing, fixed policy for the offline Python selection pass.
import { POLICY, genreFamily } from '../recall-first/policy.ts';
import { readFileSync, writeFileSync } from 'node:fs';
const tags=JSON.parse(readFileSync(process.argv[2],'utf8')) as string[];
writeFileSync(process.argv[3],JSON.stringify({policy:POLICY,families:Object.fromEntries(tags.map(tag=>[tag,genreFamily(tag)]))},null,2));
