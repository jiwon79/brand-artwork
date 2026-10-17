import { fullscreenVertex, bloomFragment, lensFragment } from './shaders.js';

export class CameraEffects {
  constructor(gl, compile) {
    this.gl=gl;
    this.bloom=compile(gl,fullscreenVertex,bloomFragment);
    this.lens=compile(gl,fullscreenVertex,lensFragment);
    this.image=this.target();
    this.levels=Array.from({length:5},()=>this.target());
  }
  target() {
    return {texture:this.gl.createTexture(),fbo:this.gl.createFramebuffer(),width:0,height:0};
  }
  resize(width,height) {
    const gl=this.gl;
    for(const [i,t] of [this.image,...this.levels].entries()) {
      const w=Math.max(1,Math.ceil(width/2**i)),h=Math.max(1,Math.ceil(height/2**i));
      if(t.width===w && t.height===h)continue;
      t.width=w;t.height=h;
      gl.bindTexture(gl.TEXTURE_2D,t.texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,w,h,0,gl.RGBA,gl.HALF_FLOAT,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Camera image buffers could not be created. Reload the renderer.');
    }
  }
  render(settings,hasDetail=true,detailScale=1) {
    const gl=this.gl, {width:w,height:h}=this.image;
    if(settings.glare>0) {
      gl.useProgram(this.bloom.id);
      this.bloom.uniform('uExposure',settings.exposure);
      let source=this.image;
      for(const [i,t] of this.levels.entries()) {
        gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);gl.viewport(0,0,t.width,t.height);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source.texture);this.bloom.integer('uSource',0);
        this.bloom.integer('uPrefilter',i===0?1:0);this.bloom.uniform('uOutputSize',[t.width,t.height]);
        gl.drawArrays(gl.TRIANGLES,0,3);source=t;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);gl.useProgram(this.lens.id);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.image.texture);this.lens.integer('uImage',0);
    for(const [i,t] of this.levels.entries()) {
      gl.activeTexture(gl.TEXTURE1+i);gl.bindTexture(gl.TEXTURE_2D,t.texture);this.lens.integer(`uBloom${i}`,i+1);
    }
    this.lens.uniform('uResolution',[w,h]);
    for(const name of ['exposure','glare','vignette','aberration'])this.lens.uniform(`u${name[0].toUpperCase()+name.slice(1)}`,settings[name]);
    const detailed=hasDetail&&(settings.view??0)===0&&(settings.localShadowStrength>0||settings.fineShadingStrength>0);
    this.lens.uniform('uDetailCrispness',detailed?(settings.detailCrispness??0):0);
    this.lens.uniform('uDetailScale',detailScale);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  dispose() {
    const gl=this.gl;
    for(const t of [this.image,...this.levels]){gl.deleteFramebuffer(t.fbo);gl.deleteTexture(t.texture);}
    gl.deleteProgram(this.bloom.id);gl.deleteProgram(this.lens.id);
  }
}
