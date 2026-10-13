import { mkdir,writeFile } from 'node:fs/promises';
import { acquireSourceObservations } from '../../../logic/engine11/sourceObservationsV2/provider.js';
const apiKey=process.env.POLYGON_API_KEY;if(!apiKey)throw new Error('Existing credential required');
const evidence=[];
const specs=[
 ['pause_before_change','ESU1','1min','2021-06-25T20:00:00Z','2021-06-25T20:45:00Z'],
 ['pause_after_change','ESU1','1min','2021-06-28T20:00:00Z','2021-06-28T20:45:00Z'],
 ['spring_2020_open','ESH0','1min','2020-03-08T21:45:00Z','2020-03-08T22:15:00Z'],
 ['fall_2020_open','ESZ0','1min','2020-11-01T22:45:00Z','2020-11-01T23:15:00Z'],
 ['maintenance_2026','ESU6','1min','2026-09-10T20:55:00Z','2026-09-10T22:05:00Z'],
 ['2020_conflict_1min','ESH0','1min','2020-03-03T21:00:00Z','2020-03-03T22:00:00Z'],
 ['2020_conflict_5min','ESH0','5min','2020-03-03T21:00:00Z','2020-03-03T22:00:00Z'],
 ['2020_conflict_10min','ESH0','10min','2020-03-03T21:00:00Z','2020-03-03T22:00:00Z'],
 ['2020_conflict_1hour','ESH0','1hour','2020-03-03T21:00:00Z','2020-03-03T22:00:00Z']
];
for(const [name,ticker,resolution,from,to] of specs){
 const request='https://api.massive.com/futures/v1/aggs/'+ticker+'?'+new URLSearchParams({resolution,'window_start.gte':String(BigInt(Date.parse(from))*1000000n),'window_start.lt':String(BigInt(Date.parse(to))*1000000n),limit:'500',sort:'window_start.asc'});
 const acquisition=await acquireSourceObservations({request,apiKey,maxPages:2,maxRows:1000});const rows=acquisition.receipts.flatMap(x=>x.observations.map(y=>y.payload));
 const collisions=rows.filter(x=>rows.some(y=>y!==x && y.window_start===x.window_start && y.session_end_date!==x.session_end_date));
 const result={name,ticker,resolution,from,to,status:acquisition.status,failure:acquisition.failure,
  timestamps:rows.map(x=>x.window_start),sessionLabels:[...new Set(rows.map(x=>x.session_end_date))],collisions,
  originalReceipts:acquisition.receipts,structuralEligible:false,calendarAccepted:false,sourceFinality:'UNKNOWN'};
 evidence.push(result);console.log('CALENDAR_EVIDENCE '+JSON.stringify({...result,originalReceipts:undefined}));
}
const metadata=[];
for(const [label,ticker,date] of [['ESH0-date','ESH0','2020-03-10'],['ESM0-date','ESM0','2020-03-10'],['ESH2020-full-code','ESH2020','2020-03-10'],['ESM2020-full-code','ESM2020','2020-03-10'],['ES-all-product-date',null,'2020-03-10']]){
 const query={product_code:'ES',date,limit:'1000',...(ticker?{ticker}:{})};
 const acquisition=await acquireSourceObservations({request:'https://api.massive.com/futures/v1/contracts?'+new URLSearchParams(query),apiKey,maxPages:1,maxRows:1000});
 const item={label,status:acquisition.status,failure:acquisition.failure,rows:acquisition.rowCount,receipts:acquisition.receipts};metadata.push(item);console.log('CALENDAR_METADATA '+JSON.stringify({...item,receipts:undefined}));
}
const children=evidence.find(x=>x.name==='2020_conflict_1min').originalReceipts.flatMap(x=>x.observations.map(y=>y.payload));
const comparisons=[];
for(const [name,duration] of [['2020_conflict_5min',300000000000n],['2020_conflict_10min',600000000000n],['2020_conflict_1hour',3600000000000n]]){
 const parents=evidence.find(x=>x.name===name).originalReceipts.flatMap(x=>x.observations.map(y=>y.payload));
 for(const parent of parents){const rows=children.filter(x=>x.session_end_date===parent.session_end_date && BigInt(x.window_start)>=BigInt(parent.window_start)&&BigInt(x.window_start)<BigInt(parent.window_start)+duration);
  const a=rows.length?{open:rows[0].open,close:rows.at(-1).close,high:Math.max(...rows.map(x=>x.high)),low:Math.min(...rows.map(x=>x.low)),volume:rows.reduce((s,x)=>s+x.volume,0),transactions:rows.reduce((s,x)=>s+x.transactions,0)}:null;
  comparisons.push({name,parent,childCount:rows.length,aggregate:a,matched:!!a&&Object.keys(a).every(k=>a[k]===parent[k])});
 }
}
console.log('CALENDAR_COMPARISONS '+JSON.stringify(comparisons));
await mkdir('research-evidence',{recursive:true});await writeFile('research-evidence/es-calendar-interval.json',JSON.stringify({evidence,metadata,comparisons},null,2)+'\n');
