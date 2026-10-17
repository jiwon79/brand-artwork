import {randomGenerator,mix,smoothstep,normalize,cross,clamp} from './math.js';
import {CLOUD_WIND} from './morphology.js';

export const SURFACE_DETAIL=Object.freeze({cellSize:.32,maximumCountFraction:.28,maximumMassFraction:.055,maximumBranchesPerRoot:34});

// One attached offshoot, then progressively smaller buds. Local directions
// inherit the parent's outward growth instead of scattering a new sphere of
// unrelated bumps at every scale. IDs and seeds belong to the structure.
export function surfaceBranch(anchor,host,seed,preset){
  const rng=randomGenerator(seed),nodes=[],bank=preset==='bank';
  const normal=normalize(anchor.normal);
  const radius=Math.min(host[6]*.62,clamp(host[6]*mix(.22,.36,rng()),.16,bank?.30:.46));
  const growth=normalize(normal.map((v,a)=>v+(a===1?(bank?.08:.24):0)+CLOUD_WIND[a]*.10));
  function bud(center,r,direction,level,parentId){
    const id=nodes.length,axes=[r*mix(.88,1.08,rng()),r*mix(bank?.68:1.04,bank?.88:1.20,rng()),r*mix(.87,1.10,rng())];
    nodes.push({id,parentId,level,center,axes,radius:r,direction,phase:rng()*Math.PI*2,mixing:anchor.mixing,hostId:host.id,rootId:host.rootId});
    if(level===3||r<.065||(level>0&&rng()<(bank?.42:.16)))return;
    const count=level===0?(bank?2:3):2;
    const tangent=normalize(cross(direction,Math.abs(direction[1])<.9?[0,1,0]:[1,0,0])),bitangent=cross(direction,tangent),phase=rng()*Math.PI*2;
    for(let i=0;i<count;i++){
      const angle=phase+(i+.20*(rng()-.5))*Math.PI*2/count;
      const childDirection=normalize(direction.map((v,a)=>v*.68+(tangent[a]*Math.cos(angle)+bitangent[a]*Math.sin(angle))*.74));
      if(childDirection[1]<-.42)continue;
      const childRadius=r*mix(.37,.57,rng());
      const childCenter=center.map((v,a)=>v+childDirection[a]*axes[a]*mix(.75,.84,rng()));
      bud(childCenter,childRadius,childDirection,level+1,id);
    }
  }
  // The trunk starts partly inside the old interface. No original density is
  // removed; overlap keeps every descendant rooted in the existing cloud.
  bud(anchor.position.map((v,a)=>v+normal[a]*radius*.18),radius,growth,0,-1);
  return nodes;
}

