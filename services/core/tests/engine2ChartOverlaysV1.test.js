import test from "node:test";
import assert from "node:assert/strict";
import { buildEngine2ChartOverlayV1, validateEngine2ChartOverlayV1 } from "../logic/engine2/buildEngine2ChartOverlayV1.js";

const mock = (micro = { activeWave: "W2", levels: [{ key: "e1272", label: "1.272", price: 7900.25 }] }) => ({
  symbol: "ES",
  strategies: { "intraday_scalp@10m": { engine22WaveStrategy: {
    degreeStates: {
      primary: { activeWave: "W5", marks: { W2: { price: 7600, time: "2026-10-01 09:30" } }, activeFibModel: { active: true, levels: { e1618: 8100 } } },
      intermediate: {}, minor: {}, minute: {},
      subminute: { targetModel: { levels: { e100: 9999 } }, marks: { W1: { price: 9999, time: "2026-10-01 09:30" } } }
    },
    currentWavelength: { canonicalWaveStateConflict: true, degrees: { micro } }
  } } }
});
test("separate Micro source never silently reads Subminute", () => {
  const r = buildEngine2ChartOverlayV1(mock());
  assert.equal(r.degrees.micro.drawable, true);
  assert.equal(r.degrees.micro.lines[0].price, 7900.25);
  assert.ok(r.degrees.micro.lines.every(x => x.price !== 9999));
  assert.equal(r.degrees.micro.parentDegree, "subminute");
  assert.equal(r.snapshot.authorityConflict, true);
});
test("missing Micro levels fail visibly even when Subminute has levels", () => {
  const r = buildEngine2ChartOverlayV1(mock({ activeWave: "W2", levels: [] }));
  assert.equal(r.degrees.micro.drawable, false);
  assert.equal(r.degrees.micro.reason, "NO_CANONICAL_MICRO_LEVELS");
  assert.equal(r.degrees.micro.provenance.fallbackUsed, false);
});
test("Primary uses published structural marks and levels", () => {
  const r = buildEngine2ChartOverlayV1(mock());
  assert.equal(r.degrees.primary.drawable, true);
  assert.equal(r.degrees.primary.lines[0].price, 8100);
  assert.equal(r.degrees.primary.marks[0].price, 7600);
});
test("unsupported symbol rejects source", () => {
  assert.equal(buildEngine2ChartOverlayV1(mock(), "NQ").error, "UNSUPPORTED_SYMBOL");
});

test("Micro draws its own verified origin and independent W1 anchor without Subminute marks", () => {
  const micro = {
    activeWave: "W1", levels: [{key:"e382",price:7832.5,status:"WATCH"}],
    microSequence: {origin:7782.75,anchorProvenance:{price:7782.75,timestamp:"2026-10-08 07:00"},
      w1Completion:{state:"CONFIRMED",anchor:7835.25,evidence:{sourceTimestamp:"2026-10-09T16:00:00Z"}}}
  };
  const result = buildEngine2ChartOverlayV1(mock(micro));
  assert.deepEqual(result.degrees.micro.marks.map(m=>m.id), ["MICRO_ORIGIN","MICRO_W1_HIGH"]);
  assert.equal(result.degrees.micro.marks[1].price, 7835.25);
  assert.equal(result.degrees.micro.lines[0].price, 7832.5);
  assert.ok(result.degrees.micro.marks.every(m=>m.price !== 9999));
});
test("Micro W1 completion without reliable time must not fabricate an anchor timestamp", () => {
  const micro = { activeWave:"W1", levels:[], microSequence:{ w1Completion:{state:"COMPLETION_CANDIDATE", anchor:7800.25}} };
  const result = buildEngine2ChartOverlayV1(mock(micro));
  assert.equal(result.degrees.micro.marks.length,0);
  assert.equal(result.degrees.micro.drawable,false);
});

test("inactive fib model does not silently substitute historical targetModel", () => {
  const data = mock();
  const primary = data.strategies["intraday_scalp@10m"].engine22WaveStrategy.degreeStates.primary;
  primary.activeFibModel = { active: false, levels: { e1618: 8300 } };
  primary.targetModel = { levels: { e1618: 8200 } };
  const r = buildEngine2ChartOverlayV1(data);
  assert.equal(r.degrees.primary.lines.length, 0);
  assert.equal(r.degrees.primary.marks.length, 1);
  assert.equal(r.degrees.primary.drawable, true);
});
test("wave anchor status inherits parent mark maturity", () => {
  const data = mock();
  const primary = data.strategies["intraday_scalp@10m"].engine22WaveStrategy.degreeStates.primary;
  primary.marks.W1 = { low: {price: 7500,time:"2026-09-28 09:30"}, high: {price: 7600,time:"2026-09-29 09:30"},status:"COMPLETED_CANDIDATE" };
  const r = buildEngine2ChartOverlayV1(data);
  assert.equal(r.degrees.primary.marks.find(m=>m.id==="W1_HIGH").status,"COMPLETED_CANDIDATE");
});

