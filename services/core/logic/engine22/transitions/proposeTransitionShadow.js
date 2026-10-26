// Engine22G: observational count-transition proposals only, no approval authority added.
import {evaluateEngine22V3WaveTransition} from "../v3/evaluateWaveTransition.js";
export function proposeEngine22TransitionShadow({degreeState=null,evidence=null}={}){
 const result=evaluateEngine22V3WaveTransition({degreeState,evidence});
 return {schema:"engine22.transitionProposalShadow.v1",available:result.ok===true,
   countId:degreeState?.countId??null,degreeId:degreeState?.degreeId??null,
   reasonCodes:result.reasonCodes??[],
   proposedLifecycle:result.proposal?.lifecycle??null,
   proposedNextWave:result.advanceProposed?result.proposal?.activeWave??null:null,
   requiresEngine22GApproval:result.advanceProposed===true,
   activationAuthorized:false,publishAuthorized:false,
   noExecution:true,noPermissionCreated:true,shadowOnly:true};
}
