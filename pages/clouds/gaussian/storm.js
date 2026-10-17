import {clamp, randomGenerator} from './math.js';

// Artistic world units, with three independently cached emission regions.
// Segment sources spread light along discharge paths instead of a round bulb.
export const STORM = {
  samples:24,period:11,maxTau:48,boltRadiance:95,boltRadius:.006,
  shutter:1/60,channelSeed:6149,
  lights:[
    {start:[-2.0,5.6,-.5],end:[-.5,8.4,-1.3],power:360,radius:.8,color:[.72,.78,1]},
    {start:[-.3,9.0,-1.6],end:[2.9,10.8,-1.0],power:45,radius:.85,color:[.77,.81,1]},
    {start:[4.8,5.3,2.0],end:[6.6,1.8,3.0],power:38,radius:.45,color:[.88,.90,1]},
  ],
  channelPath:[[1.7,7.4,.1],[4.3,5.8,1.5],[6.1,3.8,2.6],[6.8,1.2,3.1],[6.5,-2.1,3.4],[8.1,-24,3.6]],
};

export function closestLightPoint(light,p) {
  const d=light.end.map((v,i)=>v-light.start[i]),length2=d.reduce((s,v)=>s+v*v,0);
  const u=clamp(d.reduce((s,v,i)=>s+v*(p[i]-light.start[i]),0)/Math.max(length2,1e-8),0,1);
  return light.start.map((v,i)=>v+u*d[i]);
}

let cachedCycle,cachedEvents;
function eventsFor(cycle) {
  if(cycle===cachedCycle)return cachedEvents;
  const rng=randomGenerator(STORM.channelSeed^Math.imul(cycle+1,0x9e3779b1));
  cachedCycle=cycle;
  cachedEvents=[.6,5.3,8.7].map((start,index)=>{
    const strokes=2+Math.floor(rng()*3),delays=[0],weights=[1];
    for(let i=1;i<strokes;i++){delays.push(delays[i-1]+.045+rng()*.085);weights.push(.35+rng()*.55)}
    return {start:start+(cycle===0?0:(rng()-.5)*.65),external:index===1,region:index===2?1:0,delays,weights};
  });
  return cachedEvents;
}

// Integrate each very fast stroke over a camera shutter. Sampling an impulse
// only at frame timestamps would miss flashes at ordinary display rates.
function pulseIntegral(x,decay) {
  const attack=.0015,end=decay*9;
  x=clamp(x,0,end);
  return x<attack?x*x/(2*attack):attack*.5+decay*(1-Math.exp(-(x-attack)/decay));
}
function pulse(t,start,decay) {
  const h=STORM.shutter*.5;
  return (pulseIntegral(t-start+h,decay)-pulseIntegral(t-start-h,decay))/STORM.shutter;
}
export function lightningFrame(seconds) {
  const cycle=Math.floor(seconds/STORM.period),t=seconds-cycle*STORM.period,amplitudes=[0,0,0];
  let core=0,branches=0;
  for(const event of eventsFor(cycle))for(let i=0;i<event.delays.length;i++) {
    const start=event.start+event.delays[i],weight=event.weights[i];
    const flash=pulse(t,start,.030)*weight;
    if(event.external){core+=flash;branches+=pulse(t,start,.011)*weight*(i===0?1:.10);amplitudes[2]+=flash;}
    else {amplitudes[event.region]+=flash*.88;amplitudes[1-event.region]+=pulse(t,start+.028,.037)*weight*.48;}
  }
  return {amplitudes,core,branches,cycle};
}
export const lightningState=seconds=>lightningFrame(seconds).amplitudes;
export function lightningPreview(kind,cycle=0) {
  const event=eventsFor(cycle).find(e=>kind==='upper'?(!e.external&&e.region===1):e.external===(kind==='external'));
  return cycle*STORM.period+event.start+.014;
}

export const decodeLightningTau=value=>(value/255)**2*STORM.maxTau;

// Reuse the mass-conserving density grid already built for local visibility.
// Memoized lattice integrals are interpolated at each Gaussian center. Segment-source
// attenuation is quadrature of this filtered grid, not exact mixture
// integration; the camera's Gaussian extinction remains analytic.
export function bakeLightning(scene,grid) {
  const started=performance.now(),{density,dims,origin,cellSize:h}=grid,[nx,ny,nz]=dims,nxy=nx*ny;
  const result=new Uint8Array(scene.count*4);
  function sample(x,y,z) {
    x=(x-origin[0])/h;y=(y-origin[1])/h;z=(z-origin[2])/h;
    if(x<0||y<0||z<0||x>=nx-1||y>=ny-1||z>=nz-1)return 0;
    const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz,i=iz*nxy+iy*nx+ix;
    const a=density[i]*(1-fx)+density[i+1]*fx,b=density[i+nx]*(1-fx)+density[i+nx+1]*fx;
    const c=density[i+nxy]*(1-fx)+density[i+nxy+1]*fx,d=density[i+nxy+nx]*(1-fx)+density[i+nxy+nx+1]*fx;
    return (a*(1-fy)+b*fy)*(1-fz)+(c*(1-fy)+d*fy)*fz;
  }
  let integratedNodes=0;
  for(const [lightIndex,light] of STORM.lights.entries()) {
    const cache=new Float32Array(density.length);cache.fill(-1);
    function integral(ix,iy,iz) {
      const i=iz*nxy+iy*nx+ix;if(cache[i]>=0)return cache[i];
      const x=origin[0]+ix*h,y=origin[1]+iy*h,z=origin[2]+iz*h;
      const target=closestLightPoint(light,[x,y,z]);
      const dx=target[0]-x,dy=target[1]-y,dz=target[2]-z,length=Math.hypot(dx,dy,dz);
      const steps=Math.max(4,Math.min(32,Math.ceil(length/(h*1.5))));let tau=0;
      for(let j=0;j<steps;j++){const t=(j+.5)/steps;tau+=sample(x+dx*t,y+dy*t,z+dz*t);}
      integratedNodes++;return cache[i]=Math.min(STORM.maxTau,tau*length/steps);
    }
    for(let id=0;id<scene.count;id++) {
      const i=id*8,x=(scene.data[i]-origin[0])/h,y=(scene.data[i+1]-origin[1])/h,z=(scene.data[i+2]-origin[2])/h;
      const ix=Math.max(0,Math.min(nx-2,Math.floor(x))),iy=Math.max(0,Math.min(ny-2,Math.floor(y))),iz=Math.max(0,Math.min(nz-2,Math.floor(z)));
      const fx=Math.max(0,Math.min(1,x-ix)),fy=Math.max(0,Math.min(1,y-iy)),fz=Math.max(0,Math.min(1,z-iz));let tau=0;
      for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)tau+=integral(ix+dx,iy+dy,iz+dz)*(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz);
      result[id*4+lightIndex]=Math.round(255*Math.sqrt(Math.min(STORM.maxTau,tau)/STORM.maxTau));
    }
  }
  scene.lightning=result;
  // Retain the already-built filtered density lattice for channel occlusion.
  // Only the small bolt footprint samples it, when camera/path changes.
  scene.lightningDensity={data:density,dims,origin,cellSize:h};
  return {milliseconds:performance.now()-started,integratedNodes,cellSize:h,maxSteps:32,maxTau:STORM.maxTau};
}
