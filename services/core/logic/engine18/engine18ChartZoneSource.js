// Fetch EXACT ES route used by the LIVE chart + independently check current GitHub text blob.
// This will fail closed when deployed chart data lags canonical repository source.
// No chart writes, no market feed, no keys in logs.
const CHART_URL='https://frye-market-backend-1.onrender.com/api/v1/es-smz-levels?symbol=ES';
const CANONICAL_URL='https://api.github.com/repos/bfrye1973/frye-market-backend/contents/services/core/data/es-smz-manual-zones.txt?ref=main';
export function makeEngine18ChartZoneFetcher({fetchImpl=fetch,chartUrl=CHART_URL,
 canonicalUrl=CANONICAL_URL}={}){
 if(typeof fetchImpl!=='function'||chartUrl!==CHART_URL||canonicalUrl!==CANONICAL_URL)
  throw Error('UNTRUSTED_CHART_ZONE_SOURCE');
 return async function fetchChartZoneSource({timeoutMs=8000}={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const [chart,canonical]=await Promise.all([
    fetchImpl(chartUrl+'&_='+Date.now(),{method:'GET',cache:'no-store',
     headers:{Accept:'application/json'},signal:controller.signal,redirect:'error'}),
    fetchImpl(canonicalUrl,{method:'GET',cache:'no-store',
     headers:{Accept:'application/vnd.github+json'},signal:controller.signal,redirect:'error'})
   ]);
   if(!chart.ok||!canonical.ok)throw Error('CHART_OR_CANONICAL_SOURCE_UNAVAILABLE');
   const [a,b]=await Promise.all([chart.json(),canonical.json()]);
   if(typeof b.sha!=='string'||!/^[a-f0-9]{40}$/.test(b.sha)||
    a?.meta?.sourceGitBlobSha!==b.sha)
    throw Error('CHART_DEPLOYED_REVISION_STALE');
   return a;
  }finally{clearTimeout(timeout);}
 };
}
