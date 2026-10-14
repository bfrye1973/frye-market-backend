// Engine22 isolated owner-coordinate comparison, RESEARCH ONLY.
// Do not import this module into runtime, strategy snapshots, or frontends.
// These anchor values are original owner All Nodes evidence, not approved Fib geometry.
export const SUBMINUTE_OWNER_EVIDENCE_V1 = Object.freeze({
  source: "OWNER_WORKBOOK_ALL_NODES",
  sourceIds: Object.freeze(["WB-ALL-012", "WB-ALL-013", "WB-ALL-014"]),
  w1Low: 7616.25,
  w1High: 7847.00,
  w2Low: 7673.25,
});
export const SUBMINUTE_LEGACY_PROVISIONAL_V1 = Object.freeze({
  source: "LEGACY_PROVISIONAL_NOT_OFFICIAL",
  w1Low: 7575.00,
  w1High: 7859.25,
  w2Low: 7671.50,
});
const ratios = Object.freeze([["e0382",0.382],["e0500",0.5],["e0618",0.618],
  ["e1000",1],["e1272",1.272],["e1618",1.618],["e2000",2]]);
const tick = n => Math.round(n * 4) / 4;
export function compareSubminuteCandidateFibsV1() {
  const project = anchors => ratios.map(([key,ratio])=>({
    key, ratio, price:tick(anchors.w2Low + (anchors.w1High - anchors.w1Low)*ratio),
    status:"RESEARCH_ONLY_NOT_APPROVED",
  }));
  const owner = project(SUBMINUTE_OWNER_EVIDENCE_V1);
  const legacy = project(SUBMINUTE_LEGACY_PROVISIONAL_V1);
  return {
    schema:"engine22.subminuteFibComparisonResearch.v1",
    publishAuthorized:false, officialFibAuthorityChanged:false,
    touchEvidenceAvailable:false, noExecution:true,
    ownerSourceIds:SUBMINUTE_OWNER_EVIDENCE_V1.sourceIds,
    owner,legacy,
    differences:owner.map((level,i)=>({
      key:level.key,ownerCandidate:level.price,legacyProvisional:legacy[i].price,
      difference:+(level.price-legacy[i].price).toFixed(2),
    })),
  };
}
