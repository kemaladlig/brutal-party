import { createServer } from 'vite';
const noop=()=>{}; const gradient={addColorStop:noop};
const context=new Proxy({measureText:()=>({width:0}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},
 {get:(t,k)=>k in t?t[k]:noop,set:(t,k,v)=>{t[k]=v;return true;}});
const canvas={width:800,height:600,getContext:()=>context};
globalThis.window={innerWidth:800,innerHeight:600,addEventListener:noop,removeEventListener:noop,AudioContext:null,webkitAudioContext:null,matchMedia:()=>({matches:false})};
globalThis.document={activeElement:null,body:{},addEventListener:noop,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({width:0,height:0,getContext:()=>context})};
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error',optimizeDeps:{noDiscovery:true}});
const m=await server.ssrLoadModule('/src/games/game.js');
console.log("game.js exports:",Object.keys(m));
const g=new m.Game(canvas); g.resize(800,600);
console.log("paddles:",g.paddles?.length, g.paddles?.map(p=>({side:p.side,slot:p.slotType,j:p.isJoined,axis:p.axis})));
console.log("ball?",!!g.ball,"arena",JSON.stringify(g.arena));
await server.close();
