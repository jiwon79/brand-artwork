import { randomGenerator, mix, smoothstep, clamp } from './math.js';
import {bakeLocalThickness} from './detail.js';
import {cloudEnvelope, CLOUD_WIND} from './morphology.js';
import {addSurfaceDetail,SURFACE_DETAIL} from './surface-detail.js';

export const PRESETS = {
  cumulus: { name: 'Fair weather', seed: 7351, elevation: 38, azimuth: -82, density: 1.55, exposure: 0.0, scattering: 0.65, distance: 29, target: [1.2, 3.1, 0], pitch: 0.075, yaw: 0.23 },
  tower: { name: 'Cumulus congestus', seed: 1943, elevation: 30, azimuth: -65, density: 1.8, exposure: 0.1, scattering: 0.85, distance: 35, target: [0, 5.5, 0], pitch: 0.04, yaw: 0.20 },
  sunset: { name: 'Evening light', seed: 7351, elevation: 9, azimuth: -110, density: 1.5, exposure: 0.25, scattering: 0.9, distance: 29, target: [0, 3.1, 0], pitch: 0.075, yaw: 0.23 },
  bank: { name: 'Cloud sea', seed: 2871, elevation: 34, azimuth: -62, density: 1.5, exposure: 0.2, scattering: 0.8, distance: 38, target: [0, 1.6, 0], pitch: 0.33, yaw: 0.15 },
  storm: { name: 'Thunderstorm at night', seed: 6149, elevation: 32, azimuth: -115, density: 1.95, exposure: 0, scattering: .75, distance: 43, target: [0, 6.0, 0], pitch: .04, yaw: .23 },
};
Object.assign(PRESETS.cumulus,{description:'Cumulus humilis · daylight'});
Object.assign(PRESETS.tower,{label:'Towering cumulus',description:'Cumulus congestus · rising columns'});
Object.assign(PRESETS.sunset,{description:'Cumulus humilis · golden hour'});
Object.assign(PRESETS.bank,{description:'Stratocumulus · cloud sea'});
Object.assign(PRESETS.storm,{description:'Cumulonimbus · moonlight & lightning'});

// Lighting presets can share the same authored volume. Keep this identity
// explicit so generation and its in-memory cache agree about aliases.
export function cloudGeometryPreset(preset){return preset==='sunset'?'cumulus':preset;}

const cumulusEdges={crisp:0.10,diffuse:0.70,mixing:0.0};
export const EDGE_PROFILES = {
  cumulus:cumulusEdges, sunset:cumulusEdges,
  tower:{crisp:0.065,diffuse:0.48,mixing:-0.06},
  bank:{crisp:0.22,diffuse:1.0,mixing:0.14},
  storm:{crisp:.075,diffuse:.65,mixing:.03},
};

function hash(x, y, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + seed | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967295;
}
export function noise(x, y, z, seed, gradient) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const u = smoothstep(0, 1, x - ix), v = smoothstep(0, 1, y - iy), w = smoothstep(0, 1, z - iz);
  const a=hash(ix,iy,iz,seed),b=hash(ix+1,iy,iz,seed),c=hash(ix,iy+1,iz,seed),d=hash(ix+1,iy+1,iz,seed);
  const e=hash(ix,iy,iz+1,seed),f=hash(ix+1,iy,iz+1,seed),g=hash(ix,iy+1,iz+1,seed),h=hash(ix+1,iy+1,iz+1,seed);
  const lower=mix(mix(a,b,u),mix(c,d,u),v),upper=mix(mix(e,f,u),mix(g,h,u),v);
  if(gradient) {
    gradient[0]=mix(mix(b-a,d-c,v),mix(f-e,h-g,v),w)*6*(x-ix)*(1-x+ix);
    gradient[1]=mix(mix(c-a,d-b,u),mix(g-e,h-f,u),w)*6*(y-iy)*(1-y+iy);
    gradient[2]=(upper-lower)*6*(z-iz)*(1-z+iz);
  }
  return mix(lower,upper,w);
}
const gradientScratch=[0,0,0];
// Density relief must survive the Gaussian reconstruction footprint. The old
// 6.8/unit band displaced the boundary by only ~0.02 units in typical samples,
// less than its ~0.05-unit Gaussian sigma. Keep dissipating edges gentler.
const DETAIL_RELIEF = { frequency: 3.2, crispAmplitude: .54, diffuseAmplitude: .24 };
const AUTHORING_DENSITY=3.2,GAUSSIAN_VOLUME=(2*Math.PI)**1.5;
function fbm(x, y, z, seed, gradient) {
  const a=noise(x,y,z,seed,gradient);
  if(gradient)for(let i=0;i<3;i++)gradient[i]*=.57;
  const b=noise(x*2.07+17,y*2.07,z*2.07-9,seed,gradient?gradientScratch:null);
  if(gradient)for(let i=0;i<3;i++)gradient[i]+=.28*2.07*gradientScratch[i];
  const c=noise(x*4.13,y*4.13+11,z*4.13,seed,gradient?gradientScratch:null);
  if(gradient)for(let i=0;i<3;i++)gradient[i]+=.15*4.13*gradientScratch[i];
  return .57*a+.28*b+.15*c;
}

