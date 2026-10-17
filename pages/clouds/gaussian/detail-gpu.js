import {DETAIL_BAKE,createDetailDensity,bakeLocalThickness} from './detail.js';
const WORKGROUP=128,MAX_GPU_BYTES=128*1024*1024;
const header=`struct Params { dims:vec4<u32>, sizes:vec4<u32>, origin:vec4<f32> };\n@group(0) @binding(0) var<uniform> p:Params;\nfn indexOf(g:vec3<u32>)->u32{return g.x+g.y*p.sizes.w;}\n`;
const filterCode=header+`
@group(0) @binding(1) var<storage,read> src:array<f32>;
@group(0) @binding(2) var<storage,read_write> dst:array<f32>;
@compute @workgroup_size(${WORKGROUP}) fn main(@builtin(global_invocation_id) g:vec3<u32>){
 let i=indexOf(g);if(i>=p.sizes.x){return;}let x=i%p.dims.x;let y=(i/p.dims.x)%p.dims.y;let z=i/(p.dims.x*p.dims.y);
 if(x==0u||y==0u||z==0u||x+1u>=p.dims.x||y+1u>=p.dims.y||z+1u>=p.dims.z){dst[i]=0.0;return;}
 let stride=p.sizes.z;dst[i]=0.25*src[i-stride]+0.5*src[i]+0.25*src[i+stride];
}`;
const tauCode=header+`
@group(0) @binding(1) var<storage,read> density:array<f32>;
@group(0) @binding(2) var<storage,read_write> tau:array<f32>;
@compute @workgroup_size(${WORKGROUP}) fn main(@builtin(global_invocation_id) g:vec3<u32>){
 let i=indexOf(g);if(i>=p.sizes.x){return;}
 let coordinates=vec3<i32>(i32(i%p.dims.x),i32((i/p.dims.x)%p.dims.y),i32(i/(p.dims.x*p.dims.y)));
 let strides=array<u32,3>(1u,p.dims.x,p.dims.x*p.dims.y);
 for(var axis=0u;axis<3u;axis++){for(var sign=0u;sign<2u;sign++){
  let direction=select(1,-1,sign==1u);var value=0.5*density[i];
  for(var k=1u;k<=p.sizes.y;k++){
   let coordinate=coordinates[axis]+direction*i32(k);if(coordinate<0||coordinate>=i32(p.dims[axis])){break;}
   let at=u32(i32(i)+i32(strides[axis])*direction*i32(k));value+=select(1.0,0.5,k==p.sizes.y)*density[at];
  }
  tau[i*6u+sign*3u+axis]=min(${DETAIL_BAKE.maxTau.toFixed(8)},value*p.origin.w);
 }}
}`;
const sampleCode=header+`
@group(0) @binding(1) var<storage,read> splats:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> tau:array<f32>;
@group(0) @binding(3) var<storage,read_write> packed:array<vec2<u32>>;
@compute @workgroup_size(${WORKGROUP}) fn main(@builtin(global_invocation_id) g:vec3<u32>){
 let id=indexOf(g);if(id>=p.dims.w){return;}
 let position=(splats[id*2u].xyz-p.origin.xyz)/p.origin.w;let cell=vec3<u32>(floor(position));let fraction=position-vec3<f32>(cell);
 var values:array<u32,6>;
 for(var axis=0u;axis<6u;axis++){
  var value=0.0;
  for(var dz=0u;dz<2u;dz++){for(var dy=0u;dy<2u;dy++){for(var dx=0u;dx<2u;dx++){
   let at=((cell.z+dz)*p.dims.y+(cell.y+dy))*p.dims.x+cell.x+dx;
   let weight=select(1.0-fraction.x,fraction.x,dx==1u)*select(1.0-fraction.y,fraction.y,dy==1u)*select(1.0-fraction.z,fraction.z,dz==1u);
   value+=tau[at*6u+axis]*weight;
  }}}
  values[axis]=u32(floor(clamp(value*(255.0/${DETAIL_BAKE.maxTau.toFixed(8)}),0.0,255.0)+0.5));
 }
 packed[id]=vec2<u32>(values[0]|(values[1]<<8u)|(values[2]<<16u),values[3]|(values[4]<<8u)|(values[5]<<16u));
}`;
const timed=async(promise,ms,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms)})])}finally{clearTimeout(timer)}};
export async function createGPUDetailBaker(gpu=globalThis.navigator?.gpu){
 if(!gpu)return null;const started=performance.now(),adapter=await timed(gpu.requestAdapter(),2000,'GPU adapter');if(!adapter)return null;
 let abandoned=false;const requested=adapter.requestDevice();requested.then(device=>{if(abandoned)device.destroy();},()=>{});
 let device;try{device=await timed(requested,2000,'GPU device');}catch(error){abandoned=true;throw error;}
 const errors=[];let disposed=false,lost=false;device.lost.then(()=>{lost=true;});
 device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
 try{
  const pipelines=await Promise.all([filterCode,tauCode,sampleCode].map(async(code,i)=>{const module=device.createShaderModule({label:'cloud-detail-'+i,code});return timed(device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}}),2000,'GPU detail compilation');}));
  return {
   initMs:performance.now()-started,limits:{maxStorageBufferBindingSize:device.limits.maxStorageBufferBindingSize,maxBufferSize:device.limits.maxBufferSize},errors,
   async bake(scene,detail){
    if(disposed||lost||scene.preset==='storm'||!scene.count||scene.data.byteLength>device.limits.maxStorageBufferBindingSize||scene.data.byteLength+scene.count*16>MAX_GPU_BYTES)return null;
    if(!(detail instanceof Uint8Array)||detail.length!==scene.count*12)throw new Error('Invalid cloud detail attributes.');
    const start=performance.now(),grid=createDetailDensity(scene),{density,dims,origin,cellSize:h}=grid,size=density.length,count=scene.count;
    const bytes=scene.data.byteLength+size*4*2+size*6*4+count*8*2;
    if(bytes>MAX_GPU_BYTES||Math.max(size*6*4,count*8)>device.limits.maxStorageBufferBindingSize)return null;
    const deposited=performance.now(),owned=[];let mapped,scopeOpen=false;
    const buffer=(size,usage,data)=>{const b=device.createBuffer({size:Math.max(4,size),usage,mappedAtCreation:!!data});owned.push(b);if(data){new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));b.unmap();}return b;};
    const shape=length=>{const groups=Math.ceil(length/WORKGROUP),x=Math.min(groups,device.limits.maxComputeWorkgroupsPerDimension);return [x,Math.ceil(groups/x)];};
    const params=(stride,length)=>{const a=new ArrayBuffer(48),u=new Uint32Array(a),f=new Float32Array(a);u.set([...dims,count,size,Math.max(1,Math.round(DETAIL_BAKE.range/h)),stride,shape(length)[0]*WORKGROUP]);f.set([...origin,h],8);return buffer(a.byteLength,GPUBufferUsage.UNIFORM,new Uint8Array(a));};
    try{
     device.pushErrorScope('validation');scopeOpen=true;
     const a=buffer(size*4,GPUBufferUsage.STORAGE,density),b=buffer(size*4,GPUBufferUsage.STORAGE),tau=buffer(size*6*4,GPUBufferUsage.STORAGE),splats=buffer(scene.data.byteLength,GPUBufferUsage.STORAGE,scene.data),packed=buffer(count*8,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),readback=buffer(count*8,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
     const encoder=device.createCommandEncoder(),dispatch=(pipeline,bindings,length)=>{const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:bindings.map((b,binding)=>({binding,resource:{buffer:b}}))}));pass.dispatchWorkgroups(...shape(length));pass.end();};
     for(let axis=0;axis<3;axis++)dispatch(pipelines[0],[params([1,dims[0],dims[0]*dims[1]][axis],size),axis%2?b:a,axis%2?a:b],size);
     dispatch(pipelines[1],[params(0,size),b,tau],size);dispatch(pipelines[2],[params(0,count),splats,tau,packed],count);encoder.copyBufferToBuffer(packed,0,readback,0,count*8);
     const submitted=performance.now();device.queue.submit([encoder.finish()]);await timed(readback.mapAsync(GPUMapMode.READ),3000,'GPU detail readback');mapped=readback;
     const completed=performance.now(),input=new Uint32Array(readback.getMappedRange());
     if(detail.byteOffset%4===0){const out=new Uint32Array(detail.buffer,detail.byteOffset,detail.length/4);for(let i=0;i<count;i++){out[i*3+1]=input[i*2];out[i*3+2]=input[i*2+1];}}
     else {for(let i=0;i<count;i++)for(let j=0;j<2;j++){const v=input[i*2+j];detail[i*12+4+j*4]=v&255;detail[i*12+5+j*4]=(v>>>8)&255;detail[i*12+6+j*4]=(v>>>16)&255;detail[i*12+7+j*4]=0;}}
     readback.unmap();mapped=null;const validation=await device.popErrorScope();scopeOpen=false;if(validation)throw new Error(validation.message);if(errors.length)throw new Error(errors.join('\n'));
     return {cellSize:h,range:Math.max(1,Math.round(DETAIL_BAKE.range/h))*h,grid:dims,milliseconds:performance.now()-start,method:'webgpu',gpuBytes:bytes,depositMs:deposited-start,setupMs:submitted-deposited,dispatchAndReadbackMs:completed-submitted,unpackMs:performance.now()-completed};
    }finally{if(mapped)mapped.unmap();for(const b of owned)b.destroy();if(scopeOpen)await device.popErrorScope().catch(()=>null);}
   },
   dispose(){if(!disposed){disposed=true;device.destroy();}}
  };
 }catch(error){device.destroy();throw error;}
}
export async function bakeWithGPUFallback(scene,detail,baker){
 if(baker){try{const result=await baker.bake(scene,detail);if(result)return result;}catch(error){baker.dispose?.();return {...bakeLocalThickness(scene,detail),method:'cpu',gpuFailure:error.message};}}
 return {...bakeLocalThickness(scene,detail),method:'cpu'};
}
