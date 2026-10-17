import {fullscreenVertex} from './shaders.js';
import {SampleHistory} from './sampling.js';

// Keep small rounding remainders out of half-float's low-precision subnormals.
const RESIDUAL_SCALE=1024;
const averageFragment=half=>`#version 300 es
precision highp float;
uniform sampler2D uSample,uHistory;
uniform int uCount;
layout(location=0) out vec4 color;
${half?`uniform sampler2D uResidual;
layout(location=1) out vec4 residual;
vec4 halfRound(vec4 value) {
  return vec4(unpackHalf2x16(packHalf2x16(value.xy)),unpackHalf2x16(packHalf2x16(value.zw)));
}`:''}
void main() {
  ivec2 pixel=ivec2(gl_FragCoord.xy);
  vec4 sampleColor=texelFetch(uSample,pixel,0);
  vec4 mean=sampleColor;
  ${half?'vec4 anchor=sampleColor,remainder=vec4(0.0);':''}
  if(uCount>0) {
    vec4 previous=texelFetch(uHistory,pixel,0);
    ${half?`anchor=previous;
    remainder=texelFetch(uResidual,pixel,0)/${RESIDUAL_SCALE.toFixed(1)};
    remainder+=(sampleColor-previous-remainder)/float(uCount+1);
    mean=anchor+remainder;`:'mean=previous+(sampleColor-previous)/float(uCount+1);'}
  }
  // Preserve mean transmittance alongside HDR radiance, so cloud-only camera
  // reconstruction uses the same temporal coverage as the displayed image.
  ${half?`// Store the rounding remainder separately so late samples still
  // contribute after thousands of half-float history updates.
  color=halfRound(mean);
  // Explicit rounding also prevents a compiler from reassociating the small
  // remainder back into the large mean, losing the correction prematurely.
  residual=halfRound((halfRound(anchor-color)+remainder)*${RESIDUAL_SCALE.toFixed(1)});`:'color=mean;'}
}`;

export class TemporalAccumulator extends SampleHistory {
  constructor(gl,compile,capabilities) {
    super();this.gl=gl;this.half=capabilities.imagePrecision===16;this.residualScale=this.half?RESIDUAL_SCALE:1;
    this.program=compile(gl,fullscreenVertex,averageFragment(this.half));
    this.targets=Array.from({length:2},()=>({texture:gl.createTexture(),fbo:gl.createFramebuffer(),residual:this.half?gl.createTexture():null}));
    this.index=0;this.capabilities=capabilities;
  }
  get current() { return this.targets[this.index]; }
  resize(width,height) {
    if(this.width===width && this.height===height)return;
    this.width=width;this.height=height;this.setKey(null);
    const gl=this.gl;
    for(const t of this.targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);
      for(const [i,texture] of (this.half?[t.texture,t.residual]:[t.texture]).entries()) {
        gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texImage2D(gl.TEXTURE_2D,0,this.capabilities.imageFormat,width,height,0,gl.RGBA,this.capabilities.imageType,null);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,texture,0);
      }
      gl.drawBuffers(this.half?[gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]:[gl.COLOR_ATTACHMENT0]);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('The sample accumulation buffers could not be created.');
    }
  }
  add(sample) {
    const gl=this.gl,p=this.program,next=1-this.index;
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[next].fbo);gl.viewport(0,0,this.width,this.height);
    gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.useProgram(p.id);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,sample.texture);p.integer('uSample',0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.current.texture);p.integer('uHistory',1);
    if(this.half){gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.current.residual);p.integer('uResidual',2);}
    p.integer('uCount',this.count);gl.drawArrays(gl.TRIANGLES,0,3);
    this.index=next;this.count++;
  }
  present(target) {
    const gl=this.gl,w=this.width,h=this.height;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.current.fbo);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,target.fbo);
    gl.blitFramebuffer(0,0,w,h,0,0,w,h,gl.COLOR_BUFFER_BIT,gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);
  }
  dispose() {
    const gl=this.gl;
    for(const t of this.targets){gl.deleteTexture(t.texture);if(t.residual)gl.deleteTexture(t.residual);gl.deleteFramebuffer(t.fbo);}
    gl.deleteProgram(this.program.id);
  }
}
