import { createServer } from 'vite';
const noop=()=>{}; const gradient={addColorStop:noop};
const context=new Proxy({measureText:()=>({width:0}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},
 {get:(t,k)=>k in t?t[k]:noop,set:(t,k,v)=>{t[k]=v;return true;}});
const canvas={width:800,height:600,getContext:()=>context};
globalThis.window={innerWidth:800,innerHeight:600,addEventListener:noop,removeEventListener:noop,AudioContext:null,webkitAudioContext:null,matchMedia:()=>({matches:false})};
globalThis.document={activeElement:null,body:{},addEventListener:noop,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({width:0,height:0,getContext:()=>context})};
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error',optimizeDeps:{noDiscovery:true}});
const {TanksGame}=await server.ssrLoadModule('/src/games/tanks.js');
const g=new TanksGame(canvas); g.resize(800,600);
g.slotTypes=['bot_god','bot_god','empty','empty']; g.initTanks(); g.startNewMatch(); g.state='PLAYING';
const bot=g.tanks[0], en=g.tanks[1];
for(const t of [bot,en]){t.isAlive=true;t.isJoined=true;}
bot.reloadTimer=0;bot.botAimHold=0;bot.botLastShot=0;bot.botClock=0;
g.obstacles=[];g.bullets=[];
bot.x=g.arena.left+80;bot.y=g.arena.cy;en.x=g.arena.right-80;en.y=g.arena.cy;bot.angle=0;
console.log("arena",JSON.stringify(g.arena),"reloadTimer",bot.reloadTimer,"maxBullets",bot.maxBullets,"slot",bot.slotType);
for(let i=0;i<12;i++){
  g.update(1000+(i+1)*16);
  console.log(i,"bullets",g.bullets.length,"angle",bot.angle.toFixed(3),"reload",bot.reloadTimer.toFixed(2),"aimHold",(bot.botAimHold||0).toFixed(2),"clock",(bot.botClock||0).toFixed(2),"isDriving",bot.isDriving,"x",bot.x.toFixed(0),"y",bot.y.toFixed(0),"state",g.state);
}
await server.close();
