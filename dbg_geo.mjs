import { createServer } from 'vite';
const noop=()=>{}; const gradient={addColorStop:noop};
const context=new Proxy({measureText:()=>({width:0}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},
 {get:(t,k)=>k in t?t[k]:noop,set:(t,k,v)=>{t[k]=v;return true;}});
const canvas={width:800,height:600,getContext:()=>context};
globalThis.window={innerWidth:800,innerHeight:600,addEventListener:noop,removeEventListener:noop,AudioContext:null,webkitAudioContext:null,matchMedia:()=>({matches:false})};
globalThis.document={activeElement:null,body:{},addEventListener:noop,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({width:0,height:0,getContext:()=>context})};
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error',optimizeDeps:{noDiscovery:true}});
const {CloneGame}=await server.ssrLoadModule('/src/games/clone.js');
const g=new CloneGame(canvas); g.resize(800,600);
g.slotTypes=['bot_god','bot_god','empty','empty']; g.initPlayers(); g.startNewMatch(); g.state='PLAYING';
const a=g.arena;
console.log("arena",JSON.stringify({l:a.left,r:a.right,t:a.top,b:a.bottom,cx:a.cx,cy:a.cy}));
g.walls.forEach((w,i)=>console.log(" wall",i,JSON.stringify({x:Math.round(w.x),y:Math.round(w.y),w:Math.round(w.w),h:Math.round(w.h)})));
console.log("spawn p0",Math.round(g.players[0].x),Math.round(g.players[0].y),"r",g.players[0].radius);
await server.close();
