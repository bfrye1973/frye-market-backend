import {readAuthorizedWorkingStructure} from "../engine22/readAuthorizedWorkingStructure.js";
import {ALIGNMENT_SCHEMA} from '../contracts/neighboringAlignment.v1.js';
export function evaluateNeighboringAlignment({snapshot=null}={}) {
 const a=readAuthorizedWorkingStructure(snapshot);
 const base={schema:ALIGNMENT_SCHEMA,degree:"micro",mode:"READ_ONLY",available:false,state:"UNAVAILABLE",neighbors:{submicro:null,subminute:null},micro:null,structuralConflictConfirmed:false,reasonCodes:[],noPermissionCreated:true,noExecution:true,noJournalWrite:true};
 if(!a.available)return {...base,reasonCodes:[a.reasonCode]};
 const d=a.publication.degrees;
 const normalize=(degree)=>({degree,version:d[degree].modelVersion,activeWave:d[degree].activeWave,direction:d[degree].direction,parentDegree:d[degree].parentDegree,parentWave:d[degree].parentWave,stage:d[degree].stage,confirmationStatus:d[degree].completionConfirmed===true?"CONFIRMED":"NOT_CONFIRMED"});
 const micro=normalize("micro"),left=normalize("submicro"),right=normalize("subminute");
 const mixed=left.direction!==micro.direction||right.direction!==micro.direction;
 return {...base,available:true,micro,neighbors:{submicro:left,subminute:right},state:mixed?"CORRECTIVE_MIXED_DIRECTION":"STRUCTURALLY_COMPATIBLE",reasonCodes:mixed?["MIXED_DIRECTIONS_DO_NOT_PROVE_INVALIDATION"]:["OWNER_PARENT_LINKS_COMPATIBLE"]};
}
