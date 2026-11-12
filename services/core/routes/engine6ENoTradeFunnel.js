// Read-only ES no-trade funnel summary; no mutation endpoints.
import {Router} from "express";
import {readFunnelCycles,summarizeFunnelCycles,validFunnelDate} from "../logic/engine6/6e-funnel/funnelDiagnosticStore.js";

const router=Router();
router.get("/funnel/es",(req,res)=>{
  const date=req.query.date;
  if(!validFunnelDate(date)) return res.status(400).json({ok:false,error:"INVALID_FUNNEL_DATE",expected:"YYYY-MM-DD"});
  try{
    const records=readFunnelCycles(date,{root:process.env.ENGINE6E_FUNNEL_DIR||undefined});
    return res.json({ok:true,...summarizeFunnelCycles(records,date)});
  }catch(error){
    return res.status(503).json({ok:false,error:"FUNNEL_DIAGNOSTIC_READ_FAILED"});
  }
});
export default router;
