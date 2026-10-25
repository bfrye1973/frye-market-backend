import {ALIGNMENT_SCHEMA} from '../contracts/neighboringAlignment.v1.js';
const DEGREE_PATHS={submicro:['submicro','ownerSubmicroCDown','engine22.submicroCDownOwnerWatch.v1'],micro:['micro','ownerMicroCDown','engine22.microCDownOwnerWatch.v1'],subminute:['subminute','ownerCurrentCDown','engine22.subminuteCurrentCDownReference.v1']};
function read(root,degree){const [node,key,version]=DEGREE_PATHS[degree];const m=root?.degrees?.[node]?.[key];if(m?.version!==version||!['UP','DOWN'].includes(m?.direction)||!m?.activeWave)return null;return {degree,version:m.version,activeWave:m.activeWave,direction:m.direction,parentDegree:m.parentDegree??null,parentWave:m.parentWave??null,stage:m.stage??null,confirmationStatus:m.confirmationStatus??null};}
export function evaluateNeighboringAlignment({snapshot=null}={}){
 const base={schema:ALIGNMENT_SCHEMA,degree:'micro',mode:'READ_ONLY',available:false,state:'UNAVAILABLE',neighbors:{submicro:null,subminute:null},micro:null,structuralConflictConfirmed:false,reasonCodes:[],noPermissionCreated:true,noExecution:true,noJournalWrite:true};
 if(snapshot?.symbol!=='ES')return {...base,reasonCodes:['ES_SOURCE_IDENTITY_MISMATCH']};
 const cw=snapshot?.strategies?.['intraday_scalp@10m']?.engine22WaveStrategy?.currentWavelength;
 const m=read(cw,'micro'),left=read(cw,'submicro'),right=read(cw,'subminute');
 if(!m)return {...base,reasonCodes:['CURRENT_MICRO_OWNER_UNAVAILABLE']};
 const neighbors={submicro:left,subminute:right};
 if(!left||!right)return {...base,available:true,micro:m,neighbors,state:'NEIGHBOR_EVIDENCE_INCOMPLETE',reasonCodes:[!left?'SUBMICRO_OWNER_UNAVAILABLE':'SUBMINUTE_OWNER_UNAVAILABLE']};
 // Explicit owner parent links establish structural nesting. Opposite direction alone NEVER invalidates the count.
 const linksOk=m.parentDegree==='subminute'&&left.parentDegree==='micro'&&right.parentDegree==='minute'&&
  (m.parentWave===null||m.parentWave===right.activeWave)&&(left.parentWave===null||left.parentWave===m.activeWave);
 if(!linksOk)return {...base,available:true,micro:m,neighbors,state:'PARENT_IDENTITY_CONFLICT',reasonCodes:['OWNER_PARENT_WAVE_MISMATCH'],structuralConflictConfirmed:false};
 const mixed=left.direction!==m.direction||right.direction!==m.direction;
 return {...base,available:true,micro:m,neighbors,state:mixed?'CORRECTIVE_MIXED_DIRECTION':'STRUCTURALLY_COMPATIBLE',reasonCodes:mixed?['MIXED_DIRECTIONS_DO_NOT_PROVE_INVALIDATION']:['OWNER_PARENT_LINKS_COMPATIBLE']};
}
