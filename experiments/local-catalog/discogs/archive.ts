// Explicit download/verification utility. Never imported by application code.
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root=new URL("./",import.meta.url);
const preflight=JSON.parse(await readFile(new URL("./preflight.json",root),"utf8"));
const artifact=new URL("./artifacts/discogs_20261101_releases.xml.gz",root);
const part=new URL(artifact.href+".part");
const expected=(await readFile(new URL("./checksums.txt",root),"utf8")).split("\n").find(line=>line.endsWith("discogs_20261101_releases.xml.gz"))!.split(" ")[0];
await mkdir(new URL("./artifacts/",root),{recursive:true});
const exists=async(url:URL)=>stat(url).catch(()=>null);
if(!await exists(artifact)){
  if(!process.argv.includes("--download-approved"))throw new Error("Archive absent. Review preflight.json and explicitly authorize the substantial download with --download-approved.");
  const disk=await statfs(new URL("./artifacts/",root));
  const available=disk.bavail*disk.bsize;
  console.log({compressedBytes:preflight.compressedBytes,availableBytes:available,peakBudgetBytes:preflight.approvedPeakBudgetBytes});
  if(available<preflight.approvedPeakBudgetBytes)throw new Error("Insufficient free space for the approved peak budget");
  if(process.argv.includes("--restart-partial")&&await exists(part))await unlink(part);
  const prior=(await exists(part))?.size||0;
  const response=await fetch(preflight.sourceUrl,{headers:{"User-Agent":"HousifyResearch/0.1.0 (https://github.com/ShreyRoy/housify)",...(prior?{Range:`bytes=${prior}-`}:{})},signal:AbortSignal.timeout(30*60*1000)});
  if(!response.ok)throw new Error(`Archive HTTP ${response.status}`);
  if(prior&&(response.status!==206||!response.headers.get("Content-Range")?.startsWith(`bytes ${prior}-`))){await response.body?.cancel();throw new Error("Server did not honor resume. Use --restart-partial explicitly to restart the download.");}
  const handle=await open(part,prior?"a":"wx");let bytes=prior,lastLog=0;
  const reader=response.body!.getReader();
  try{
    while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>preflight.compressedBytes)throw new Error("Archive exceeded approved exact byte count");await handle.writeFile(value);
      if(Date.now()-lastLog>10000){console.log({downloadedBytes:bytes,totalBytes:preflight.compressedBytes});lastLog=Date.now();}}
    await handle.sync();
  }finally{await reader.cancel();await handle.close();}
  if(bytes!==preflight.compressedBytes)throw new Error("Incomplete archive; .part retained for deliberate retry");
}
const verificationTarget=await exists(artifact)?artifact:part;
if((await stat(verificationTarget)).size!==preflight.compressedBytes)throw new Error("Archive size differs from fixed snapshot");
const hash=createHash("sha256");for await(const chunk of createReadStream(verificationTarget))hash.update(chunk);
const actual=hash.digest("hex");if(actual!==expected)throw new Error("Official SHA-256 mismatch; archive must not be imported");
if(verificationTarget===part)await rename(part,artifact);
const result={archive:"discogs_20261101_releases.xml.gz",bytes:preflight.compressedBytes,sha256:actual,officialSha256:expected,verified:true};
await writeFile(new URL("./verification.json",root),JSON.stringify(result,null,2));console.log(result);
