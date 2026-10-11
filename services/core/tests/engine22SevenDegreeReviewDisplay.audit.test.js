import test from "node:test";
import assert from "node:assert/strict";
import {buildSevenDegreeReviewDisplay} from "../logic/engine22/migration/buildSevenDegreeReviewDisplay.js";
import {buildOwnerAuthorizedProvisionalMicroCount} from "../logic/engine22/migration/buildOwnerAuthorizedProvisionalMicroCount.js";
import {createCanonicalMicroState} from "../logic/engine22/microV2/canonicalMicroState.js";
import {buildSubmicroMigrationCandidate} from "../logic/engine22/migration/buildSubmicroMigrationCandidate.js";
import {buildSevenDegreeShadowProjection} from "../logic/engine22/migration/buildSevenDegreeShadowProjection.js";
test("chart display shows distinct manager-anchored Micro and source-preserved Submicro",()=>{
 const m=buildOwnerAuthorizedProvisionalMicroCount({ownerAcceptsOverlap:true}).count;
 const old=createCanonicalMicroState({countId:"ORIGINAL",sequenceId:"ORIGINAL-SEQ",
  sequenceDirection:"UP",origin:{price:7782.75}});
 const sub=buildSubmicroMigrationCandidate({sourceMicroState:old,parentMicroCountId:m.countId}).candidate;
 const shadow=buildSevenDegreeShadowProjection({legacyDegreeStates:{minute:{activeWave:"W3"}},microCount:m,submicroCandidate:sub});
 const legacy={version:"engine22Display.v1",degrees:{minute:{label:"Minute",active:true,headline:"Preserved"},primary:{headline:"Primary"}}};
 const d=buildSevenDegreeReviewDisplay({legacyDisplay:legacy,shadow});
 assert.equal(d.degrees.micro.label,"Micro");
 assert.equal(d.degrees.micro.badge,"W5 REVIEW");
 assert.equal(d.degrees.micro.rows.find(r=>r.label==="W1 high").value.startsWith("7805.00"),true);
 assert.equal(d.degrees.submicro.rows.find(r=>r.label==="Source ID").value,"ORIGINAL");
 assert.equal(d.degrees.minute,legacy.degrees.minute);
 assert.equal(d.degrees.micro.active,false);
 assert.equal(d.degrees.submicro.active,false);
 assert.equal(d.flags.noExecution,true);
 assert.equal(legacy.degrees.micro,undefined);
});
test("no complete distinct shadow means no rewritten chart count",()=>{
 const legacy={version:"engine22Display.v1",degrees:{micro:{headline:"Legacy micro"}}};
 assert.equal(buildSevenDegreeReviewDisplay({legacyDisplay:legacy,shadow:{status:"INCOMPLETE"}}),legacy);
});
