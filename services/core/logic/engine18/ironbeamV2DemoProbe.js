// Read-only Ironbeam v2 DEMO authentication/market data probe.
// Never store, print or return tokens, credentials, or market-data payloads.
// V2 demo endpoint documented at https://demo.ironbeamapi.com/v2/auth
const ALLOWED_HOST="https://demo.ironbeamapi.com";
const ES_SYMBOL="XCME:ES.Z26";
const TIMEOUT=8000;
function errorCode(e) {
  if(e?.name==="TimeoutError"||e?.name==="AbortError") return "TIMEOUT";
  return "REQUEST_FAILED";
}
async function safeRequest(fetchImpl,url,options) {
  try {
    const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(TIMEOUT)});
    let body=null;
    try{body=await response.json();}catch{}
    return {status:response.status,ok:response.ok,body};
  } catch(error) {return {status:null,ok:false,body:null,networkError:errorCode(error)};}
}
export async function probeIronbeamV2Demo({
  username,password,apikey,fetchImpl=fetch,baseUrl=ALLOWED_HOST,
  includeMarketData=true
}={}) {
  if(baseUrl!==ALLOWED_HOST) throw Error("ENGINE18_DEMO_HOST_NOT_ALLOWED");
  if(!username||!password||!apikey) return {connected:false,phase:"CONFIGURATION",reason:"DEMO_CREDENTIALS_MISSING"};
  const result={provider:"IRONBEAM",apiVersion:"v2",environment:"DEMO",symbol:ES_SYMBOL,
    connected:false,readOnly:true,noExecution:true,checks:{},testedAt:new Date().toISOString()};
  const login=await safeRequest(fetchImpl,baseUrl+"/v2/auth",{
    method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({username,password,apikey})
  });
  result.checks.login={httpStatus:login.status,ok:login.ok&&login.body?.status==="OK"&&!!login.body?.token,
    reason:login.networkError||null};
  if(!result.checks.login.ok) {result.phase="AUTHENTICATION";return result;}
  result.connected=true;result.phase="AUTHENTICATED";
  if(!includeMarketData) return result;
  const auth={Authorization:`Bearer ${login.body.token}`,Accept:"application/json"};
  // V2 read-only quote/depth snapshots. Missing rows are NOT considered market-data proof;
  // account may be delayed, unentitled or warming up.
  const endpoints=[
    ["quotes",baseUrl+"/v2/market/quotes?symbols="+encodeURIComponent(ES_SYMBOL)],
    ["depth",baseUrl+"/v2/market/depth?symbols="+encodeURIComponent(ES_SYMBOL)]
  ];
  for(const [name,url] of endpoints) {
    const response=await safeRequest(fetchImpl,url,{method:"GET",headers:auth});
    result.checks[name]={httpStatus:response.status,ok:response.ok&&response.body?.status==="OK",
      hasMarketDataRows:name==="quotes"
        ?(Array.isArray(response.body?.Quotes)&&response.body.Quotes.length>0)
        :(Array.isArray(response.body?.Depths)&&response.body.Depths.length>0),
      reason:response.networkError||null};
  }
  result.phase="DEMO_MARKET_DATA_PROBED";
  result.liveEntitlementConfirmed=false;
  result.mboConfirmed=false;
  return result;
}
