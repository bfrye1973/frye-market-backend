// High-resolution receipt estimate calibrated from host wall clock and monotonic time.
// Wall-clock accuracy is UNVERIFIED unless independent trusted Chrony/PTP samples exist.
// Never assign vendor/exchange timestamps here.
export function createEngine18ReceiptClock({wallMs=()=>Date.now(),monotonicNs=()=>process.hrtime.bigint(),reanchorMs=1000}={}){
 if(typeof wallMs!=='function'||typeof monotonicNs!=='function'||!Number.isSafeInteger(reanchorMs)||reanchorMs<1)throw Error('invalid receipt clock');
 let anchorWall=BigInt(Math.trunc(wallMs()))*1000000n,anchorMono=BigInt(monotonicNs());
 let lastMono=anchorMono,lastWall=anchorWall,anchorUpdates=0;
 function capture(){
  const mono=BigInt(monotonicNs()),delta=mono-anchorMono;
  if(mono<lastMono||delta<0n)throw Error('monotonic clock regression');
  let estimated=anchorWall+delta;
  if(delta>BigInt(reanchorMs)*1000000n){
   // A recalibration can reveal clock steps. Never rewrite earlier receipts.
   const currentWall=BigInt(Math.trunc(wallMs()))*1000000n;
   if(currentWall>estimated)estimated=currentWall;
   anchorWall=estimated;anchorMono=mono;anchorUpdates++;
  }
  if(estimated<lastWall)estimated=lastWall;
  lastMono=mono;lastWall=estimated;
  return Object.freeze({receivedWallNs:String(estimated),receivedMonoNs:String(mono),
   receiptTimeSource:'HOST_WALL_ANCHORED_MONOTONIC',receiptPrecision:'SUBMILLISECOND_ESTIMATE',
   clockQuality:'UNVERIFIED'});
 }
 return Object.freeze({capture,wallNs:()=>capture().receivedWallNs,
  monoNs:()=>String(monotonicNs()),
  diagnostics:()=>Object.freeze({schema:'engine18.clock.estimate.v1',source:'HOST_WALL_ANCHORED_MONOTONIC',
   precision:'SUBMILLISECOND_ESTIMATE',quality:'UNVERIFIED',anchorUpdates})});
}
