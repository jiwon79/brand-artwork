// Resolution is an explicit setting. Zoom and automatic performance only
// change splat LOD; they never change the number of cloud or output pixels.
export const CLOUD_SAMPLING=Object.freeze({minimumScale:.25,defaultScale:1});
export function cloudResolution(width,height,scale=CLOUD_SAMPLING.defaultScale,view=0) {
  // Zero was the old automatic scale; keep old capture scripts valid at full resolution.
  if(view!==0||scale===0)scale=1;
  return [Math.max(1,Math.ceil(width*scale)),Math.max(1,Math.ceil(height*scale))];
}

// Cubic reconstruction preserves broad gradients without bilinear softening.
// Clamp to the local 2x2 range: cubic ringing must never invent negative light,
// transmittance outside [0,1], or a bright halo beyond a cloud boundary.
export const CLOUD_RECONSTRUCTION_GLSL=`
vec4 cloudReconstruct(sampler2D source,vec2 uv,vec2 outputSize) {
  ivec2 size=textureSize(source,0);
  if(all(equal(size,ivec2(outputSize))))return texelFetch(source,ivec2(gl_FragCoord.xy),0);
  vec2 p=uv*vec2(size)-.5,f=fract(p);ivec2 base=ivec2(floor(p));
  vec2 f2=f*f,f3=f2*f;
  vec2 w0=-.5*f+f2-.5*f3,w1=1.0-2.5*f2+1.5*f3;
  vec2 w2=.5*f+2.0*f2-1.5*f3,w3=-.5*f2+.5*f3;
  vec4 wx=vec4(w0.x,w1.x,w2.x,w3.x),wy=vec4(w0.y,w1.y,w2.y,w3.y);
  vec4 value=vec4(0.0),lo=vec4(1e30),hi=vec4(-1e30);
  for(int y=0;y<4;y++)for(int x=0;x<4;x++){
    vec4 v=texelFetch(source,clamp(base+ivec2(x-1,y-1),ivec2(0),size-1),0);
    value+=v*wx[x]*wy[y];
    if(x>=1&&x<=2&&y>=1&&y<=2){lo=min(lo,v);hi=max(hi,v);}
  }
  return clamp(value,lo,hi);
}`;
