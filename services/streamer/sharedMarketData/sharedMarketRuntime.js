// Process-scoped single owner per asset class. Importing alone opens NO sockets.
import {createPolygonConnectionOwner} from "./createPolygonConnectionOwner.js";
let stocks=null,indices=null;
const apiKey=()=>process.env.POLYGON_API||process.env.POLYGON_API_KEY||process.env.POLY_API_KEY||"";
export function sharedOwner(assetClass){
 if(!["stocks","indices"].includes(assetClass))throw Error("UNSUPPORTED_ASSET_CLASS");
 if(assetClass==="stocks"){
  if(!stocks)stocks=createPolygonConnectionOwner({assetClass,apiKey:apiKey()});
  return stocks;
 }
 if(!indices)indices=createPolygonConnectionOwner({assetClass,apiKey:apiKey()});
 return indices;
}
export function ownerDiagnostics(){return {stocks:stocks?.status()??{state:"NOT_STARTED",connectionCount:0},
 indices:indices?.status()??{state:"NOT_STARTED",connectionCount:0}}}
