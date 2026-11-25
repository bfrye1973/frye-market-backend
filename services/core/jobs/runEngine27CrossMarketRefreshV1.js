// Explicitly configured daily updater for an authorized Render disk.
// No default write path, no trading or snapshot mutation.
// Run only on instance owning the configured persistent disk.
import {persistEngine27CrossMarketLevelsV1} from "./persistEngine27CrossMarketLevelsV1.js";
const filePath=process.env.ENGINE27_CROSS_MARKET_LEVELS_PATH??null;
const apiKey=process.env.POLYGON_API_KEY??process.env.MASSIVE_API_KEY??null;
const result=await persistEngine27CrossMarketLevelsV1({filePath,apiKey,now:new Date()});
console.log(JSON.stringify({schema:"engine27.crossMarketRefresh.v1",written:result.written===true,
 reason:result.reason??null,availability:result.availability??null,asOf:result.asOf??null}));
if(result.written!==true)process.exitCode=1;
