export const STRATEGY_CONFIGURATIONS = Object.freeze([
  {degree:"submicro",account:"SCHWAB_0747",engine29:true,neighbors:[null,"micro"]},
  {degree:"micro",account:"SCHWAB_6380",engine29:true,neighbors:["submicro","subminute"],candleTimeframe:"10m"},
  {degree:"subminute",account:"SCHWAB_7727",engine29:false,neighbors:["micro","minute"]},
  {degree:"minute",account:"SCHWAB_3914",engine29:false,neighbors:["subminute","minor"]},
  {degree:"minor",account:"SCHWAB_5671",engine29:false,neighbors:["minute","intermediate"]},
  {degree:"intermediate",account:"SCHWAB_2888",engine29:false,neighbors:["minor","primary"]},
  {degree:"primary",account:"SCHWAB_0144",engine29:false,neighbors:["intermediate",null]}
].map(row=>Object.freeze({...row,neighbors:Object.freeze(row.neighbors)})));
export const MICRO_CONFIG = STRATEGY_CONFIGURATIONS[1];