// Slowly varying mixing/evaporation patches: a growing dome can stay crisp
// beside a dissipating flank. Softness belongs to the 3D extinction field,
// so the silhouette, transmission and small shadows all see the same edge.
export function edgeProfileAt(preset,seed,x,y,z) {
  const profile=EDGE_PROFILES[preset];
  const weather=noise(x*.24+13,y*.30,z*.24-7,seed+91);
  const lee=0.10*Math.sin((x*CLOUD_WIND[0]+z*CLOUD_WIND[2])*.22);
  let mixing=smoothstep(.42,.82,weather+lee+profile.mixing);
  if(preset==='tower')mixing*=1.0-.68*smoothstep(5,11,y);
  return {mixing,width:mix(profile.crisp,profile.diffuse,mixing)};
}

// Noise is used ONLY to author Gaussian amplitudes. Runtime density is entirely
// the positive Gaussian mixture; no shader noise modifies analytic extinction.
export function generateCloud(preset = 'cumulus', seed = PRESETS[preset].seed, {surfaceDetail=true,splatMultiplier=1,deferDetail=false}={}) {
  if(![1,4].includes(splatMultiplier))throw new RangeError('Source splat multiplier must be 1 or 4');
  const geometry=cloudGeometryPreset(preset);
  if(splatMultiplier===1)return {...generateCloudVolume(geometry,seed,{surfaceDetail,deferDetail}),preset};
  // Select the structure at the standard sampling density once, then sample
  // exactly that authored structure on a finer grid. Sampling density must
  // not select different branches or create a different cloud for the test.
  let reference=generateCloudVolume(geometry,seed,{surfaceDetail,bake:false});
  const sourceCount=reference.count,lockedSurface=reference.structure.surface;
  reference=null;
  const scene={...generateCloudVolume(geometry,seed,{surfaceDetail,resolutionScale:Math.cbrt(splatMultiplier),lockedSurface,deferDetail}),preset};
  scene.sampling={requestedMultiplier:splatMultiplier,sourceCount,actualMultiplier:scene.count/sourceCount};
  return scene;
}

// A temporary view of the same authored envelope. The final source uses its
// original sampling and random sequence; preview work cannot change it.
export const CLOUD_PREVIEW_STAGES=Object.freeze([{name:'silhouette',resolutionScale:.2},{name:'preview',resolutionScale:.35}].map(Object.freeze));
export function generateCloudPreview(preset,seed,resolutionScale=CLOUD_PREVIEW_STAGES.at(-1).resolutionScale) {
  return {...generateCloudVolume(cloudGeometryPreset(preset),seed,{surfaceDetail:false,resolutionScale}),preset,preview:true};
}

