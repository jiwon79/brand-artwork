import {CLOUD_LOD,snapLODMultiplier} from './spatial-lod.js';
import {CLOUD_INSTANCES,validateCloudCount} from './cloud-instances.js';

export const AUTO_PERFORMANCE=Object.freeze({
  targetFPS:55,headroom:.90,recoveryHeadroom:.70,
  responseMs:62.5,smoothingMs:25,maxIncreasePerSecond:16,recoveryInterval:1000,
  singleCloudLimit:16,
});

export function automaticLODLimit(count=CLOUD_INSTANCES.min){
  validateCloudCount(count);
  const t=Math.log(count/CLOUD_INSTANCES.min)/Math.log(CLOUD_INSTANCES.max/CLOUD_INSTANCES.min);
  return snapLODMultiplier(AUTO_PERFORMANCE.singleCloudLimit*(CLOUD_LOD.maxMultiplier/AUTO_PERFORMANCE.singleCloudLimit)**t);
}

// Integrate a continuous logarithmic target so sub-integer changes accumulate.
// Rendering and the HUD share its nearest-integer applied scale.
export class AutoPerformance {
  constructor(){this.level=Math.log2(CLOUD_LOD.defaultMultiplier);this.maxLOD=automaticLODLimit();this.resetMeasurements();}
  resetMeasurements(){this.cost=null;this.samples=0;this.lastAt=null;this.frameAt=null;this.limited=false;this.idleSince=null;}
  get budget(){return 1000/AUTO_PERFORMANCE.targetFPS;}
  get settings(){return {lod:snapLODMultiplier(Math.min(this.maxLOD,2**this.level))};}
  setLimit(maxLOD){
    if(!Number.isFinite(maxLOD)||maxLOD<CLOUD_LOD.minMultiplier||maxLOD>CLOUD_LOD.maxMultiplier)throw new Error('Invalid automatic LOD limit');
    this.maxLOD=snapLODMultiplier(maxLOD);this.level=Math.min(this.level,Math.log2(this.maxLOD));this.resetMeasurements();
  }
  recoverIdle(now,{idle=false,visible=true}={}){
    if(!idle||!visible||!Number.isFinite(now)||this.level===0){this.idleSince=null;return false;}
    if(this.idleSince===null){this.idleSince=now;return false;}
    const elapsed=Math.max(0,now-this.idleSince),before=this.settings.lod;
    this.level=Math.max(0,this.level-elapsed/AUTO_PERFORMANCE.recoveryInterval);
    if(this.settings.lod===CLOUD_LOD.minMultiplier)this.level=0;
    this.resetMeasurements();this.idleSince=now;return this.settings.lod!==before;
  }
  observe(milliseconds,now,{kind='volume',visible=true}={}){
    if(!visible||kind!=='volume'||!Number.isFinite(milliseconds)||milliseconds<=0||!Number.isFinite(now))return false;
    const blend=this.lastAt===null?1:1-Math.exp(-Math.max(0,now-this.lastAt)/AUTO_PERFORMANCE.smoothingMs);
    this.cost=this.cost===null?milliseconds:this.cost+(milliseconds-this.cost)*blend;
    this.lastAt=now;this.samples++;return true;
  }
  advance(now,{active=true,fps=null,pendingMs=0}={}){
    if(!active||!Number.isFinite(now)){this.frameAt=null;return false;}
    const dt=this.frameAt===null?0:Math.max(0,Math.min(100,now-this.frameAt));this.frameAt=now;
    const workBudget=this.budget*AUTO_PERFORMANCE.headroom;
    if(this.cost===null&&pendingMs<=workBudget)return false;
    const workRatio=(this.cost??0)/workBudget,pendingRatio=Math.max(0,pendingMs)/workBudget;
    const fpsRatio=Number.isFinite(fps)&&fps>=0?AUTO_PERFORMANCE.targetFPS/Math.max(.1,fps):0;
    const pressure=Math.max(workRatio,pendingRatio,fpsRatio),before=this.settings.lod;
    const rate=pressure>1?Math.min(AUTO_PERFORMANCE.maxIncreasePerSecond,Math.log2(pressure)*1000/AUTO_PERFORMANCE.responseMs)
      :this.cost!==null&&workRatio<AUTO_PERFORMANCE.recoveryHeadroom&&fpsRatio<=.95&&pendingRatio<1?-1000/AUTO_PERFORMANCE.recoveryInterval:0;
    this.level=Math.max(0,Math.min(Math.log2(this.maxLOD),this.level+rate*dt/1000));
    this.limited=this.settings.lod>=this.maxLOD&&pressure>1;return this.settings.lod!==before;
  }
  diagnostics(){return {targetFPS:AUTO_PERFORMANCE.targetFPS,level:this.level,maxLOD:this.maxLOD,completedWorkMs:this.cost,limited:this.limited,...this.settings};}
}
