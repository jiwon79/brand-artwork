// The sequence depends on the accumulated sample index, never the frame rate
// or per-frame budget. One frame at 4 spp equals four frames at 1 spp.
export function radicalInverse(index, base) {
  let value=0, place=1/base;
  while(index>0) { value+=(index%base)*place; index=Math.floor(index/base); place/=base; }
  return value;
}

export function sampleSequence(index) {
  const i=index+1;
  return {
    pixel:[radicalInverse(i,2)-.5,radicalInverse(i,3)-.5],
    light:[radicalInverse(i,5)-.5,radicalInverse(i,7)-.5,radicalInverse(i,11)-.5],
    absorption:radicalInverse(index,2),
  };
}

export function jitterLight(light, size, sample) {
  return {...light,min:light.min.map((x,i)=>x+sample.light[i]*light.span[i]/(size[i]-(i===2?1:0)))};
}

// Light-space samples survive camera-history resets. Each full-resolution field
// serves a stratified group of camera samples, then advances the same sequence.
// Moving views retain the current field, so orbiting cannot trigger periodic
// shadow rebuilds. A new sun or cloud always starts a new field immediately.
export class ShadowHistory {
  constructor() { this.key=null;this.index=0;this.uses=0; }
  select(key,viewChanged,reuse) {
    if(this.key!==key){this.key=key;this.index=0;this.uses=0;}
    else if(!viewChanged&&this.uses>=reuse){this.index++;this.uses=0;}
    return this.index;
  }
  commit(reuse) { this.uses=Math.min(reuse,this.uses+1); }
}

export class SampleHistory {
  constructor() { this.key=null; this.count=0; this.epoch=0; }
  setKey(key) {
    if(key===this.key)return false;
    this.key=key;this.count=0;this.epoch++;return true;
  }
  remaining(budget,limit) { return Math.max(0,Math.min(budget,limit-this.count)); }
}
