import ownerChartAnchors from "./ownerChartAnchors20261031.json" with {type:"json"};
import { createHash } from "node:crypto";

const DEGREE_ORDER = ["submicro", "micro", "subminute", "minute", "minor", "intermediate", "primary"];
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy = value => value == null ? null : structuredClone(value);
const anchor = (id, label, price, localTime, sourcePath, status = "OWNER_MARKED") => ({
  anchorId: id, waveLabel: label, price: typeof price === "number" && Number.isFinite(price) ? price : null,
  localTime: localTime || null, timezone: localTime ? "America/Phoenix" : null,
  marketEventTimeUtc: localTime && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(localTime)
    ? new Date(localTime.replace(" ", "T") + "-07:00").toISOString() : null,
  timestampStatus: localTime ? "OWNER_MARKED_NOT_EXCHANGE_VERIFIED" : "UNVERIFIED",
  verificationStatus: status, sourcePath, sourcePriceBasis: null
});
const group = (id, levels, sourcePath) => ({ groupId:id, sourcePath, levels:copy(Array.isArray(levels) ? levels : []) });
const base = (degree, selected) => ({
  degree, available: selected?.available === true, sourcePath:selected?.sourcePath || null,
  modelVersion:selected?.modelVersion || null, modelFingerprint:selected?.modelFingerprint || null,
  activeWave:selected?.activeWave || null, direction:selected?.direction || null,
  lifecycleStatus:selected?.stage || null, parentDegree:selected?.parentDegree || null,
  parentWave:selected?.parentWave || null, completionConfirmed:false,
  anchors:[], fibGroups:[], scenarios:[],
  reviewBoundary:copy(selected?.review), officialInvalidation:copy(selected?.officialInvalidation),
  missingEvidence:[]
});
function readPath(root,path) {
  if (!path || !/^(currentWavelength|degreeStates)\.[A-Za-z0-9_.]+$/.test(path)) return null;
  return path.split(".").reduce((v,k)=>v?.[k],root) ?? null;
}
export function buildEngine22ChartAnchorsV1({currentWavelength,authorizedWorkingStructure,sevenDegreeInvalidations,metadata={}}={}) {
  const authorityValid=authorizedWorkingStructure?.schema==="engine22.authorizedWorkingStructure.v1" && authorizedWorkingStructure?.mode==="READ_ONLY";
  const selected=authorityValid ? authorizedWorkingStructure.degrees : {};
  const degrees={};
  for (const degree of DEGREE_ORDER) {
    const s=selected[degree], d=base(degree,s);
    const model=readPath({currentWavelength,degreeStates:metadata.degreeStates},s?.sourcePath);
    if (!d.available || !model || (s.modelVersion && model.version !== s.modelVersion) || (s.sourcePath && !s.sourcePath.endsWith("."+degree) && model.activeWave!==s.activeWave)) {
      d.available=false; d.missingEvidence.push("CURRENT_AUTHORIZED_MODEL_UNAVAILABLE");
      degrees[degree]=d; continue;
    }
    d.fibGroups.push(group("SELECTED",model.levels,s.sourcePath+".levels"));
    if (degree==="micro" || degree==="subminute" || degree==="minute") d.reviewBoundary={price:degree==="micro"?model.priorBEnding?.price:degree==="subminute"?model.priorBEnding?.price:model.structuralReference,reviewOnly:true,sourcePath:degree==="minute"?s.sourcePath+".structuralReference":s.sourcePath+".priorBEnding.price"};
    if (degree==="micro") {
      const p=s.sourcePath;
      d.anchors=[
        anchor("A_HIGH","A_HIGH",model.waveA?.startHigh,model.waveA?.startLocalTime,p+".waveA.startHigh"),
        anchor("A_LOW","A_LOW",model.waveA?.low,model.waveA?.endLocalTime,p+".waveA.low"),
        anchor("B_HIGH","B_HIGH",model.priorBEnding?.price,model.priorBEnding?.localTime,p+".priorBEnding.price")
      ];
    } else if (degree==="subminute") {
      const p=s.sourcePath;
      d.fibGroups=[];
      for(const method of ["wick","body"]) {
        const ref=model.fibReferences?.[method];
        if(ref) d.fibGroups.push(group(method.toUpperCase(),ref.levels,p+".fibReferences."+method+".levels"));
        else d.missingEvidence.push("MISSING_"+method.toUpperCase()+"_FIB_REFERENCE");
      }
      d.anchors=[
        anchor("A_HIGH","A_HIGH",model.waveA?.startHigh,model.waveA?.startLocalTime,p+".waveA.startHigh"),
        anchor("A_WICK_LOW","A_WICK_LOW",model.waveA?.wickLow,model.waveA?.endLocalTime,p+".waveA.wickLow"),
        anchor("A_BODY_REFERENCE","A_BODY_REFERENCE",model.waveA?.bodyReferenceLow,model.waveA?.endLocalTime,p+".waveA.bodyReferenceLow","OWNER_BODY_REFERENCE"),
        anchor("B_HIGH","B_HIGH",model.priorBEnding?.price,null,p+".priorBEnding.price"),
      ];
      d.missingEvidence.push("B_HIGH_TIME_UNVERIFIED","ANCHOR_PRICE_BASIS_UNVERIFIED");
    } else if (degree==="submicro") {
      d.fibGroups=[];
      for(const [id,key] of [["OPTION_1_ABC_C_DOWN","option1"],["OPTION_2_A_DOWN_B_UP_PENDING","option2"]]) {
        const scenario=model[key];
        if (!scenario) {d.missingEvidence.push("MISSING_"+key.toUpperCase());continue;}
        const p=s.sourcePath+"."+key;
        const anchors=key==="option1" ? [
          anchor("A_HIGH","A_HIGH",scenario.startHigh,null,p+".startHigh"),
          anchor("A_LOW","A_LOW",scenario.waveALow,null,p+".waveALow"),
          anchor("B_HIGH","B_HIGH",scenario.waveBHigh,null,p+".waveBHigh")
        ] : [
          anchor("A_HIGH","A_HIGH",scenario.startHigh,null,p+".startHigh"),
          anchor("A_LOW_CANDIDATE","A_LOW_CANDIDATE",scenario.candidateALow,null,p+".candidateALow")
        ];
        d.scenarios.push({scenarioId:id,label:scenario.label,anchors,
          fibGroups:[group(id,scenario.levels,p+".levels")],
          lifecycleStatus:key==="option1"?scenario.waveCStatus:scenario.waveAStatus,
          completionConfirmed:false,reviewBoundary:key==="option1" ? {price:scenario.reviewPrice,reviewOnly:true}:null,
          officialInvalidation:null,missingEvidence:["ANCHOR_EVENT_TIMESTAMPS_UNVERIFIED"]});
      }
    } else if (degree==="minute") {
      const a=model.anchors || {},p=s.sourcePath+".anchors";
      d.anchors=[
        anchor("W1_LOW","W1_LOW",a.w1Low,(a.w1LowLocalTime || a.w1LowTime),p+".w1Low"),
        anchor("W1_HIGH","W1_HIGH",a.w1High,(a.w1HighLocalTime || a.w1HighTime),p+".w1High"),
        anchor("W2_END","W2_END",null,null,p+".w2End","NOT_CONFIRMED")
      ];
      d.missingEvidence.push("W2_END_NOT_CONFIRMED");
    } else {
      d.missingEvidence.push("COMPLETE_HIGHER_DEGREE_PIVOT_SEQUENCE_UNAVAILABLE");
    }
    if(d.scenarios.some(s=>s.missingEvidence.length)) d.missingEvidence.push("SCENARIO_ANCHOR_TIMESTAMPS_UNVERIFIED");
    if(d.anchors.some(a=>a.price!=null&&!a.marketEventTimeUtc)) d.missingEvidence.push("ANCHOR_EVENT_TIMESTAMPS_UNVERIFIED");
    degrees[degree]=d;
  }
  const available=DEGREE_ORDER.some(degree=>degrees[degree].available);
  const core={schema:"engine22.chartAnchors.v1",authority:"ENGINE22",mode:"READ_ONLY",
    available,reasonCodes:available?[]:["CURRENT_AUTHORIZED_STRUCTURE_UNAVAILABLE"],
    plotAllowed:false,plotReasonCodes:["ANCHOR_PRICE_BASIS_UNVERIFIED"],
    selectionRevision:authorizedWorkingStructure?.publicationRevision??null,
    selectionApprovalReference:authorizedWorkingStructure?.selectionApprovalReference??null,
    modelFingerprint:authorizedWorkingStructure?.modelFingerprint??null,
    evidenceFingerprint:authorizedWorkingStructure?.evidenceFingerprint??null,
    publishedAtUtc:authorizedWorkingStructure?.publishedAt??null,
    symbol:currentWavelength?.symbol || "ES",contractId:null,priceBasis:"UNVERIFIED",
    chartCompatibility:"WITHHELD_PENDING_VERIFICATION",
    priceBasisIds:copy(metadata.priceBasisIds)||null,
    degrees,
    ownerResearchChart:{
      schema:"engine22.ownerResearchChart.v1",
      authority:ownerChartAnchors.authority,
      source:ownerChartAnchors.source,
      timezone:ownerChartAnchors.timezone,
      anchors:ownerChartAnchors.anchors.map(a=>({
        ...a,marketEventTimeUtc:new Date(a.date+"T"+a.time+":00-07:00").toISOString(),
        ownerSupplied:true,verifiedCandleMatch:false
      })),
      fibByDegree:Object.fromEntries(DEGREE_ORDER.map(degree=>[degree,{
        sourceModelPath:degrees[degree]?.sourcePath??null,
        fibGroups:copy(degrees[degree]?.fibGroups??[]),
        scenarios:degree==="submicro"?copy(degrees[degree]?.scenarios?.map(s=>({scenarioId:s.scenarioId,fibGroups:s.fibGroups}))??[]):[],
        levelsFromExistingEngine22:true,
        ownerAnchorModelReconciled:false
      }])),
      displayAuthority:"OWNER_RESEARCH_ONLY",
      requiresSeparateResearchDisplayAuthorization:true,
      verifiedPriceBasis:false,noExecution:true
    },
    historicalAsOfSupported:false,noExecution:true};
  return {...core,chartContractFingerprint:hash(core)};
}
