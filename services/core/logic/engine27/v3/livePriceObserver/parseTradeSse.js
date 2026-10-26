// Bounded SSE parser. Heartbeats are transport-only; parse only JSON data frames.
export function createTradeSseParser({maxFrameBytes=16384}={}){
 let buffer="";
 return {push(chunk){
  if(typeof chunk!=="string")return {events:[],error:"INVALID_SSE_CHUNK"};
  buffer+=chunk.replace(/\r\n/g,"\n");
  if(buffer.length>maxFrameBytes)return {events:[],error:"SSE_FRAME_OVERSIZED"};
  const events=[];
  let index;
  while((index=buffer.indexOf("\n\n"))>=0){
   const frame=buffer.slice(0,index);buffer=buffer.slice(index+2);
   const data=frame.split("\n").filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
   if(!data)continue;
   try{events.push(JSON.parse(data))}catch{return {events:[],error:"INVALID_SSE_JSON"}}
  }
  return {events,error:null};
 },reset(){buffer=""}};
}
