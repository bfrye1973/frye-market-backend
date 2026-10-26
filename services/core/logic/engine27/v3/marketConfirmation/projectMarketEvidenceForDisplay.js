// Engine27 V3 Micro presentation-only projection of owner-published market evidence.
// Do NOT promote an unqualified source to a confirmation. No owner calculations.
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const present=x=>x!==null&&x!==undefined;
const str=x=>typeof x==="string"&&x.trim()?x:null;
const first=(...v)=>v.find(present)??null;
export function projectMarketEvidenceForDisplay({engine25Dashboard=null,engine29Response=null,ownerMarket=null}={}){
 const p=engine25Dashboard?.participationArtifact;
 const canonical=p?.schema==="engine25.participation@1"&&p?.authority?.owner==="ENGINE25"&&
  p?.participation&&typeof p.participation==="object";
 const freshness=canonical?p.freshness:null;
 const coverage=first(p?.participation?.stockVolume?.intraday?.coveragePct,
  p?.participation?.stockVolume?.coveragePct,
  p?.sourceDiagnostics?.intraday?.stockVolume?.coveragePct);
 const breadth=p?.participation?.breadth;
 const sector=p?.participation?.sectorParticipation?.intraday;
 const engine29=engine29Response?.ok===true&&engine29Response?.data&&typeof engine29Response.data==="object"?
  engine29Response.data:null;
 const n29=engine29;
 const reasonCodes=Array.isArray(ownerMarket?.reasonCodes)?ownerMarket.reasonCodes:[];
 return {
  schema:"engine27.v3.microMarketEvidenceDisplay.v1",presentationOnly:true,noExecution:true,
  engine25:{
   sourcePresent:!!canonical,contextAvailable:!!canonical||ownerMarket?.engine25!==null&&present(ownerMarket?.engine25),
   participationFreshness:str(freshness?.state)??"UNAVAILABLE",
   participationReason:str(freshness?.reason),
   liveConfirmationQualified:ownerMarket?.participationState?.liveConfirmationUsable===true,
   breadth:canonical?{score:finite(breadth?.score)?breadth.score:null,
     label:str(breadth?.label)}:null,
   sectors:canonical?{bullish:finite(sector?.bullishCount)?sector.bullishCount:null,
     neutral:finite(sector?.neutralCount)?sector.neutralCount:null,
     bearish:finite(sector?.bearishCount)?sector.bearishCount:null}:null,
   volumeCoveragePct:finite(coverage)?coverage:null,
   equitySession:str(freshness?.equityScannerSession?.session)??null,
   esRegime:str(ownerMarket?.engine25?.regime)??null
  },
  engine29:{
   sourcePresent:!!n29,
   overallState:str(n29?.overallState),
   tacticalState:str(n29?.tacticalState),
   fastTacticalState:str(n29?.fastTacticalState),
   moveCharacter:str(n29?.moveCharacter?.moveCharacter),
   liquidity:str(n29?.marketCharacter?.liquidity?.state),
   dataDegraded:n29?.dataDegraded===true,
   qualified:!!ownerMarket?.engine29,
   missingConfirmations:Array.isArray(n29?.missingConfirmations)?n29.missingConfirmations.filter(str).slice(0,8):[],
   reason:reasonCodes.find(x=>x.startsWith("ENGINE29_"))??null
  }
 };
}
