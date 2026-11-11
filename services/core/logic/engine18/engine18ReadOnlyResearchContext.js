// Gate1 research preparation only: read-only snapshots of existing ES sources.
// No new Elliott Wave, Fibonacci, institutional levels, or book liquidity.
const copy=obj=>structuredClone(obj);
const frozen=(obj)=>Object.freeze(obj);
function isAvailableAt(value,asOf){
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return false;
 if(asOf===null)return true;
 return typeof asOf==='string'&&Number.isFinite(Date.parse(asOf))&&
  Date.parse(value)<=Date.parse(asOf);
}
export function buildEngine18ReadOnlyContext({
 institutionalResponse,strategySnapshot,
 symbol='ES',physicalContract='XCME:ES.Z26',priceBasisStatus='UNVERIFIED',
 institutionalAvailableAt=null,strategyAvailableAt=null,
 asOfTime=null
}={}){
 if(symbol!=='ES'||physicalContract!=='XCME:ES.Z26')throw Error('ES source/physical contract required');
 const structures=institutionalResponse?.structures_sticky;
 const wave=strategySnapshot?.strategies?.['intraday_scalp@10m']?.engine22WaveStrategy;
 const degrees=wave?.currentWavelength?.degrees;
 const sourceStatus={
  institutional:!Array.isArray(structures)?'UNAVAILABLE':isAvailableAt(institutionalAvailableAt,asOfTime)?'AVAILABLE':'POINT_IN_TIME_UNVERIFIED',
  strategies:!degrees?.micro||!degrees?.submicro?'UNAVAILABLE':isAvailableAt(strategyAvailableAt,asOfTime)?'AVAILABLE':'POINT_IN_TIME_UNVERIFIED',
  priceBasis:priceBasisStatus==='MATCHED'?'MATCHED':'UNVERIFIED'
 };
 const allowed=sourceStatus.institutional==='AVAILABLE'&&sourceStatus.strategies==='AVAILABLE'&&
  sourceStatus.priceBasis==='MATCHED';
 const packet={
  schema:'engine18.context.readonly.v1',symbol,physicalContract,
  asOfTime:asOfTime??null,sourceStatus:frozen({...sourceStatus}),
  institutionalAvailableAt:institutionalAvailableAt??null,
  strategyAvailableAt:strategyAvailableAt??null,
  // These are exact source-published snapshots; NEVER substitute computed waves.
  institutionalZones:Array.isArray(structures)?copy(structures):null,
  micro:degrees?.micro?copy(degrees.micro):null,
  submicro:degrees?.submicro?copy(degrees.submicro):null,
  strategyFingerprint:wave?.fingerprint??null,
  workingWaveNodes:wave?.workingWaveNodes?copy(wave.workingWaveNodes):null,
  usableForChronologicalResearch:allowed,
  bookLiquidity:null, // real order-book evidence is independent and not available yet
  permission:'READ_ONLY_RESEARCH'
 };
 return frozen(packet);
}
