import {fullscreenVertex,rayTermsFragment} from './shaders.js';

// Ray terms use the supported precision and are shared by every splat. No temporal
// filtering here: the cache is regenerated for each sample's exact pixel jitter.
export class RayTerms {
  constructor(gl,compile,capabilities) {
    this.gl=gl;this.capabilities=capabilities;this.program=compile(gl,fullscreenVertex,rayTermsFragment);
    this.fbo=gl.createFramebuffer();this.textures=[gl.createTexture(),gl.createTexture()];
  }
  resize(width,height) {
    if(this.width===width&&this.height===height)return;
    this.width=width;this.height=height;const gl=this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);
    this.textures.forEach((texture,i)=>{
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,this.capabilities.imageFormat,width,height,0,gl.RGBA,this.capabilities.imageType,null);
      for(const axis of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,axis,gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,texture,0);
    });
    gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Shared camera lighting could not be allocated.');
  }
  render(width,height,uniforms) {
    const gl=this.gl;this.resize(width,height);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);gl.viewport(0,0,width,height);
    gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.useProgram(this.program.id);uniforms(this.program);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  bind(program) {
    const gl=this.gl;
    ['uRayAngular','uRaySky'].forEach((name,i)=>{gl.activeTexture(gl.TEXTURE7+i);gl.bindTexture(gl.TEXTURE_2D,this.textures[i]);program.integer(name,7+i)});
  }
  dispose() {
    const gl=this.gl;this.textures.forEach(t=>gl.deleteTexture(t));gl.deleteFramebuffer(this.fbo);gl.deleteProgram(this.program.id);
  }
}
