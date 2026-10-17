import { SHADOW_SLAB_SUPPORT } from './config.js';

// Cache spatial bounds only. All lighting samples use the original Gaussians;
// there is no separate low-detail proxy mixture to swap out after interaction.
export function clusterLightBounds(data, cellSize=1.1) {
  const cells=new Map();
  for(let i=0;i<data.length;i+=8) {
    const key=`${Math.floor(data[i]/cellSize)},${Math.floor(data[i+1]/cellSize)},${Math.floor(data[i+2]/cellSize)}`;
    let c=cells.get(key);
    if(!c){c={lo:[Infinity,Infinity,Infinity],hi:[-Infinity,-Infinity,-Infinity]};cells.set(key,c);}
    for(let a=0;a<3;a++) {
      c.lo[a]=Math.min(c.lo[a],data[i+a]-SHADOW_SLAB_SUPPORT*data[i+a+4]);
      c.hi[a]=Math.max(c.hi[a],data[i+a]+SHADOW_SLAB_SUPPORT*data[i+a+4]);
    }
  }
  const bounds=[];
  for(const c of cells.values()) {
    for(let a=0;a<3;a++)bounds.push((c.lo[a]+c.hi[a])/2);
    for(let a=0;a<3;a++)bounds.push((c.hi[a]-c.lo[a])/2+.0001);
  }
  return new Float32Array(bounds);
}

export function lightBounds(bounds,basis) {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  const axes=[basis.right,basis.up,basis.forward];
  for(let i=0;i<bounds.length;i+=6)for(let a=0;a<3;a++) {
    const v=axes[a];
    const center=bounds[i]*v[0]+bounds[i+1]*v[1]+bounds[i+2]*v[2];
    const radius=bounds[i+3]*Math.abs(v[0])+bounds[i+4]*Math.abs(v[1])+bounds[i+5]*Math.abs(v[2]);
    min[a]=Math.min(min[a],center-radius-.05);max[a]=Math.max(max[a],center+radius+.05);
  }
  return {min,span:max.map((x,a)=>x-min[a])};
}

export function lightDirectionDelta(a,b) {return Math.hypot(...a.map((x,i)=>x-b[i]));}

// An ordering can be reused for a different light direction. The per-group
// norm bounds below conservatively expand each query; they affect work, not
// accuracy. This avoids discarding useful worker results on every dial event.
export function binShadowGaussians(data,light) {
  const bins=1024,groups=16,baseRadius=1/32;
  const counts=new Uint32Array(bins*groups),keys=new Uint16Array(data.length/8);
  const f=light.forward,maxRadii=new Float64Array(groups),maxCenters=new Float64Array(groups),maxSigmas=new Float64Array(groups);
  for(let id=0;id<keys.length;id++) {
    const i=id*8,sx=data[i+4]*f[0],sy=data[i+5]*f[1],sz=data[i+6]*f[2];
    const radius=SHADOW_SLAB_SUPPORT*Math.sqrt(sx*sx+sy*sy+sz*sz);
    const group=Math.max(0,Math.min(groups-1,Math.ceil(Math.log2(radius/baseRadius))));
    const z=data[i]*f[0]+data[i+1]*f[1]+data[i+2]*f[2];
    const bin=Math.max(0,Math.min(bins-1,Math.floor((z-light.min[2])/light.span[2]*bins)));
    keys[id]=group*bins+bin;counts[keys[id]]++;
    maxRadii[group]=Math.max(maxRadii[group],radius);
    maxCenters[group]=Math.max(maxCenters[group],data[i]**2+data[i+1]**2+data[i+2]**2);
    maxSigmas[group]=Math.max(maxSigmas[group],data[i+4]**2+data[i+5]**2+data[i+6]**2);
  }
  for(let group=0;group<groups;group++){maxCenters[group]=Math.sqrt(maxCenters[group]);maxSigmas[group]=Math.sqrt(maxSigmas[group]);}
  const offsets=new Uint32Array(counts.length+1);
  for(let i=0;i<counts.length;i++)offsets[i+1]=offsets[i]+counts[i];
  const cursor=offsets.slice(),sorted=new Float32Array(data.length);
  for(let id=0;id<keys.length;id++) {
    const to=cursor[keys[id]]++*8,from=id*8;
    for(let a=0;a<8;a++)sorted[to+a]=data[from+a];
  }
  return {data:sorted,bins,groups,offsets,maxRadii,maxCenters,maxSigmas,forward:[...f],min:light.min[2],span:light.span[2]};
}

export function shadowSegmentRanges(index,light,start,end) {
  const delta=lightDirectionDelta(index.forward,light.forward),ranges=[];
  for(let group=0;group<index.groups;group++) {
    if(!index.maxRadii[group])continue;
    const margin=index.maxRadii[group]+delta*(index.maxCenters[group]+SHADOW_SLAB_SUPPORT*index.maxSigmas[group])+1e-5;
    const lo=Math.max(0,Math.min(index.bins-1,Math.floor((start-margin-index.min)/index.span*index.bins)));
    const hi=Math.max(0,Math.min(index.bins-1,Math.floor((end+margin-index.min)/index.span*index.bins)));
    const first=index.offsets[group*index.bins+lo],count=index.offsets[group*index.bins+hi+1]-first;
    if(count)ranges.push([first,count]);
  }
  return ranges;
}
