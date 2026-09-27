import { createServer } from 'vite';
const noop=()=>{}; const gradient={addColorStop:noop};
const context=new Proxy({measureText:()=>({width:0}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},
 {get:(t,k)=>k in t?t[k]:noop,set:(t,k,v)=>{t[k]=v;return true;}});
const canvas={width:800,height:600,getContext:()=>context};
globalThis.window={innerWidth:800,innerHeight:600,addEventListener:noop,removeEventListener:noop,AudioContext:null,webkitAudioContext:null,matchMedia:()=>({matches:false})};
globalThis.document={activeElement:null,body:{},addEventListener:noop,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({width:0,height:0,getContext:()=>context})};
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error',optimizeDeps:{noDiscovery:true}});
const {ArcherGame}=await server.ssrLoadModule('/src/games/archer.js');
const g=new ArcherGame(canvas); g.resize(800,600);
g.slotTypes=['bot_god','bot_normal','empty','empty']; g.initPlayers(); g.startNewMatch();
for(let f=0; f<300; f++) g.update(1000+(f+1)*16);
for(const p of g.players.slice(0,2)){
  const s={chg:0,maxCharge:0,cancels:0,shots:0};
  let prev=false;
  for(let f=0;f<300;f++){
    g.update(1000+(301+f)*16);
    if(p.charging) s.chg++;
    if(p.charge>s.maxCharge) s.maxCharge=p.charge;
    if(prev&&!p.charging) { if(p.charge<0.5) s.cancels++; else s.shots++; }
    prev=p.charging;
  }
  console.log(`p${p.index} chargingFrames=${s.chg}/300 maxCharge=${s.maxCharge.toFixed(2)} releases=${s.shots} cancels=${s.cancels} shotCd=${p.shotCooldown.toFixed(2)} ammo?`);
}
await server.close();
