// Engine22 V3: independent, deterministic wave-geometry checks.
// Structural evidence only. A valid geometry does not establish a wave count.
const n=x=>typeof x==="number"&&Number.isFinite(x);
const valid=x=>x&&n(x.price)&&x.price>0&&typeof x.time==="string"&&Number.isFinite(Date.parse(x.time));
export function assessEngine22V3ImpulseGeometry({anchors=null,direction="UP",classification="IMPULSE"}={}){
 const errors=[],marks=anchors||{};
 if(!["UP","DOWN"].includes(direction))errors.push("INVALID_DIRECTION");
 if(!["IMPULSE","DIAGONAL_CANDIDATE","UNCLASSIFIED"].includes(classification))
  errors.push("INVALID_CLASSIFICATION");
 const points=["W1_LOW","W1_HIGH","W2_LOW","W3_HIGH","W4_LOW","W5_HIGH"].map(k=>marks[k]??null);
 for(let i=0;i<points.length;i++)if(points[i]!=null&&!valid(points[i]))
  errors.push("INVALID_ANCHOR_"+i);
 let prior=-Infinity;
 for(const p of points.filter(Boolean)){
  const t=Date.parse(p.time);
  if(t<=prior)errors.push("OUT_OF_SEQUENCE_ANCHOR_TIME");
  prior=t;
 }
 const [a,b,c,d,e,f]=points;
 const sign=direction==="UP"?1:-1;
 if(a&&b&&sign*(b.price-a.price)<=0)errors.push("W1_DIRECTION_INVALID");
 if(b&&c&&sign*(b.price-c.price)<=0)errors.push("W2_PULLBACK_INVALID");
 if(a&&c&&sign*(c.price-a.price)<=0)errors.push("W2_ORIGIN_BREACH");
 if(c&&d&&sign*(d.price-c.price)<=0)errors.push("W3_DIRECTION_INVALID");
 if(b&&d&&sign*(d.price-b.price)<=0)errors.push("W3_NO_NEW_EXTREME");
 if(d&&e&&sign*(d.price-e.price)<=0)errors.push("W4_PULLBACK_INVALID");
 const overlap=b&&e&&sign*(b.price-e.price)>0;
 if(overlap&&classification==="IMPULSE")errors.push("W1_W4_OVERLAP_STANDARD_IMPULSE");
 if(e&&f&&sign*(f.price-e.price)<=0)errors.push("W5_DIRECTION_INVALID");
 if(a&&b&&c&&d&&e&&f&&sign*(d.price-b.price)>0&&sign*(f.price-d.price)>0){
  const w1=Math.abs(b.price-a.price),w3=Math.abs(d.price-c.price),w5=Math.abs(f.price-e.price);
  if(w3<Math.min(w1,w5))errors.push("W3_SHORTEST_IMPULSE");
 }
 return {valid:errors.length===0,errors,overlap:Boolean(overlap),
  standardImpulseConfirmed:errors.length===0&&classification==="IMPULSE"&&Boolean(f),
  classification, noExecution:true};
}
