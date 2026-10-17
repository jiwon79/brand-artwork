import {clamp} from './math.js';

export const CAMERA_VIEW=Object.freeze({tanHalfFov:Math.tan(42*Math.PI/360),lensShift:Object.freeze([0,0]),portraitFit:1.15,minDistance:5,maxDistance:85});
export const viewDistance=(distance,width,height)=>distance*Math.max(1,CAMERA_VIEW.portraitFit/(width/Math.max(1,height)));
const boundedDistance=distance=>clamp(distance,CAMERA_VIEW.minDistance,CAMERA_VIEW.maxDistance);
const changed=r=>{r.sortDirty=true;r.dirty=true};
export function zoomCamera(r,factor){if(!(factor>0))return;r.camera.distance=boundedDistance(r.camera.distance*factor);changed(r);}

export function installCameraControls(r){
  const canvas=r.canvas,opts={signal:r.abort.signal},pointers=new Map();let gesture;
  const point=e=>({x:e.clientX,y:e.clientY,pan:e.button===2||e.shiftKey});
  const pair=()=>{const [a,b]=pointers.values();return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,span:Math.max(2,Math.hypot(b.x-a.x,b.y-a.y))}};
  function rebase(){
    if(pointers.size===2){
      const p=pair(),rect=canvas.getBoundingClientRect();
      gesture={...p,target:[...r.camera.target],distance:r.camera.distance,frame:r.cameraFrame(),centerX:rect.left+rect.width/2,centerY:rect.top+rect.height/2};
    }else gesture=null;
    canvas.classList.toggle('dragging',pointers.size>0);
  }
  canvas.addEventListener('pointerdown',e=>{
    if((e.button!==0&&e.button!==2)||pointers.size>=2)return;
    e.preventDefault();canvas.focus({preventScroll:true});
    pointers.set(e.pointerId,point(e));
    try{canvas.setPointerCapture(e.pointerId)}catch{/* A canceled pointer may already have left the browser. */}
    rebase();
  },opts);
  canvas.addEventListener('pointermove',e=>{
    const previous=pointers.get(e.pointerId);if(!previous)return;
    e.preventDefault();const current={...previous,x:e.clientX,y:e.clientY};pointers.set(e.pointerId,current);
    if(pointers.size===2){
      const p=pair(),g=gesture,{right,up}=g.frame;
      r.camera.distance=boundedDistance(g.distance*g.span/p.span);
      const ratio=r.camera.distance/g.distance;
      const scale=2*viewDistance(g.distance,canvas.clientWidth,canvas.clientHeight)*CAMERA_VIEW.tanHalfFov/Math.max(1,canvas.clientHeight);
      // Preserve the world point beneath the pinch midpoint, and allow the
      // midpoint to move naturally. Use a fixed gesture origin to avoid drift.
      const x=(g.x-g.centerX)*(1-ratio)-(p.x-g.x)*ratio;
      const y=-(g.y-g.centerY)*(1-ratio)+(p.y-g.y)*ratio;
      r.camera.target=g.target.map((v,i)=>v+scale*(right[i]*x+up[i]*y));
    }else{
      const dx=current.x-previous.x,dy=current.y-previous.y;
      if(previous.pan){
        const {right,up}=r.cameraFrame(),scale=2*viewDistance(r.camera.distance,canvas.clientWidth,canvas.clientHeight)*CAMERA_VIEW.tanHalfFov/Math.max(1,canvas.clientHeight);
        r.camera.target=r.camera.target.map((v,i)=>v-right[i]*dx*scale+up[i]*dy*scale);
      }else{r.camera.yaw-=dx*.005;r.camera.pitch=clamp(r.camera.pitch+dy*.005,-.7,1.3);}
    }
    changed(r);
  },opts);
  const end=e=>{if(!pointers.delete(e.pointerId))return;rebase();if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId)};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,end,opts);
  canvas.addEventListener('contextmenu',e=>e.preventDefault(),opts);
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();const unit=e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1;
    zoomCamera(r,Math.exp(e.deltaY*unit*.001));
  },{...opts,passive:false});
  canvas.addEventListener('keydown',e=>{
    let handled=true;
    if(e.key==='ArrowLeft')r.camera.yaw-=.055;
    else if(e.key==='ArrowRight')r.camera.yaw+=.055;
    else if(e.key==='ArrowUp')r.camera.pitch=clamp(r.camera.pitch+.04,-.7,1.3);
    else if(e.key==='ArrowDown')r.camera.pitch=clamp(r.camera.pitch-.04,-.7,1.3);
    else if(e.key==='+'||e.key==='=')zoomCamera(r,.94);
    else if(e.key==='-')zoomCamera(r,1/.94);
    else handled=false;
    if(handled){e.preventDefault();changed(r)}
  },opts);
}