test("Micro provenance never promotes shadow count ID to production identity", () => {
  const data = mock({ activeWave: "W1", levels: [{ key: "e382", price: 7810 }] });
  const wavelength = data.strategies["intraday_scalp@10m"].engine22WaveStrategy.currentWavelength;
  wavelength.microCanonicalRef = { sourceCountId: "shadow-v2-123", revision: 7 };
  const micro = buildEngine2ChartOverlayV1(data).degrees.micro;
  assert.equal(micro.provenance.sourceCountId, null);
  assert.equal(micro.provenance.shadowMicroCanonicalRef.sourceCountId, "shadow-v2-123");
  assert.equal(micro.provenance.shadowAuthority, "MICRO_V2_SHADOW_ONLY_NOT_USED");
});
test("Micro origin provenance alone does not assert locked completion", () => {
  const data = mock({ activeWave: "W1", levels: [],
    microSequence: { anchorProvenance: { price: 7782.75, timestamp: "2026-10-08 07:00", source: "MANAGER_LOCKED_MICRO_W4_LOW" } } });
  const mark = buildEngine2ChartOverlayV1(data).degrees.micro.marks[0];
  assert.equal(mark.status, "SOURCE_ANCHOR");
  assert.notEqual(mark.status, "CONFIRMED");
  assert.notEqual(mark.status, "LOCKED");
});
test("Fib touch is not a wave completion", () => {
  const data = mock({ activeWave: "W1", confirmationStatus: "W1_COMPLETION_NOT_CONFIRMED",
    levels: [{ key: "e382", price: 7832.5, status: "TOUCHED" }] });
  const micro = buildEngine2ChartOverlayV1(data).degrees.micro;
  assert.equal(micro.lines[0].status, "TOUCHED");
  assert.equal(micro.wave.confirmationStatus, "W1_COMPLETION_NOT_CONFIRMED");
  assert.equal(micro.marks.length, 0);
});

test("backend normalizes local Phoenix source times, preserves UTC and never invents date-only intraday anchors", () => {
  const data = mock();
  const primary = data.strategies["intraday_scalp@10m"].engine22WaveStrategy.degreeStates.primary;
  primary.marks.W2 = { price: 7600, time: "2026-10-01 09:30", status:"COMPLETED_CANDIDATE" };
  primary.marks.W3 = { price: 7700, time: "2026-10-02", status:"CONFIRMED" };
  primary.marks.W4 = { price: 7500, time: "2026-10-03T16:00:00Z", status:"CONFIRMED" };
  const marks = buildEngine2ChartOverlayV1(data).degrees.primary.marks;
  assert.equal(marks.find(m=>m.id==="W2").time, Date.parse("2026-10-01T09:30:00-07:00")/1000);
  assert.equal(marks.find(m=>m.id==="W4").time, Date.parse("2026-10-03T16:00:00Z")/1000);
  assert.equal(marks.find(m=>m.id==="W3"), undefined);
  assert.equal(marks.find(m=>m.id==="W2").status, "COMPLETED_CANDIDATE");
});