export function addSurfaceDetail(values,lighting,normals,candidates,seed,preset,lobes,{resolutionScale=1,lockedSurface=null}={}){
  const start=values.length/8,limit=Math.floor(start*SURFACE_DETAIL.maximumCountFraction);
  let baseMass=0;for(let i=0;i<values.length;i+=8)baseMass+=values[i+3]*values[i+4]*values[i+5]*values[i+6];
  const roots=new Map(),rank=randomGenerator(seed^0x6b8b4567);
  for(const candidate of candidates.values()){
    const host=lobes[candidate.parentId];if(!host||host.kind!=='dome')continue;
    const normal=normalize([0,1,2].map(a=>lighting[candidate.index*4+a]/127.5-1));
    if(normal[1]<-.25)continue;
    const group=roots.get(host.rootId)||[];
    group.push({...candidate,normal,position:values.slice(candidate.index*8,candidate.index*8+3),priority:rank(),seed:Math.floor(rank()*4294967296)});
    roots.set(host.rootId,group);
  }
  // Round-robin root families avoid exhausting the detail budget on the first
  // side encountered by the authoring grid. Sparse branches leave quiet gaps.
  const families=[...roots.values()].map(group=>({candidates:group.sort((a,b)=>a.priority-b.priority),cursor:0,anchors:[]}));
  const structure=[],anchors=[];
  function sample(node,rng){
    const {center,axes,radius,level,direction,phase,mixing}=node;
    const step=clamp(radius/3.7,.025,.095)/resolutionScale,sigma=step*.64,volume=(2*Math.PI)**1.5*sigma**3;
    const extent=axes.map(a=>Math.ceil(a*1.1/step));
    for(let z=-extent[2];z<=extent[2];z++)for(let y=-extent[1];y<=extent[1];y++)for(let x=-extent[0];x<=extent[0];x++){
      const p=[x,y,z].map(v=>(v+(rng()-.5)*.3)*step),q=p.reduce((sum,v,a)=>sum+(v/axes[a])**2,0);
      const relief=.10*Math.sin(p[0]/radius*4+phase)*Math.sin(p[1]/radius*3-phase)*Math.cos(p[2]/radius*4+phase);
      const density=smoothstep(1.04,.30,q+relief);if(density<.015)continue;
      const normal=normalize(p.map((v,a)=>v/axes[a]+direction[a]*.35));
      const peak=2.4*density*step**3/volume*mix(1,.50,mixing)*(.86**level);
      values.push(center[0]+p[0],center[1]+p[1],center[2]+p[2],peak,sigma,sigma,sigma,rng());
      for(let a=0;a<3;a++){lighting.push(Math.round(127.5*(1+normal[a]*.88)));normals.push(Math.round(127.5*(1+normal[a])));}
      lighting.push(Math.round(255*density*.5));
    }
  }
  if(lockedSurface){
    const rng=randomGenerator(seed^0x9e3779b9);
    for(const source of lockedSurface){
      const node={...source,sourceStart:values.length/8};sample(node,rng);node.sourceCount=values.length/8-node.sourceStart;
      structure.push(node);if(node.parentId<0)anchors.push({position:node.center,radius:node.radius});
    }
  }
  let active=!lockedSurface;
  while(active&&values.length/8-start<limit){
    active=false;
    for(const family of families){
      if(family.anchors.length>=SURFACE_DETAIL.maximumBranchesPerRoot)continue;
      let anchor,nodes;
      while(family.cursor<family.candidates.length){
        const candidate=family.candidates[family.cursor++],host=lobes[candidate.parentId];
        const branch=surfaceBranch(candidate,host,candidate.seed,preset),radius=branch[0].radius;
        // Leave connected families of different scales, not a uniform crust.
        if(anchors.some(a=>Math.hypot(...candidate.position.map((v,i)=>v-a.position[i]))<(radius+a.radius)*1.55))continue;
        anchor=candidate;nodes=branch;break;
      }
      if(!anchor)continue;active=true;
      const first=values.length/8,offset=structure.length,rng=randomGenerator(anchor.seed^0x9e3779b9);
      for(const node of nodes){const sourceStart=values.length/8;sample(node,rng);node.sourceStart=sourceStart;node.sourceCount=values.length/8-sourceStart;}
      if(values.length/8-start>limit){
        values.length=first*8;lighting.length=first*4;normals.length=first*3;
        // Do not repeatedly rasterize rejected trees to fill the last few
        // slots. Keep this family complete and leave the remaining budget idle.
        family.cursor=family.candidates.length;continue;
      }
      anchors.push({position:anchor.position,radius:nodes[0].radius});family.anchors.push(anchor);
      for(const node of nodes)structure.push({...node,id:offset+node.id,parentId:node.parentId<0?-1:offset+node.parentId});
    }
  }
  let addedMass=0;for(let i=start*8;i<values.length;i+=8)addedMass+=values[i+3]*values[i+4]*values[i+5]*values[i+6];
  const scale=addedMass?Math.min(1,baseMass*SURFACE_DETAIL.maximumMassFraction/addedMass):1;
  for(let i=start*8;i<values.length;i+=8)values[i+3]*=scale;
  return {baseBodyCount:start,count:values.length/8-start,lobes:structure.length,branches:anchors.length,massFraction:baseMass?addedMass*scale/baseMass:0,structure};
}
