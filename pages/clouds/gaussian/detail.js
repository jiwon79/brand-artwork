// Static, short-range visibility for indirect lighting. A mass-conserving
// tent reconstruction of the Gaussian mixture supplies six axial integrals.
// This is an authoring approximation, never the camera/direct-sun extinction.
import {bakeLightning} from './storm.js';
export const DETAIL_BAKE = { cellSize: .18, range: .90, maxTau: 8, maxCells: 1250000 };

export function createDetailDensity(scene) {
  const {data,count}=scene;
  if(!count)return {density:new Float32Array(),dims:[0,0,0],origin:[0,0,0],cellSize:DETAIL_BAKE.cellSize};
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<data.length;i+=8)for(let a=0;a<3;a++) {
    lo[a]=Math.min(lo[a],data[i+a]);hi[a]=Math.max(hi[a],data[i+a]);
  }
  let h=DETAIL_BAKE.cellSize,dims;
  do{dims=hi.map((v,a)=>Math.ceil((v-lo[a])/h)+7);if(dims.reduce((a,b)=>a*b,1)<=DETAIL_BAKE.maxCells)break;h*=1.05;}while(true);
  const origin=lo.map(v=>v-3*h),[nx,ny,nz]=dims,strides=[1,nx,nx*ny],size=nx*ny*nz;
  const density=new Float32Array(size);
  // Depositing integrated mass keeps this independent of adaptive cell sizes.
  // The tent plus separable filter intentionally resolves only the local
  // billow scale; fine gradient shading supplies the smaller boundary cues.
  const massScale=(2*Math.PI)**1.5/h**3;
  for(let i=0;i<data.length;i+=8) {
    const x=(data[i]-origin[0])/h,y=(data[i+1]-origin[1])/h,z=(data[i+2]-origin[2])/h;
    const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz;
    const mass=data[i+3]*data[i+4]*data[i+5]*data[i+6]*massScale;
    for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)
      density[(iz+dz)*nx*ny+(iy+dy)*nx+ix+dx]+=mass*(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz);
  }
  return {density,dims,origin,cellSize:h};
}

export function bakeLocalThickness(scene, detail) {
  const started=performance.now(),{data,count}=scene;
  if(!(detail instanceof Uint8Array)||detail.length!==count*12)throw new Error('Invalid cloud detail attributes.');
  if(!count)return {cellSize:DETAIL_BAKE.cellSize,grid:[0,0,0],milliseconds:0};
  const grid=createDetailDensity(scene),{dims,origin,cellSize:h}=grid,[nx,ny,nz]=dims,strides=[1,nx,nx*ny],size=nx*ny*nz;
  let density=grid.density,scratch=new Float32Array(size);
  for(const stride of strides) {
    for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++) {
      const i=z*nx*ny+y*nx+x;scratch[i]=.25*density[i-stride]+.5*density[i]+.25*density[i+stride];
    }
    [density,scratch]=[scratch,density];
  }
  const steps=Math.max(1,Math.round(DETAIL_BAKE.range/h)),thickness=new Float32Array(size*6);
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++) {
    const i=z*nx*ny+y*nx+x,coordinates=[x,y,z];
    for(let axis=0;axis<3;axis++)for(let sign=0;sign<2;sign++) {
      const direction=sign?-1:1,stride=strides[axis]*direction;
      let tau=.5*density[i];
      for(let k=1;k<=steps;k++) {
        const coordinate=coordinates[axis]+direction*k;
        if(coordinate<0||coordinate>=dims[axis])break;
        tau+=(k===steps?.5:1)*density[i+k*stride];
      }
      thickness[i*6+sign*3+axis]=Math.min(DETAIL_BAKE.maxTau,tau*h);
    }
  }
  for(let id=0;id<count;id++) {
    const i=id*8,x=(data[i]-origin[0])/h,y=(data[i+1]-origin[1])/h,z=(data[i+2]-origin[2])/h;
    const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz;
    for(let axis=0;axis<6;axis++) {
      let tau=0;
      for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)
        tau+=thickness[((iz+dz)*nx*ny+(iy+dy)*nx+ix+dx)*6+axis]*(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz);
      detail[id*12+4+(axis<3?axis:axis+1)]=Math.round(255*tau/DETAIL_BAKE.maxTau);
    }
  }
  if(scene.preset==='storm')scene.lightningBake=bakeLightning(scene,{density,dims,origin,cellSize:h});
  return {cellSize:h,range:steps*h,grid:dims,milliseconds:performance.now()-started};
}
