import {CLOUD_LOD} from './spatial-lod.js';

export const RENDER_STATS=Object.freeze({windowMs:1000,responseWindowMs:250,warmupMs:250,refreshMs:250});

// Count scene redraws, not RAF callbacks, image samples, or reciprocal work
// timings. The caller keeps this active while a frame is waiting on the GPU.
export class FrameRate {
  constructor(){this.reset();}
  reset(){this.active=false;this.startedAt=0;this.lastFrameAt=-Infinity;this.frames=[];}
  setActive(active,now){
    if(!Number.isFinite(now))return;
    active=active||(this.active&&now-this.lastFrameAt<RENDER_STATS.refreshMs);
    if(active&&!this.active){this.startedAt=now;this.lastFrameAt=-Infinity;this.frames.length=0;}
    this.active=active;
  }
  complete(now){
    const start=Number.isFinite(this.lastFrameAt)?this.lastFrameAt:this.startedAt;
    if(this.active&&Number.isFinite(now)&&now>start){this.frames.push({start,end:now});this.lastFrameAt=now;}
  }
  rate(now,windowMs){
    const start=Math.max(this.startedAt,now-windowMs),elapsed=now-start;
    if(elapsed<=0)return 0;
    let completed=0;
    for(const frame of this.frames){
      // Weight the oldest interval at the window boundary instead of adding
      // or dropping a whole frame. An unfinished tail contributes time only.
      const overlap=Math.max(0,Math.min(now,frame.end)-Math.max(start,frame.start));
      completed+=overlap/(frame.end-frame.start);
    }
    return completed*1000/elapsed;
  }
  read(now){
    while(this.frames.length&&this.frames[0].end<=now-RENDER_STATS.windowMs)this.frames.shift();
    if(!this.active)return {state:'idle',fps:null,recentFPS:null};
    const elapsed=Math.max(0,now-this.startedAt);
    if(!Number.isFinite(now)||elapsed<RENDER_STATS.warmupMs)return {state:'measuring',fps:null,recentFPS:null};
    return {state:'active',fps:this.rate(now,RENDER_STATS.windowMs),recentFPS:this.rate(now,RENDER_STATS.responseWindowMs)};
  }
}

export function lodSummary(lod){
  const counts=lod?.drawnByLevel||[];let dominant=-1,used=0;
  for(let level=0;level<counts.length;level++)if(counts[level]>0){used++;if(dominant<0||counts[level]>counts[dominant])dominant=level;}
  return {scale:lod?.multiplier??null,span:dominant<0?null:CLOUD_LOD.levels[dominant].span,mixed:used>1};
}
