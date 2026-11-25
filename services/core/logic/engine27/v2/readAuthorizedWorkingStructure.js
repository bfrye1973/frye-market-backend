// Engine 22 is the sole source of current Elliott wave model authority.
// An absent or partial publication never licenses fallback to legacy owner objects.
export const AUTHORIZED_SCHEMA = "engine22.authorizedWorkingStructure.v1";
export const DEGREE_ORDER = Object.freeze(["submicro","micro","subminute","minute","minor","intermediate","primary"]);
export function readAuthorizedWorkingStructure(snapshot) {
  const p=snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy?.authorizedWorkingStructure;
  if (snapshot?.symbol!=="ES" || p?.schema!==AUTHORIZED_SCHEMA || p?.mode!=="READ_ONLY" ||
      p?.status!=="COMPLETE_WORKING_SELECTION" || p?.noExecution!==true || p?.noWaveTransition!==true ||
      typeof p?.modelFingerprint!=="string" || !/^[0-9a-f]{64}$/.test(p.modelFingerprint) ||
      !p.degrees || typeof p.degrees!=="object")
    return {available:false,publication:null,reasonCode:"ENGINE22_AUTHORIZED_PUBLICATION_UNAVAILABLE"};
  for (const degree of DEGREE_ORDER) {
    const r=p.degrees[degree];
    if (!r || r.available!==true || r.degree!==degree || !r.activeWave || !["UP","DOWN","NEUTRAL"].includes(r.direction) ||
        !r.selectionStatus || (degree==="micro"||degree==="submicro"||degree==="subminute"||degree==="minute") &&
        (r.selectionStatus!=="OWNER_SELECTED_WORKING" || !r.modelVersion || !r.sourcePath))
      return {available:false,publication:null,reasonCode:"ENGINE22_AUTHORIZED_DEGREE_CONFLICT"};
  }
  const m=p.degrees;
  if (m.submicro.parentDegree!=="micro" || m.submicro.parentWave!==m.micro.activeWave ||
      m.micro.parentDegree!=="subminute" || m.micro.parentWave!==m.subminute.activeWave ||
      m.subminute.parentDegree!=="minute" || m.subminute.parentWave!==m.minute.activeWave)
    return {available:false,publication:null,reasonCode:"ENGINE22_AUTHORIZED_PARENT_CONFLICT"};
  return {available:true,publication:p,reasonCode:null};
}