function generateCloudVolume(preset,seed,{surfaceDetail=true,resolutionScale=1,lockedSurface=null,bake=true,deferDetail=false}={}) {
  const rng = randomGenerator(seed);
  const {lobes,plumes}=cloudEnvelope(preset,seed);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const l of lobes) for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], l[a] - l[a + 3] - 0.6);
    max[a] = Math.max(max[a], l[a] + l[a + 3] + 0.6);
  }
  min[1] = -0.8;
  // Fine surface cells preserve the local edge profile. Deep interior
  // cells can be much larger because several optical depths hide their detail.
  // All levels remain actual 3D Gaussian primitives in the same density field.
  const spacing = (preset === 'bank' ? 0.40 : preset === 'storm' ? .34 : 0.30)/resolutionScale;
  const subdivisions = 4;
  // Conservative spatial bins avoid scanning every small billow for every
  // fine Gaussian cell. Bounds match the field's ellipsoidal support test.
  const binSize=2,binOrigin=min.map(x=>Math.floor(x/binSize)-2),binDims=max.map((x,i)=>Math.ceil(x/binSize)-binOrigin[i]+3);
  const bins=Array.from({length:binDims[0]*binDims[1]*binDims[2]},()=>[]);
  const binIndex=(x,y,z)=>(z*binDims[1]+y)*binDims[0]+x;
  for(const l of lobes) {
    const margin=1+l[8]/l[6];
    const lo=[0,1,2].map(i=>Math.max(0,Math.floor((l[i]-l[i+3]*margin)/binSize)-binOrigin[i]));
    const hi=[0,1,2].map(i=>Math.min(binDims[i]-1,Math.floor((l[i]+l[i+3]*margin)/binSize)-binOrigin[i]));
    for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++)bins[binIndex(x,y,z)].push(l);
  }
  const values = [],surfaceCandidates=new Map();
  const lighting=[],fineNormals=[],shapeGradient=[0,0,0,0],turbulenceGradient=[0,0,0],detailGradient=[0,0,0];
  let shapeOwner=-1;
  function shape(px, py, pz,gradient,turbulenceOffset=0) {
    let field = -100;
    shapeOwner=-1;
    if(gradient)gradient.fill(0);
    const bx=Math.floor(px/binSize)-binOrigin[0],by=Math.floor(py/binSize)-binOrigin[1],bz=Math.floor(pz/binSize)-binOrigin[2];
    if(bx<0||by<0||bz<0||bx>=binDims[0]||by>=binDims[1]||bz>=binDims[2])return field;
    for (const l of bins[binIndex(bx,by,bz)]) {
      const dx = (px - l[0]) / l[3], dy = (py - l[1]) / l[4], dz = (pz - l[2]) / l[5];
      const d2 = dx * dx + dy * dy + dz * dz;
      const radius=l[6];
      if(d2<l[9]) {
        const erosion=l[7],distance=Math.sqrt(d2),candidate=(1-distance)*radius+turbulenceOffset*erosion;
        if(candidate>field) {
          field=candidate;
          shapeOwner=l.id;
          if(gradient){const scale=-radius/Math.max(distance,1e-8);gradient[0]=scale*dx/l[3];gradient[1]=scale*dy/l[4];gradient[2]=scale*dz/l[5];gradient[3]=erosion;}
        }
      }
    }
    return field;
  }
  function sample(x, y, z, step) {
        const px = x + (rng() - 0.5) * step * 0.50;
        const py = y + (rng() - 0.5) * step * 0.50;
        const pz = z + (rng() - 0.5) * step * 0.50;
        const field = shape(px, py, pz,shapeGradient);
        if (field < -1.1) return;
        const ice=preset==='storm'?smoothstep(10.5,12.2,py):0;
        const stretch=mix(1,.23,ice);
        const turbulence = fbm(px * 1.48*stretch, py * 1.48, pz * 1.48, seed,turbulenceGradient);
        const detail = fbm(px * DETAIL_RELIEF.frequency*stretch, py * DETAIL_RELIEF.frequency, pz * DETAIL_RELIEF.frequency, seed + 17,detailGradient);
        // Chain rule includes the changing shear through the anvil transition.
        const iceT=clamp((py-10.5)/1.7,0,1),stretchY=preset==='storm'?-.77*6*iceT*(1-iceT)/1.7:0;
        turbulenceGradient[1]+=turbulenceGradient[0]*px*stretchY;
        detailGradient[1]+=detailGradient[0]*px*stretchY;
        turbulenceGradient[0]*=stretch;detailGradient[0]*=stretch;
        const edge=edgeProfileAt(preset,seed,px,py,pz);
        const coarseField=shape(px,py,pz,shapeGradient,turbulence-.55);
        const detailAmplitude=mix(DETAIL_RELIEF.crispAmplitude,DETAIL_RELIEF.diffuseAmplitude,edge.mixing)*mix(1,.35,ice)*mix(.4,1,smoothstep(.1,1.6,py));
        const eroded=coarseField+(detail-.5)*detailAmplitude;
        // Spend samples at the crisp condensation interface, not throughout
        // every opaque cell. A half-sized footprint preserves small torn tips.
        if(step>spacing/8+.001&&step<spacing/3&&edge.width<.18&&ice<.1&&py>.7&&eroded>-edge.width*.25-.04&&eroded<edge.width*.75+.04) {
          for(const oz of [-.25,.25])for(const oy of [-.25,.25])for(const ox of [-.25,.25])sample(x+ox*step,y+oy*step,z+oz*step,step/2);
          return;
        }
        let density = smoothstep(-edge.width*.25,edge.width*.75,eroded);
        // A common condensation level produces a comparatively quiet base;
        // its slow undulation prevents a visibly machined horizontal cut.
        const base=-.43+.18*(noise(px*.35,0,pz*.35,seed+131)-.5);
        density *= smoothstep(base-.17,base+.24,py);
        density *= mix(0.65, 1.20, turbulence);
        if (density < 0.008) return;
        const mixing=edge.mixing*(1-smoothstep(.25,.85,field));
        const sigma = step * mix(.63,.88,mixing);
        const sx = sigma * mix(0.9, 1.1, rng()) * mix(1,1.5,mixing);
        const sy = sigma * mix(0.85, 1.05, rng());
        const sz = sigma * mix(0.9, 1.1, rng()) * mix(1,1.15,mixing);
        // Mass normalization: integrated density per cell is independent of
        // Gaussian scale. Reconstruction across cell sizes is approximate.
        const amplitude = AUTHORING_DENSITY * density * step ** 3 / (GAUSSIAN_VOLUME * sx * sy * sz);
        values.push(px, py, pz, amplitude, sx, sy, sz, rng());
        // Filtered envelope gradient for a diffuse boundary approximation.
        // These four bytes affect source radiance only: all Gaussian centers,
        // covariances, amplitudes, random draws and extinction remain unchanged.
        const baseBlend=smoothstep(-.05,.45,py),detailScale=DETAIL_RELIEF.frequency*detailAmplitude*.20;
        // A second, finer envelope gradient changes shading only. Retain the
        // original filtered gradient as the stable large-scale boundary.
        const fine=shapeGradient.slice(0,3).map((v,i)=>-(v+shapeGradient[3]*1.48*turbulenceGradient[i]*.70+DETAIL_RELIEF.frequency*detailAmplitude*.80*detailGradient[i])*baseBlend);
        fine[1]-=1-baseBlend;
        const fineLength=Math.max(1e-8,Math.hypot(...fine));
        for(let i=0;i<3;i++)fineNormals.push(Math.round(127.5*(1+fine[i]/fineLength)));
        for(let i=0;i<3;i++)shapeGradient[i]=-(shapeGradient[i]+shapeGradient[3]*1.48*turbulenceGradient[i]*.45+detailScale*detailGradient[i])*baseBlend;
        shapeGradient[1]-=1-baseBlend;
        const length=Math.hypot(...shapeGradient),boundary=Math.exp(-Math.max(0,eroded)*.45)*(1-.5*mixing);
        for(let i=0;i<3;i++)lighting.push(Math.round(127.5*(1+shapeGradient[i]/Math.max(length,1e-8)*boundary)));
        const coarseDensity=smoothstep(-.25,.90,coarseField);
        lighting.push(Math.round(255*coarseDensity));
        if(surfaceDetail&&!lockedSurface&&py>.7&&ice<.1&&edge.mixing<.6&&step<=spacing/4&&eroded>0&&eroded<.10+edge.width*.5){
          const key=[px,py,pz].map(v=>Math.floor(v/SURFACE_DETAIL.cellSize)).join(',');
          const score=Math.abs(eroded-edge.width*.2),previous=surfaceCandidates.get(key);
          if(!previous||score<previous.score)surfaceCandidates.set(key,{index:values.length/8-1,mixing:edge.mixing,score,parentId:shapeOwner});
        }
  }
  for (let z = min[2]; z < max[2]; z += spacing) {
    for (let y = min[1]; y < max[1]; y += spacing) {
      for (let x = min[0]; x < max[0]; x += spacing) {
        const field = shape(x + spacing / 2, y + spacing / 2, z + spacing / 2);
        if (field < -1.5) continue;
        const cx=x+spacing/2,cy=y+spacing/2,cz=z+spacing/2;
        const stretch=preset==='storm'?mix(1,.23,smoothstep(10.5,12.2,cy)):1;
        const coarseErosion=fbm(cx*1.48*stretch,cy*1.48,cz*1.48,seed)-.55;
        const erodedCenter=shape(cx,cy,cz,null,coarseErosion);
        // A coarse Gaussian's tails must stay below the visible eroded shell.
        // Testing the un-eroded carrier alone can put large splats on the edge.
        if (erodedCenter > 1.1 && y > 0.6) {
          sample(x + spacing / 2, y + spacing / 2, z + spacing / 2, spacing);
        } else {
          const divisions=erodedCenter>.65&&y>.6?2:subdivisions;
          const step = spacing / divisions;
          for (let k = 0; k < divisions; k++) for (let j = 0; j < divisions; j++) for (let i = 0; i < divisions; i++) {
            sample(x + (i + 0.5) * step, y + (j + 0.5) * step, z + (k + 0.5) * step, step);
          }
        }
      }
    }
  }
  const surface=surfaceDetail?addSurfaceDetail(values,lighting,fineNormals,surfaceCandidates,seed,preset,lobes,{resolutionScale,lockedSurface}):{baseBodyCount:values.length/8,count:0,lobes:0,massFraction:0,structure:[]};
  const structure={lobes:lobes.map(l=>({id:l.id,parentId:l.parentId,rootId:l.rootId,level:l.level,kind:l.kind,center:l.slice(0,3),axes:l.slice(3,6)})),surface:surface.structure,wisps:plumes.map(p=>({parentId:p.parentId,origin:p.origin,length:p.length}))};
  delete surface.structure;
  const bodyCount=values.length/8;
  for(let i=surface.baseBodyCount*8;i<values.length;i+=8)for(let a=0;a<3;a++){
    min[a]=Math.min(min[a],values[i+a]-4*values[i+a+4]);max[a]=Math.max(max[a],values[i+a]+4*values[i+a+4]);
  }
  const wispRng=randomGenerator(seed^0x243f6a88),dx=.10/resolutionScale,dy=.065/resolutionScale,dz=.075/resolutionScale;
  const cellVolume=dx*dy*dz;
  for(const plume of plumes) {
    const {origin,outward,length,width,thickness,rise,phase,strength}=plume;
    for(let along=-.25;along<length;along+=dx) {
      const t=(along+.25)/(length+.25),taper=Math.pow(1-t,.65);
      const peel=.5*(1-Math.exp(-t*5));
      const centerY=origin[1]+rise*t+outward[1]*peel+Math.sin(t*Math.PI*2+phase)*.12*Math.sin(t*Math.PI);
      const centerZ=origin[2]+along*CLOUD_WIND[2]+outward[2]*peel+Math.sin(t*Math.PI)*Math.sin(phase)*.24;
      const ry=thickness*taper,rz=width*taper;
      if(ry<.022||rz<.025)continue;
      for(let oy=-ry*1.35;oy<ry*1.35;oy+=dy)for(let oz=-rz*1.35;oz<rz*1.35;oz+=dz) {
        const px=origin[0]+along+(wispRng()-.5)*dx*.4;
        const py=centerY+oy+(wispRng()-.5)*dy*.4,pz=centerZ+oz+(wispRng()-.5)*dz*.4;
        // Advected transverse turbulence tears holes into a tapered sheet.
        // The long coordinate varies slowly, so fragments share a direction.
        const turbulence=fbm(px*2.3+phase,py*2.9+Math.sin(px*1.6+phase)*.6,(pz-px*CLOUD_WIND[2])*3.3,seed+307);
        const radial=1-(oy/ry)**2-(oz/rz)**2;
        const shredded=smoothstep(-.15,.55,radial)*smoothstep(.47,.64,turbulence);
        const body=shape(px,py,pz),attachment=1-smoothstep(-.45,-.1,body);
        const density=.42*shredded*strength*Math.pow(1-t,1.1)*attachment;
        if(density<.012)continue;
        const sx=dx*.70,sy=dy*.68,sz=dz*.70;
        const amplitude=AUTHORING_DENSITY*density*cellVolume/(GAUSSIAN_VOLUME*sx*sy*sz);
        values.push(px,py,pz,amplitude,sx,sy,sz,wispRng());
        // Translucent shreds use volumetric scattering, without the opaque
        // dome's normal-based surface reflection approximation.
        lighting.push(128,128,128,Math.round(255*density*.25));
        fineNormals.push(128,128,128);
        for(let a=0;a<3;a++) {
          const center=[px,py,pz][a],sigma=[sx,sy,sz][a];
          min[a]=Math.min(min[a],center-4*sigma);max[a]=Math.max(max[a],center+4*sigma);
        }
      }
    }
  }
  const scene={ data: new Float32Array(values), lighting:new Uint8Array(lighting), count: values.length / 8, min, max, seed: seed >>> 0, preset, spacing, morphology:{bodyCount,wispCount:values.length/8-bodyCount,plumeCount:plumes.length,surface},structure };
  if(!bake)return scene;
  scene.detail=new Uint8Array(scene.count*12);
  for(let id=0;id<scene.count;id++)for(let a=0;a<3;a++)scene.detail[id*12+a]=fineNormals[id*3+a];
  if(!deferDetail)scene.detailBake=bakeLocalThickness(scene,scene.detail);
  return scene;
}