test("all five selected degrees render independently from Engine22 published contracts", () => {
  const data = mock({
    activeWave:"W1",
    confirmationStatus:"W1_COMPLETION_NOT_CONFIRMED",
    levels:[{key:"e382",label:"0.382",price:7832.5,status:"WATCH"}],
    microSequence:{anchorProvenance:{price:7782.75,timestamp:"2026-10-08 07:00"}}
  });
  const states = data.strategies["intraday_scalp@10m"].engine22WaveStrategy.degreeStates;
  const expected = {primary:8100,intermediate:8200,minor:8300,minute:8400};
  for (const [degree,price] of Object.entries(expected)) {
    states[degree].activeFibModel = {active:true,modelType:"EXTENSION",levels:{e1618:price}};
  }
  const response = buildEngine2ChartOverlayV1(data);
  assert.deepEqual(Object.keys(response.degrees),["primary","intermediate","minor","minute","micro"]);
  for (const [degree,price] of Object.entries(expected)) {
    assert.equal(response.degrees[degree].drawable,true);
    assert.equal(response.degrees[degree].lines.find(x=>x.key==="e1618").price,price);
    assert.match(response.degrees[degree].provenance.structuralSource,/degreeStates/);
  }
  assert.equal(response.degrees.micro.lines[0].price,7832.5);
  assert.match(response.degrees.micro.provenance.structuralSource,/currentWavelength/);
  assert.equal(response.degrees.micro.wave.confirmationStatus,"W1_COMPLETION_NOT_CONFIRMED");
  assert.notEqual(response.degrees.micro.lines[0].price,states.subminute.targetModel.levels.e100);
});
test("active false without marks emits explicit no-draw instead of historical fib", () => {
  const data = mock();
  const intermediate = data.strategies["intraday_scalp@10m"].engine22WaveStrategy.degreeStates.intermediate;
  intermediate.activeFibModel={active:false,levels:{e1618:8100}};
  intermediate.targetModel={levels:{e1618:8200}};
  const result=buildEngine2ChartOverlayV1(data).degrees.intermediate;
  assert.equal(result.drawable,false);
  assert.equal(result.reason,"NO_DRAWABLE_CANONICAL_STRUCTURE");
  assert.deepEqual(result.lines,[]);
});

test("object-valued canonical fib levels preserve price, label and touch status without confirming wave", () => {
  const data=mock({activeWave:"W1",confirmationStatus:"W1_COMPLETION_NOT_CONFIRMED",levels:[]});
  const primary=data.strategies["intraday_scalp@10m"].engine22WaveStrategy.degreeStates.primary;
  primary.activeFibModel={active:true,modelType:"RETRACEMENT_MAP",levels:{
    r618:{price:7712.25,label:"0.618",status:"TOUCHED"},
    r786:{price:null,label:"0.786",status:"WATCH"}
  }};
  const block=buildEngine2ChartOverlayV1(data).degrees.primary;
  assert.equal(block.lines.find(x=>x.key==="r618").price,7712.25);
  assert.equal(block.lines.find(x=>x.key==="r618").status,"TOUCHED");
  assert.equal(block.lines.some(x=>x.key==="r786"),false);
  assert.equal(block.model.type,"RETRACEMENT_MAP");
  assert.equal(block.componentAvailability.fibLevels,true);
});
test("marks and fib levels expose distinct availability", () => {
  const data=mock();
  const primary=data.strategies["intraday_scalp@10m"].engine22WaveStrategy.degreeStates.primary;
  primary.activeFibModel={active:false,levels:{e1618:8100}};
  const block=buildEngine2ChartOverlayV1(data).degrees.primary;
  assert.equal(block.componentAvailability.waveMarks,true);
  assert.equal(block.componentAvailability.fibLevels,false);
  assert.equal(block.model.active,false);
});

test("missing ES intraday structural lane does not silently borrow different strategy wave counts", () => {
  const data=mock();
  data.strategies["minor_swing@1h"]={engine22WaveStrategy:data.strategies["intraday_scalp@10m"].engine22WaveStrategy};
  delete data.strategies["intraday_scalp@10m"];
  const result=buildEngine2ChartOverlayV1(data);
  assert.equal(result.degrees.primary.drawable,false);
  assert.equal(result.degrees.micro.drawable,false);
  assert.equal(result.degrees.micro.reason,"CANONICAL_DEGREE_UNAVAILABLE");
});
test("Micro current-wavelength display conflict and source mode are explicitly disclosed", () => {
  const data=mock();
  data.strategies["intraday_scalp@10m"].engine22WaveStrategy.currentWavelength.sourceMode="OVERRIDE_DISPLAY_INTELLIGENCE";
  const micro=buildEngine2ChartOverlayV1(data).degrees.micro;
  assert.equal(micro.wave.authorityConflict,true);
  assert.equal(micro.provenance.sourceMode,"OVERRIDE_DISPLAY_INTELLIGENCE");
});

test("versioned API validates canonical degree shapes and rejects malformed price/time", () => {
  const output=buildEngine2ChartOverlayV1(mock());
  assert.equal(validateEngine2ChartOverlayV1(output).ok,true);
  output.degrees.micro.lines[0].price=Number.NaN;
  assert.ok(validateEngine2ChartOverlayV1(output).errors.includes("INVALID_LINE_MICRO"));
});
test("versioned API rejects aliasing Micro to Subminute", () => {
  const output=buildEngine2ChartOverlayV1(mock());
  output.degrees.micro.sourceDegree="subminute";
  assert.ok(validateEngine2ChartOverlayV1(output).errors.includes("MICRO_IDENTITY_MISMATCH"));
});
