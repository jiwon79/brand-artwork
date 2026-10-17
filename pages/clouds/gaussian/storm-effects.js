import {fullscreenVertex,CAMERA_GLSL} from './shaders.js';
import {STORM,lightningState,lightningFrame} from './storm.js';
import {createLightningChannel} from './lightning-channel.js';
import {CLOUD_RECONSTRUCTION_GLSL} from './cloud-resolution.js';
import {SINGLE_CLOUD} from './cloud-instances.js';

const vector=v=>`vec3(${v.map(n=>n.toFixed(4)).join(',')})`;
const cacheFragment=`#version 300 es
precision highp float;
uniform sampler2D uResponse;
uniform vec2 uResolution;
out vec4 color;
${CLOUD_RECONSTRUCTION_GLSL}
void main(){color=cloudReconstruct(uResponse,gl_FragCoord.xy/uResolution,uResolution);}`;

const channelVertex=`#version 300 es
precision highp float;
layout(location=0) in vec3 aStart;
layout(location=1) in vec3 aEnd;
layout(location=2) in vec2 aCorner;
layout(location=3) in vec3 aStyle;
uniform vec3 uEye,uRight,uUp,uForward;
uniform vec2 uResolution,uLensShift;
uniform float uTanFov,uAspect;
flat out vec3 vStart,vEnd,vStyle;
vec3 viewPoint(vec3 p){vec3 d=p-uEye;return vec3(dot(d,uRight),dot(d,uUp),dot(d,uForward));}
void main(){
 vStart=aStart;vEnd=aEnd;vStyle=aStyle;
 vec3 a=viewPoint(aStart),b=viewPoint(aEnd);
 if(max(a.z,b.z)<.03){gl_Position=vec4(2.0,2.0,0.0,1.0);return;}
 // A near-plane crossing can cover the whole view; the fragment ray test
 // still rejects every pixel outside the actual thin channel.
 if(min(a.z,b.z)<.03+4.0*aStyle.x){gl_Position=vec4(aCorner.x*2.0-1.0,aCorner.y,0.0,1.0);return;}
 vec2 pa=(a.xy/(a.z*uTanFov*vec2(uAspect,1.0))-uLensShift)*uResolution*.5;
 vec2 pb=(b.xy/(b.z*uTanFov*vec2(uAspect,1.0))-uLensShift)*uResolution*.5;
 vec2 delta=pb-pa;float length2=dot(delta,delta);
 vec2 direction=length2>.0001?delta*inversesqrt(length2):vec2(1.0,0.0);
 float support=4.0*aStyle.x;
 float offAxis=1.0+max(length(a.xy)/a.z,length(b.xy)/b.z);
 float pad=2.4+support*uResolution.y*offAxis/(2.0*uTanFov*(min(a.z,b.z)-support));
 vec2 pos=mix(pa,pb,aCorner.x)+direction*mix(-pad,pad,aCorner.x)+vec2(-direction.y,direction.x)*aCorner.y*pad;
 gl_Position=vec4(pos*2.0/uResolution,0.0,1.0);
}`;
const channelFragment=`#version 300 es
precision highp float;
precision highp sampler3D;
${CAMERA_GLSL}
flat in vec3 vStart,vEnd,vStyle;
uniform sampler3D uCloudDensity;
uniform vec3 uGridOrigin,uGridSize;
uniform float uCellSize,uDensity;
out vec4 color;
float transmission(vec3 ray,float end){
 vec3 reciprocal=mix(vec3(-1.0),vec3(1.0),step(vec3(0.0),ray))/max(abs(ray),vec3(.0000001));
 vec3 a=(uGridOrigin-uEye)*reciprocal,b=(uGridOrigin+(uGridSize-1.0)*uCellSize-uEye)*reciprocal;
 vec3 lo=min(a,b),hi=max(a,b);
 float start=max(0.0,max(lo.x,max(lo.y,lo.z))),finish=min(end,min(hi.x,min(hi.y,hi.z)));
 if(finish<=start)return 1.0;
 float count=clamp(ceil((finish-start)/(uCellSize*1.5)),8.0,64.0),stepLength=(finish-start)/count,tau=0.0;
 for(int i=0;i<64;i++){
  if(float(i)>=count)break;
  vec3 p=uEye+ray*(start+(float(i)+.5)*stepLength);
  vec3 uv=((p-uGridOrigin)/uCellSize+.5)/uGridSize;
  tau+=texture(uCloudDensity,uv).r*stepLength*uDensity;
  if(tau>12.0)return 0.0;
 }
 return exp(-tau);
}
void main(){
 vec3 ray=cameraRay(),ab=vEnd-vStart,w=uEye-vStart;
 float projection=dot(ray,ab),length2=dot(ab,ab);
 float along=clamp((dot(ab,w)-projection*dot(ray,w))/max(.0000001,length2-projection*projection),0.0,1.0);
 vec3 p=vStart+ab*along;float distance=dot(p-uEye,ray);
 if(distance<=0.0)discard;
 vec3 delta=p-uEye-ray*distance;
 float pixelRadius=distance*2.0*uTanFov/uResolution.y*.35;
 float radius2=vStyle.x*vStyle.x+pixelRadius*pixelRadius;
 float d2=dot(delta,delta)/radius2;
 if(d2>16.0)discard;
 // Preserve subpixel channel energy. The ordinary camera bloom supplies the
 // optical halo; there is no second, oversized glow tube around the bolt.
 float intensity=${STORM.boltRadiance.toFixed(1)}*vStyle.y*vStyle.x/sqrt(radius2)*exp(-.5*d2)*transmission(ray,distance);
 color=vec4(intensity*(1.0-vStyle.z),intensity*vStyle.z,0.0,0.0);
}`;
const compositeFragment=`#version 300 es
precision highp float;
uniform sampler2D uBase,uLightning,uBolt;
uniform vec3 uFlash;
uniform vec2 uBoltFlash;
out vec4 color;
void main(){
 ivec2 p=ivec2(gl_FragCoord.xy);vec4 base=texelFetch(uBase,p,0);
 vec3 light=texelFetch(uLightning,p,0).rgb;vec2 bolt=texelFetch(uBolt,p,0).rg;
 vec3 radiance=base.rgb;
 ${STORM.lights.map((light,i)=>`radiance+=${vector(light.color)}*light[${i}]*uFlash[${i}];`).join('\n')}
 radiance+=vec3(.94,.95,1.0)*dot(bolt,uBoltFlash);
 color=vec4(radiance,base.a);
}`;

