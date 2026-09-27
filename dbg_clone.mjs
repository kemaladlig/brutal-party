import { createServer } from 'vite';
const noop=()=>{}; const gradient={addColorStop:noop};
const context=new Proxy({measureText:()=>({width:0}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},
 {get:(t,k)=>k in t?t[k]:noop,set:(t,k,v)=>{t[k]=v;return true;}});
const canvas={width:800,height:600,getContext:()=>context};
globalThis.window={innerWidth:800,innerHeight:600,addEventListener:noop,removeEventListener:noop,AudioContext:null,webkitAudioContext:null,matchMedia:()=>({matches:false})};
globalThis.document={activeElement:null,body:{},addEventListener:noop,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({width:0,height:0,getContext:()=>context})};
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error',optimizeDeps:{noDiscovery:true}});
const {CloneGame}=await server.ssrLoadModule('/src/games/clone.js');
const {updateCloneBotAI}=await server.ssrLoadModule('/src/ai/cloneAI.js');
// measure: does the bot reach within task.radius of its chosen task?
for(const [w,h] of [[800,600],[390,844]]){
  const g=new CloneGame(canvas); g.width=w; g.height=h; g.resize(w,h);
  g.slotTypes=['bot_god','bot_god','empty','empty']; g.initPlayers(); g.startNewMatch(); g.state='PLAYING';
  const p=g.players[0];
  let inside=0, frames=0, minDist=1e9;
  for(let i=0;i<1200;i++){ g.update(1000+(i+1)*16);
    frames++; const t=p.aiMemory?.currentTask;
    if(t){const d=Math.hypot(t.x-p.x,t.y-p.y); minDist=Math.min(minDist,d);
      if(d<(t.radius||0)) inside++;}}
  console.log(`${w}x${h} taskR=${g.taskPoints[0].radius.toFixed(1)} framesInsideRadius=${inside}/${frames} minDist=${minDist.toFixed(1)} scores=${g.scores.join(",")}`);
}
await server.close();
