const url="https://frye-market-backend-1.onrender.com/api/v1/dashboard-snapshot?symbol=ES";
const response=await fetch(url,{signal:AbortSignal.timeout(18000)});
if(!response.ok)throw Error("LIVE_SNAPSHOT_HTTP_"+response.status);
const data=await response.json();
const node=data?.engine27Strategies;
const registry=node?.engine27SevenInvalidations;
const cards=node?.engine27WorkingSevenDegrees?.degrees;
const degrees=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const output={snapshotTime:data?.snapshotTime??data?.builtAt??null,
  registrySchema:registry?.schema??null,publishedCount:registry?.publishedCount??null,
  degrees:Object.fromEntries(degrees.map(d=>{
    const x=registry?.degrees?.[d],c=cards?.[d]?.invalidation;
    return [d,{status:x?.status??"UNAVAILABLE",price:x?.price??null,
      rule:x?.rule??null,breached:x?.breached??null,
      source:x?.provenance?.path??null,modelVersion:x?.provenance?.modelVersion??null,
      cardPrice:c?.price??null}];
  }))};
console.log("ENGINE27_LIVE_INVALIDATION_AUDIT "+JSON.stringify(output));
if(!registry)process.exitCode=2;
