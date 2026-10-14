import { MIN, EXTENT, SHADOW_STEP, SHADOW_STEPS } from './volume';
export const vertex = `#version 300 es
void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;
const volume = `
const vec3 boxMin=vec3(${MIN.map(n => n.toFixed(2)).join(',')});
const vec3 boxSize=vec3(${EXTENT.map(n => n.toFixed(2)).join(',')});
uniform highp sampler3D uDensity;
float density(vec3 p){vec3 uv=(p-boxMin)/boxSize; if(any(lessThan(uv,vec3(0)))||any(greaterThan(uv,vec3(1))))return 0.0; return texture(uDensity,uv).r;}
`;
export const shadowFragment = `#version 300 es
precision highp float;
${volume}
uniform vec3 uSun,uSize;
uniform float uLayer;
out vec4 result;
void main(){
 vec3 p=boxMin+vec3(gl_FragCoord.xy,uLayer+0.5)/uSize*boxSize;
 float tau=0.0;
 for(int i=0;i<${SHADOW_STEPS};i++){
  vec3 q=p+uSun*(float(i)+0.5)*${SHADOW_STEP.toFixed(3)};
  vec3 uv=(q-boxMin)/boxSize;
  if(any(lessThan(uv,vec3(0)))||any(greaterThan(uv,vec3(1))))break;
  tau+=density(q)*${SHADOW_STEP.toFixed(3)}; if(tau>8.0)break;
 }
 result=vec4(exp(-tau),0,0,1);
}`;
export const cloudFragment = `#version 300 es
precision highp float;
${volume}
uniform highp sampler3D uShadow;
uniform vec3 uEye,uRight,uUp,uForward,uSun;
uniform vec2 uSize,uJitter;
uniform float uAspect,uAmount,uNight,uFlash,uLensShift,uTanFov;
uniform int uSteps,uSample;
out vec4 result;
float phase(float c,float g){return (1.0-g*g)/pow(max(0.05,1.0+g*g-2.0*g*c),1.5);}
vec3 sunColor(){return mix(vec3(1.0,0.35,0.12),vec3(1.0,0.97,0.9),smoothstep(0.08,0.6,uSun.y));}
vec3 sky(vec3 ray){
 float day=smoothstep(0.03,0.48,uSun.y),h=exp(-max(ray.y+0.08,0.0)*4.5);
 vec3 top=mix(vec3(0.06,0.09,0.19),vec3(0.065,0.20,0.43),day);
 vec3 horizon=mix(vec3(0.58,0.23,0.13),vec3(0.45,0.64,0.76),day);
 vec3 c=mix(top,horizon,h*0.85);
 float mu=max(0.0,dot(ray,uSun));
 c+=sunColor()*(pow(mu,32.0)*0.13+pow(mu,256.0)*0.2);
 c=mix(c,vec3(0.25,0.34,0.4),1.0-smoothstep(-0.18,-0.06,ray.y));
 return mix(c,vec3(0.004,0.009,0.024)*(0.7+0.8*h),uNight);
}
float segmentDistance(vec3 p,vec3 a,vec3 b){vec3 d=b-a;return length(p-a-d*clamp(dot(p-a,d)/dot(d,d),0.0,1.0));}
float channel(vec3 p){
 float d=100.0;
 vec3 a=vec3(0.1,12.5,-0.8);
 for(int i=0;i<9;i++){
  float k=float(i+1);vec3 b=vec3(sin(k*2.7)*0.6,12.5-k*1.3,-0.8+cos(k*3.1)*0.25);
  d=min(d,segmentDistance(p,a,b));a=b;
 }
 return d;
}
void main(){
 vec2 uv=(gl_FragCoord.xy+uJitter)/uSize*2.0-1.0+vec2(uLensShift,0.0);
 vec3 ray=normalize(uForward+uRight*uv.x*uAspect*uTanFov+uUp*uv.y*uTanFov);
 vec3 inv=1.0/ray, a=(boxMin-uEye)*inv,b=(boxMin+boxSize-uEye)*inv;
 vec3 near=min(a,b),far=max(a,b);
 float entry=max(0.0,max(near.x,max(near.y,near.z))),exit=min(far.x,min(far.y,far.z));
 vec3 background=sky(ray);
 float mu=dot(ray,uSun);
 if(uNight<0.5)background+=sunColor()*6.0*smoothstep(0.99994,0.99998,mu);
 if(exit<=entry){result=vec4(background,1);return;}
 float dt=(exit-entry)/float(uSteps), transmission=1.0;
 vec3 light=vec3(0);
 float rotation=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453+float(uSample)*0.61803399);
 float forward=0.18*phase(mu,0.65)+0.82;
 for(int i=0;i<160;i++){
  if(i>=uSteps||transmission<0.008)break;
  vec3 p=uEye+ray*(entry+(float(i)+rotation)*dt);
  float rho=density(p);
  if(rho<0.006)continue;
  float alpha=1.0-exp(-rho*uAmount*dt);
  float access=pow(max(0.0003,texture(uShadow,(p-boxMin)/boxSize).r),uAmount);
  // Two local density differences retain boundary relief without six-axis normals per step.
  float local=clamp((rho-density(p+uSun*0.32))*2.5,-0.2,0.55);
  float upper=clamp((rho-density(p+vec3(0,0.4,0)))*2.0,0.0,0.6);
  float direct=access*(0.9+local)*forward;
  float multiple=0.25*pow(access,0.35)+0.12*pow(access,0.08);
  vec3 radiance=sunColor()*(direct+multiple*0.8)+vec3(0.08,0.14,0.25)*(0.2+upper);
  radiance=mix(radiance,radiance*vec3(0.018,0.026,0.045),uNight);
  if(uFlash>0.001){
   vec3 delta=p-vec3(0,7,-0.5); float spread=exp(-length(delta)*0.24);
   float bolt=exp(-channel(p)*24.0)*7.0;
   radiance+=vec3(0.55,0.7,1.0)*uFlash*(spread*3.0+bolt);
  }
  light+=transmission*alpha*radiance; transmission*=1.0-alpha;
 }
 result=vec4(light+transmission*background,1);
}`;
export const accumulateFragment = `#version 300 es
precision highp float;
uniform sampler2D uCurrent,uPrevious;
uniform float uCount;
out vec4 result;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 c=texelFetch(uCurrent,p,0);if(uCount<0.5){result=c;return;}vec4 old=texelFetch(uPrevious,p,0);result=old+(c-old)/(uCount+1.0);}`;
export const presentFragment = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform vec2 uSize,uImageSize;
uniform float uExposure,uGlare;
out vec4 result;
vec3 tone(vec3 c){return clamp((c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14),0.0,1.0);}
void main(){
 vec2 uv=gl_FragCoord.xy/uSize;
 vec3 c=texture(uImage,uv).rgb;
 vec2 px=3.0/uImageSize;
 vec3 bloom=texture(uImage,uv+vec2(px.x,0)).rgb+texture(uImage,uv-vec2(px.x,0)).rgb+texture(uImage,uv+vec2(0,px.y)).rgb+texture(uImage,uv-vec2(0,px.y)).rgb;
 c+=max(vec3(0),bloom*0.25-1.0)*uGlare*0.2;
 c*=exp2(uExposure);
 c*=1.0-0.12*dot(uv-0.5,uv-0.5);
 result=vec4(pow(tone(c),vec3(1.0/2.2)),1);
}`;
