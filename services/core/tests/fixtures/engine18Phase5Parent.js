// Synthetic-only parent death fixture. No provider, network or paid resource.
import {Engine18SyntheticWorkerBridge} from '../../logic/engine18/engine18Phase4WorkerBridge.js';
const root=process.argv[2];
const bridge=new Engine18SyntheticWorkerBridge({root});
await bridge.start();
await bridge.submit('BEFORE_PARENT_DEATH',{msgClass:'market'});
process.stdout.write('PID '+bridge.child.pid+'\n');
setInterval(()=>{},1000);
