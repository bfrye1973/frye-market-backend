// Engine 2E isolated acceptance server for Engine11 2020+ history only.
// No trading, Replay, snapshots, broker, or LIVE execution routes are mounted.
import express from "express";
import {makeEngine2cResearchRoute} from "../routes/engine2cResearchHistory.js";

const app=express();
app.disable("x-powered-by");
app.get("/health",(_req,res)=>res.json({ok:true,service:"engine2e-engine11-2020plus-preview"}));
app.get("/engine2c-private-history/page",makeEngine2cResearchRoute());

const port=Number(process.env.PORT||10000);
app.listen(port,"0.0.0.0",()=>console.log("ENGINE2E_ENGINE11_PREVIEW_LISTENING",port));
