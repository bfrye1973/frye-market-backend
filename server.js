// server.js — Ferrari Cluster Live Feed (HTTP + WS)
// Node 18+, npm i express cors morgan ws

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const ALLOW = String(process.env.CORS_ORIGIN || "https://frye-dashboard.onrender.com")
  .split(",").map(s => s.trim()).filter(Boolean);

const REQUIRE_TOKEN = String(process.env.REQUIRE_TOKEN || "0") === "1";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const DEMO = String(process.env.DEMO || "1") === "1";

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan("tiny"));
app.use(cors({
  origin(origin, cb) { if (!origin || ALLOW.includes(origin)) return cb(null, true); return cb(new Error("CORS blocked")); },
  credentials: false,
}));
app.options("*", cors());

function authMiddleware(req, res, next) {
  if (!REQUIRE_TOKEN) return next();
  const hdr = req.headers["authorization"] || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (token && token === AUTH_TOKEN) return next();
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "tos-backend", time: new Date().toISOString() }));

const state = {
  rpm: 5200, speed: 68, water: 62, oil: 55, fuel: 73,
  lights: { breakout:false, buy:false, sell:false, emaCross:false, stop:false, trail:false, pad1:false, pad2:false, pad3:false, pad4:false },
};

function rand(lo, hi){ return Math.floor(Math.random()*(hi-lo+1))+lo; }
function tickDemo(){
  if(!DEMO) return;
  state.rpm   = (state.rpm + rand(120,240)) % 9000;
  state.speed = (state.speed + rand(1,3)) % 220;
  state.water = Math.max(30, Math.min(80, state.water + rand(-2,2)));
  state.oil   = Math.max(40, Math.min(80, state.oil   + rand(-2,2)));
  state.fuel  = Math.max(20, Math.min(95, state.fuel  + (Math.random()<0.05 ? -1 : 0)));
  const r = Math.random();
  state.lights = {
    breakout: r < 0.10,
    buy:      r > 0.60 && r < 0.68,
    sell:     r > 0.68 && r < 0.76,
    emaCross: r > 0.76 && r < 0.84,
    stop:     r > 0.84 && r < 0.92,
    trail:    r > 0.92,
    pad1:false, pad2:false, pad3:false, pad4:false,
  };
}
setInterval(tickDemo, 400);

function gaugeHandler(key, max){
  return [authMiddleware, (_req, res)=>{
    let value = state[key]; if(!Number.isFinite(value)) value = 0;
    value = Math.max(0, Math.min(max, value));
    res.json({ value, ts: Date.now() });
  }];
}
app.get("/gauges/rpm",   ...gaugeHandler("rpm",   9000));
app.get("/gauges/speed", ...gaugeHandler("speed",  220));
app.get("/gauges/water", ...gaugeHandler("water",  100));
app.get("/gauges/oil",   ...gaugeHandler("oil",    100));
app.get("/gauges/fuel",  ...gaugeHandler("fuel",   100));

app.get("/gauges", authMiddleware, (_req, res) => {
  res.json({ rpm:state.rpm, speed:state.speed, water:state.water, oil:state.oil, fuel:state.fuel, ts:Date.now() });
});

app.get("/signals", authMiddleware, (_req, res) => res.json({ ...state.lights, ts: Date.now() }));

app.use((req,res)=>res.status(404).json({ ok:false, error:"Not Found", path:req.path }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function wsAuthOk(req){
  if(!REQUIRE_TOKEN) return true;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const qToken = url.searchParams.get("token");
  const hdr = req.headers["sec-websocket-protocol"] || "";
  const token = qToken || hdr;
  return token && token === AUTH_TOKEN;
}
function wsGaugeFeed(ws, key, max, ms){
  const send = ()=>{ let v = state[key]; if(!Number.isFinite(v)) v=0; v=Math.max(0,Math.min(max,v));
    try { ws.readyState===1 && ws.send(JSON.stringify({ value:v, ts: Date.now() })); } catch {}
  };
  const timer = setInterval(send, ms); send(); ws.on("close",()=>clearInterval(timer));
}
function wsSignals(ws, ms){
  const send = ()=>{ try { ws.readyState===1 && ws.send(JSON.stringify({ ...state.lights, ts: Date.now() })); } catch {} };
  const timer=setInterval(send, ms); send(); ws.on("close",()=>clearInterval(timer));
}
server.on("upgrade", (req, socket, head)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);
  if(!wsAuthOk(req)){ socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws)=>{
    switch(url.pathname){
      case "/gauges/rpm":   wsGaugeFeed(ws,"rpm",   9000, 400); break;
      case "/gauges/speed": wsGaugeFeed(ws,"speed",  220, 600); break;
      case "/gauges/water": wsGaugeFeed(ws,"water",  100,1200); break;
      case "/gauges/oil":   wsGaugeFeed(ws,"oil",    100,1200); break;
      case "/gauges/fuel":  wsGaugeFeed(ws,"fuel",   100,1200); break;
      case "/signals":      wsSignals(ws,1500); break;
      default: ws.close(1008,"Unknown path");
    }
  });
});

server.listen(PORT, () => {
  console.log(`TOS backend listening on :${PORT}`);
  console.log(`CORS allow: ${ALLOW.join(", ") || "(none)"}`);
  console.log(`Auth required: ${REQUIRE_TOKEN ? "YES" : "NO"}`);
  console.log(`Demo mode: ${DEMO ? "ON" : "OFF"}`);
});
