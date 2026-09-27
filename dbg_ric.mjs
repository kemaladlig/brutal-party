const norm=a=>{while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a;};
function segAabb(x1,y1,x2,y2,rect,pad=0){
  const minX=rect.x-pad,minY=rect.y-pad,maxX=rect.x+rect.w+pad,maxY=rect.y+rect.h+pad;
  const dx=x2-x1,dy=y2-y1; let tE=0,tX=1,nx=0,ny=0;
  const ax=(s,d,mn,mx,axis)=>{if(Math.abs(d)<=Number.EPSILON)return s>=mn&&s<=mx;
    let n=(mn-s)/d,f=(mx-s)/d,nn=d>0?-1:1; if(n>f){[n,f]=[f,n];}
    if(n>tE){tE=n;nx=axis==='x'?nn:0;ny=axis==='y'?nn:0;} tX=Math.min(tX,f);return tE<=tX;};
  if(!ax(x1,dx,minX,maxX,'x'))return null; if(!ax(y1,dy,minY,maxY,'y'))return null;
  return {t:tE,x:x1+dx*tE,y:y1+dy*tE,nx,ny};
}
const arena={left:0,right:600,top:0,bottom:400};
const tank={x:100,y:200,angle:-0.2};
const dirX=Math.cos(tank.angle), dirY=Math.sin(tank.angle);
const obs=[{x:300,y:150,w:20,h:40}];
let best=null,bestD=Infinity;
const wall=(d,p,nx,ny)=>{if(d>0&&d<bestD){bestD=d;best={x:p.x,y:p.y,nx,ny};}};
if(dirX>0)wall((arena.right-tank.x)/dirX,{x:arena.right,y:tank.y+dirY*((arena.right-tank.x)/dirX)},-1,0);
if(dirY>0)wall((arena.bottom-tank.y)/dirY,{x:tank.x+dirX*((arena.bottom-tank.y)/dirY),y:arena.bottom},0,-1);
for(const o of obs){const h=segAabb(tank.x,tank.y,tank.x+dirX*bestD,tank.y+dirY*bestD,o,0);
  if(h&&h.t<bestD){bestD=h.t;best={x:h.x,y:h.y,nx:h.nx,ny:h.ny};}}
console.log("bounce at",JSON.stringify({x:+best.x.toFixed(1),y:+best.y.toFixed(1),nx:best.nx,ny:best.ny}));
const dot=dirX*best.nx+dirY*best.ny;
const rx=dirX-2*dot*best.nx, ry=dirY-2*dot*best.ny;
console.log("reflected dir",rx.toFixed(3),ry.toFixed(3),"angle",Math.atan2(ry,rx).toFixed(3));
for(const e of [{x:200,y:120},{x:180,y:100},{x:220,y:90}]){
  const a=Math.atan2(e.y-best.y,e.x-best.x);
  console.log(`enemy(${e.x},${e.y}) angle=${a.toFixed(3)} diff=${Math.abs(norm(Math.atan2(ry,rx)-a)).toFixed(3)} hit=${Math.abs(norm(Math.atan2(ry,rx)-a))<0.22}`);
}
