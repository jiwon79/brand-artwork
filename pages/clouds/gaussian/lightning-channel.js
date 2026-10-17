import {randomGenerator,normalize,cross} from './math.js';
import {STORM} from './storm.js';

// Correlated displacements at several scales avoid both a smooth cable and a
// repeated sawtooth. Forks start at actual parent nodes and taper to fine tips.
export function createLightningChannel(seed=STORM.channelSeed) {
  const rng=randomGenerator(seed),segments=[];
  function subdivide(a,b,depth,roughness) {
    if(!depth)return [a,b];
    const d=b.map((v,i)=>v-a[i]),length=Math.hypot(...d),forward=normalize(d);
    const tangent=normalize(cross(forward,Math.abs(forward[1])>.9?[1,0,0]:[0,1,0])),other=cross(forward,tangent);
    const u=(rng()-.5)*length*roughness,v=(rng()-.5)*length*roughness;
    const middle=a.map((x,i)=>(x+b[i])*.5+tangent[i]*u+other[i]*v);
    return [...subdivide(a,middle,depth-1,roughness).slice(0,-1),...subdivide(middle,b,depth-1,roughness)];
  }
  function add(points,width,energy,branch) {
    for(let i=1;i<points.length;i++) {
      const t=(i-.5)/(points.length-1),taper=branch?Math.pow(1-t,.65)*.85+.10:1-t*.28;
      segments.push({a:points[i-1],b:points[i],radius:STORM.boltRadius*width*taper,energy:energy*(branch?1-t*.65:1),branch});
    }
  }
  const main=[];
  for(let i=1;i<STORM.channelPath.length;i++) {
    const a=STORM.channelPath[i-1],b=STORM.channelPath[i];
    const length=Math.hypot(...a.map((v,j)=>v-b[j])),depth=Math.min(6,Math.max(4,Math.ceil(Math.log2(length/.3))));
    const points=subdivide(a,b,depth,.40);
    main.push(...points.slice(i===1?0:1));
  }
  add(main,1,1,false);
  const forks=9+Math.floor(rng()*5);
  for(let fork=0;fork<forks;fork++) {
    const index=5+Math.floor(rng()*(main.length-16)),start=main[index],side=rng()<.5?-1:1;
    const reach=.7+rng()*2.8;
    const end=[start[0]+side*reach,start[1]-(.25+rng()*.8)*reach,start[2]+(rng()-.5)*reach];
    const branch=subdivide(start,end,4,.5);add(branch,.38+rng()*.2,.5+rng()*.2,true);
    if(fork%2===0) {
      const root=branch[6+Math.floor(rng()*6)],tip=[root[0]+side*(.35+rng()*.8),root[1]-.3-rng()*.7,root[2]+(rng()-.5)*.6];
      add(subdivide(root,tip,2,.45),.2,.3,true);
    }
  }
  return {segments,main};
}