// Three scalar cloud-light responses are accumulated once. The thin channel
// has its own small-footprint raster pass, rebuilt on view invalidation or a new path.
export class StormEffects {
  constructor(gl,compile,grid,seed=STORM.channelSeed) {
    if(!grid?.data||!grid.dims||grid.dims.length!==3)throw new Error('The storm is missing its density field. Regenerate the cloud.');
    this.gl=gl;this.grid=grid;this.seed=seed;this.time=0;this.started=false;this.samples=0;this.width=0;this.height=0;
    this.boltBuilds=0;this.boltDirty=true;this.channelCycle=null;
    this.sample={texture:gl.createTexture()};
    this.history={texture:gl.createTexture(),fbo:gl.createFramebuffer()};
    this.bolt={texture:gl.createTexture(),fbo:gl.createFramebuffer()};
    this.densityTexture=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D,this.densityTexture);gl.texImage3D(gl.TEXTURE_3D,0,gl.R16F,...grid.dims,0,gl.RED,gl.FLOAT,grid.data);
    for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_3D,name,gl.LINEAR);
    for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,name,gl.CLAMP_TO_EDGE);
    this.fullscreenVAO=gl.createVertexArray();this.channelVAO=gl.createVertexArray();this.channelBuffer=gl.createBuffer();
    gl.bindVertexArray(this.channelVAO);gl.bindBuffer(gl.ARRAY_BUFFER,this.channelBuffer);
    for(const [index,size,offset] of [[0,3,0],[1,3,3],[2,2,6],[3,3,8]]){gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,44,offset*4)}
    gl.bindVertexArray(null);
    this.cacheProgram=compile(gl,fullscreenVertex,cacheFragment);
    this.channelProgram=compile(gl,channelVertex,channelFragment);
    this.compositeProgram=compile(gl,fullscreenVertex,compositeFragment);
  }
  get amplitudes(){return lightningState(this.time);}
  advance(dt){const previous=lightningFrame(this.time);this.time+=dt;const next=lightningFrame(this.time);return next.amplitudes.some((v,i)=>v!==previous.amplitudes[i])||next.branches!==previous.branches;}
  reset(){this.samples=0;this.boltDirty=true;}
  resize(width,height,sampleWidth=width,sampleHeight=height){
    if(width===this.width&&height===this.height&&sampleWidth===this.sampleWidth&&sampleHeight===this.sampleHeight)return;
    this.width=width;this.height=height;this.sampleWidth=sampleWidth;this.sampleHeight=sampleHeight;this.reset();const g=this.gl;
    for(const t of [this.sample,this.history,this.bolt]){
      const w=t===this.sample?sampleWidth:width,h=t===this.sample?sampleHeight:height;
      if(t.width===w&&t.height===h)continue;
      t.width=w;t.height=h;
      g.bindTexture(g.TEXTURE_2D,t.texture);g.texImage2D(g.TEXTURE_2D,0,t===this.bolt?g.RG16F:g.RGBA16F,w,h,0,t===this.bolt?g.RG:g.RGBA,g.HALF_FLOAT,null);
      for(const name of [g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,name,g.NEAREST);
      for(const name of [g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T])g.texParameteri(g.TEXTURE_2D,name,g.CLAMP_TO_EDGE);
      if(t.fbo){g.bindFramebuffer(g.FRAMEBUFFER,t.fbo);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,t.texture,0);if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new Error('Lightning image buffers are unavailable.');g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT)}
    }
  }
  add(sampleIndex,setCamera,density,instances=SINGLE_CLOUD){
    this.setCamera=setCamera;this.density=density;this.instances=instances;
    const g=this.gl,p=this.cacheProgram;
    g.bindFramebuffer(g.FRAMEBUFFER,this.history.fbo);g.viewport(0,0,this.width,this.height);g.disable(g.DEPTH_TEST);g.bindVertexArray(this.fullscreenVAO);g.useProgram(p.id);
    g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.sample.texture);p.integer('uResponse',0);
    p.uniform('uResolution',[this.width,this.height]);
    g.enable(g.BLEND);g.blendColor(0,0,0,1/(sampleIndex+1));g.blendFunc(g.CONSTANT_ALPHA,g.ONE_MINUS_CONSTANT_ALPHA);
    g.drawArrays(g.TRIANGLES,0,3);g.disable(g.BLEND);this.samples=sampleIndex+1;
  }
  renderBolt(cycle){
    const g=this.gl,p=this.channelProgram;
    if(this.channelCycle!==cycle){
      const channel=createLightningChannel(this.seed^Math.imul(cycle+1,198491317)),values=[];
      for(const s of channel.segments)for(const corner of [[0,-1],[1,-1],[1,1],[0,-1],[1,1],[0,1]])values.push(...s.a,...s.b,...corner,s.radius,s.energy,s.branch?1:0);
      const data=new Float32Array(values);this.channelVertices=data.length/11;
      g.bindBuffer(g.ARRAY_BUFFER,this.channelBuffer);g.bufferData(g.ARRAY_BUFFER,data,g.STATIC_DRAW);this.channelCycle=cycle;
    }
    g.bindFramebuffer(g.FRAMEBUFFER,this.bolt.fbo);g.viewport(0,0,this.width,this.height);g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);g.disable(g.DEPTH_TEST);
    g.bindVertexArray(this.channelVAO);g.useProgram(p.id);p.uniform('uPixelJitter',[0,0]);p.uniform('uDensity',this.density);
    p.uniform('uGridOrigin',this.grid.origin);p.uniform('uGridSize',this.grid.dims);p.uniform('uCellSize',this.grid.cellSize);
    g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_3D,this.densityTexture);p.integer('uCloudDensity',0);
    g.enable(g.BLEND);g.blendEquation(g.MAX);g.blendFunc(g.ONE,g.ONE);
    for(const offset of this.instances||SINGLE_CLOUD){this.setCamera(p,offset);p.uniform('uPixelJitter',[0,0]);g.drawArrays(g.TRIANGLES,0,this.channelVertices);}
    g.blendEquation(g.FUNC_ADD);g.disable(g.BLEND);
    this.boltDirty=false;this.boltBuilds++;
  }
  compose(base,target){
    const frame=lightningFrame(this.time);
    if(frame.core>0&&(this.boltDirty||this.channelCycle!==frame.cycle))this.renderBolt(frame.cycle);
    const g=this.gl,p=this.compositeProgram;
    g.bindFramebuffer(g.FRAMEBUFFER,target.fbo);g.viewport(0,0,this.width,this.height);g.disable(g.BLEND);g.disable(g.DEPTH_TEST);g.bindVertexArray(this.fullscreenVAO);g.useProgram(p.id);
    for(const [unit,texture,name]of [[0,base.texture,'uBase'],[1,this.history.texture,'uLightning'],[2,this.bolt.texture,'uBolt']]){g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,texture);p.integer(name,unit)}
    p.uniform('uFlash',frame.amplitudes);p.uniform('uBoltFlash',[frame.core,frame.branches]);g.drawArrays(g.TRIANGLES,0,3);
  }
  dispose(){
    const g=this.gl;for(const t of [this.sample,this.history,this.bolt]){g.deleteTexture(t.texture);if(t.fbo)g.deleteFramebuffer(t.fbo)}
    g.deleteTexture(this.densityTexture);g.deleteBuffer(this.channelBuffer);g.deleteVertexArray(this.channelVAO);g.deleteVertexArray(this.fullscreenVAO);
    for(const p of [this.cacheProgram,this.channelProgram,this.compositeProgram])g.deleteProgram(p.id);
  }
}
