import {SKY_GLSL as SKY} from './atmosphere.js';
import { GAUSSIAN_SUPPORT, FULL_RAY_SIGMA, TRANSMITTANCE_CUTOFF, MIN_SPLAT_ALPHA, SHADOW_SLAB_SUPPORT } from './config.js';
import {DETAIL_BAKE} from './detail.js';
import {STORM} from './storm.js';
import {CLOUD_RECONSTRUCTION_GLSL} from './cloud-resolution.js';
import {LOD_PALETTE,LOD_COLOR_GLSL} from './lod-colors.js';

export const ERFC_GLSL = `
float erfcApprox(float x) {
  float z = abs(x), t = 1.0 / (1.0 + 0.5 * z);
  float r = t * exp(-z*z - 1.26551223 + t*(1.00002368 + t*(0.37409196 + t*(0.09678418 + t*(-0.18628806 + t*(0.27886807 + t*(-1.13520398 + t*(1.48851587 + t*(-0.82215223 + t*0.17087277)))))))));
  return x < 0.0 ? 2.0 - r : r;
}
`;

// One shared optical-depth implementation for both camera and sunlight rays.
// m and d are the ray origin and direction in the Gaussian's scaled frame.
export const GAUSSIAN_GLSL = `${ERFC_GLSL}
void gaussianRayCoordinates(vec3 m,vec3 d,out float q,out float center,out float a) {
  a = dot(d,d);
  float b = dot(m,d);
  center = -b/a;
  vec3 closest = m+d*center;
  q = dot(closest,closest);
}
float gaussianDepth(float peak,float q,float center,float a,float unclipped) {
  float mass=2.0;
  if(unclipped<.5)mass=erfcApprox(-center*sqrt(a*0.5));
  return peak*exp(-0.5*q)*sqrt(1.57079632679/a)*mass;
}
float gaussianDepth(float peak,float q,float center,float a) {
  return gaussianDepth(peak,q,center,a,0.0);
}
float gaussianHalfRay(vec3 m,vec3 d,float peak,out float q,out float center,out float a) {
  gaussianRayCoordinates(m,d,q,center,a);
  return gaussianDepth(peak,q,center,a);
}
`;

export const ABSORPTION_GLSL = `
// Mike Giles, Approximating the erfinv function (GPU Computing Gems).
// https://people.maths.ox.ac.uk/gilesm/codes/erfinv/
// Evaluate 1-x*x as 4*p*(1-p) to preserve probabilities in the tails.
float inverseNormal(float p) {
  p=clamp(p,0.000001,0.999999);
  float w=-log(4.0*p*(1.0-p)),t,value;
  if(w<5.0){
    t=w-2.5;
    value=((((((((2.81022636e-8*t+3.43273939e-7)*t-3.5233877e-6)*t-4.39150654e-6)*t+.00021858087)*t-.00125372503)*t-.00417768164)*t+.246640727)*t+1.50140941);
  }else{
    t=sqrt(w)-3.0;
    value=((((((((-.000200214257*t+.000100950558)*t+.00134934322)*t-.00367342844)*t+.00573950773)*t-.0076224613)*t+.00943887047)*t+1.00167406)*t+2.83297682);
  }
  return 1.41421356237*(2.0*p-1.0)*value;
}
float absorptionPosition(float center,float invSigma,float tau,float alpha,float node,float unclipped) {
  float cdf0=0.0;
  if(unclipped<.5)cdf0=0.5*erfcApprox(center*invSigma*0.70710678118);
  float fraction=-log(max(0.000001,1.0-node*alpha))/tau;
  return max(0.0,center+inverseNormal(cdf0+(1.0-cdf0)*fraction)/invSigma);
}
float absorptionPosition(float center,float invSigma,float tau,float alpha,float node) {
  return absorptionPosition(center,invSigma,tau,alpha,node,0.0);
}
`;

const CAMERA = `
uniform vec3 uEye, uRight, uUp, uForward;
uniform vec2 uResolution;
uniform vec2 uLensShift;
uniform vec2 uPixelJitter;
uniform float uTanFov, uAspect;
vec3 cameraRay() {
  vec2 screen = (gl_FragCoord.xy + uPixelJitter) / uResolution * 2.0 - 1.0 + uLensShift;
  return normalize(uForward + uRight * screen.x * uTanFov * uAspect + uUp * screen.y * uTanFov);
}
`;
export {CAMERA as CAMERA_GLSL};

const PHASE_GLSL = `
float phase(float mu, float g) {
  return (1.0-g*g) / pow(max(0.02, 1.0+g*g-2.0*g*mu), 1.5);
}
`;

export const fullscreenVertex = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// These terms depend on the camera ray, not the Gaussian being integrated.
export const rayTermsFragment = `#version 300 es
precision highp float;
${CAMERA}
${SKY}
${PHASE_GLSL}
layout(location=0) out vec4 angular;
layout(location=1) out vec4 sky;
void main() {
  vec3 ray=cameraRay();float mu=dot(ray,uSun);
  angular=vec4(0.82*phase(mu,0.72)+0.18*phase(mu,-0.30),phase(mu,0.36),phase(mu,0.14),1.0-smoothstep(.25,.9,mu));
  sky=vec4(skyRadiance(ray),0.0);
}`;

export const COVARIANCE_GLSL = `
vec3 whiten(vec3 v,vec3 l0,vec3 l1) {
  float x=v.x/l0.x,y=(v.y-l0.y*x)/l0.z;
  return vec3(x,y,(v.z-l1.x*x-l1.y*y)/l1.z);
}
vec3 transposeRoot(vec3 v,vec3 l0,vec3 l1) {
  return vec3(l0.x*v.x+l0.y*v.y+l1.x*v.z,l0.z*v.y+l1.y*v.z,l1.z*v.z);
}
`;

const splatVertexFor = (indexed,covariance=0) => `#version 300 es
precision highp float;
${covariance?COVARIANCE_GLSL:''}
${indexed?`precision highp sampler2D;
layout(location=0) in uint aSplatIndex;
uniform sampler2D uSplatData,uSplatAppearance,uSplatDetail,uSplatLightning,uSplatCovariance;
uniform float uLocalShadowStrength,uFineShadingStrength;
uniform int uSplatColumnBits,uCloudStride,uCovarianceStart;
uniform int uLodStarts[${LOD_PALETTE.length-1}];
uniform sampler2D uCloudOffsets;`
:`layout(location=0) in vec4 aCenterWeight;
layout(location=1) in vec4 aSigmaSeed;
layout(location=2) in vec4 aAppearance;`}
uniform vec3 uEye, uRight, uUp, uForward;
uniform float uTanFov, uAspect;
uniform float uDensity;
uniform float uNight;
uniform float uRasterPadding;
uniform vec3 uSun;
uniform float uBoundaryStrength,uBoundaryPower,uDepthStrength,uSkyStrength;
uniform vec2 uLensShift;
uniform vec2 uResolution,uShadingResolution,uPixelJitter;
flat out vec4 vCenterWeight;
flat out vec4 vSigmaSeed;
${covariance?'flat out vec3 vRoot0,vRoot1;':''}
${covariance===1?'flat out float vRotated;':''}
flat out vec4 vAppearance;
flat out vec3 vFineNormal;
flat out vec2 vLocalAccess;
flat out vec3 vLightningTau;
flat out vec4 vBoundaryTerms;
flat out vec2 vAmbientTerms;
flat out vec4 vRayOriginAndFull;
flat out vec3 vCloudOffset;
flat out highp int vLodLevel;
uniform highp int uColorByLOD;
void main() {
  vLodLevel=0;
  ${covariance===1?'vRotated=0.0;vRoot0=vec3(1.0,0.0,1.0);vRoot1=vec3(0.0,0.0,1.0);':''}
  vCloudOffset=vec3(0.0);
  vFineNormal=vec3(0.0);vLocalAccess=vec2(1.0);vLightningTau=vec3(0.0);
  ${indexed?`uint mask=(1u<<uint(uSplatColumnBits))-1u;
  uint sourceIndex=aSplatIndex%uint(uCloudStride),cloudIndex=aSplatIndex/uint(uCloudStride);
  if(uColorByLOD==1)for(int level=0;level<${LOD_PALETTE.length-1};level++)if(int(sourceIndex)>=uLodStarts[level])vLodLevel=level+1;
  vCloudOffset=texelFetch(uCloudOffsets,ivec2(int(cloudIndex),0),0).xyz;
  ivec2 cell=ivec2(sourceIndex&mask,sourceIndex>>uint(uSplatColumnBits));
  vec4 aCenterWeight=texelFetch(uSplatData,ivec2(cell.x*2,cell.y),0);aCenterWeight.xyz+=vCloudOffset;
  vec4 aSigmaSeed=texelFetch(uSplatData,ivec2(cell.x*2+1,cell.y),0);
  vec4 aAppearance=texelFetch(uSplatAppearance,cell,0);
  ${covariance?`${covariance===1?'if(int(sourceIndex)>=uCovarianceStart) {':''}
    uint rootIndex=sourceIndex-uint(uCovarianceStart);
    ivec2 rootCell=ivec2(rootIndex&mask,rootIndex>>uint(uSplatColumnBits));
    vec4 r0=texelFetch(uSplatCovariance,ivec2(rootCell.x*2,rootCell.y),0),r1=texelFetch(uSplatCovariance,ivec2(rootCell.x*2+1,rootCell.y),0);
    vRoot0=r0.xyz;vRoot1=vec3(r0.w,r1.xy);${covariance===1?'vRotated=1.0;}':''}`:''}`:''}
  vec3 gradient=aAppearance.xyz*2.0-1.0;
  float gradientLength=length(gradient);
  vec3 normal=gradient/max(gradientLength,.001);
  float boundary=smoothstep(.02,.12,gradientLength)*min(1.0,gradientLength);
  vFineNormal=normal;
  ${indexed?`
  if(uNight>.5){vec3 encoded=texelFetch(uSplatLightning,cell,0).rgb;vLightningTau=encoded*encoded*${STORM.maxTau.toFixed(1)};}
  if(uFineShadingStrength>0.0) {
    vec3 fine=texelFetch(uSplatDetail,ivec2(cell.x*3,cell.y),0).xyz*2.0-1.0;
    // Both gradients are static per Gaussian. Filter their angular correction
    // here, once per vertex, rather than repeating it in every covered pixel.
    float footprint=length(aCenterWeight.xyz-uEye)*2.0*uTanFov/max(uResolution.y,uShadingResolution.y);
    float resolved=1.0-smoothstep(.035,.11,footprint);
    vec3 tangent=fine-normal*dot(normal,fine);
    vFineNormal=normalize(normal+tangent*(uFineShadingStrength*resolved*boundary));
  }
  if(uLocalShadowStrength>0.0) {
    vec3 positive=texelFetch(uSplatDetail,ivec2(cell.x*3+1,cell.y),0).xyz*${DETAIL_BAKE.maxTau.toFixed(1)};
    vec3 negative=texelFetch(uSplatDetail,ivec2(cell.x*3+2,cell.y),0).xyz*${DETAIL_BAKE.maxTau.toFixed(1)};
    // A continuous six-lobe reconstruction responds immediately to any sun
    // direction. It attenuates indirect illumination, not direct extinction.
    float tauSun=dot(mix(negative,positive,step(vec3(0.0),uSun)),uSun*uSun);
    vec3 vp=exp(-positive*uDensity*.55),vn=exp(-negative*uDensity*.55);
    vLocalAccess=vec2(exp(-tauSun*uDensity*.55),vp.y*.5+(vp.x+vn.x+vp.z+vn.z)*.125);
  }`:''}
  vCenterWeight = aCenterWeight;
  vSigmaSeed = aSigmaSeed;
  vAppearance=aAppearance;
  float muLight=max(0.0,dot(vFineNormal,uSun));
  float hLight=(1.0+2.0*muLight)/(1.0+.45*muLight);
  float lightCoupling=hLight*pow(max(muLight,.0001),uBoundaryPower)/max(.6,1.3-.5*uBoundaryPower);
  float localWeight=boundary*${indexed?'uLocalShadowStrength':'0.0'};
  float depthProbability=.12+.88*pow(aAppearance.w,.75);
  vBoundaryTerms=vec4(muLight,lightCoupling,boundary*uBoundaryStrength,mix(1.0,depthProbability,uDepthStrength)*mix(1.0,.35+.65*vLocalAccess.x,localWeight));
  float hemisphere=.35+.65*sqrt(max(0.0,.5+.5*vFineNormal.y));
  float ambientEscape=(.30+.70*pow(max(0.0,1.0-aAppearance.w),.25))*hemisphere;
  vAmbientTerms=vec2(mix(1.0,.25+.75*vLocalAccess.y,localWeight),mix(1.0,ambientEscape,boundary*uSkyStrength));
  vec3 delta = aCenterWeight.xyz - uEye;
  vec3 p = vec3(dot(delta, uRight), dot(delta, uUp), dot(delta, uForward));
  float sigmaMax=max(aSigmaSeed.x,max(aSigmaSeed.y,aSigmaSeed.z));
  vec3 rayOrigin=-delta/aSigmaSeed.xyz;
  ${covariance?`${covariance===1?'if(vRotated>.5){':''}sigmaMax=length(aSigmaSeed.xyz);rayOrigin=whiten(-delta,vRoot0,vRoot1);${covariance===1?'}':''}`:''}
  // For a contributing ray q<=support^2, a*t^2=dot(m,m)-q.
  // This conservative test puts its center at least eight ray sigmas ahead:
  // the omitted camera-side tail is <6.3e-16 of the full Gaussian mass.
  float unclipped=p.z-${GAUSSIAN_SUPPORT.toFixed(1)}*sigmaMax>.01 && dot(rayOrigin,rayOrigin)>${(FULL_RAY_SIGMA**2+GAUSSIAN_SUPPORT**2).toFixed(1)}?1.0:0.0;
  vRayOriginAndFull=vec4(rayOrigin,unclipped);
  float maxTau=aCenterWeight.w*uDensity*2.50662827463*sigmaMax;
  float support=min(${GAUSSIAN_SUPPORT.toFixed(1)},sqrt(max(0.0,2.0*log(maxTau/${MIN_SPLAT_ALPHA}))));
  float r=support*sigmaMax;
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  if (p.z + r < 0.01) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); return; }
  vec3 sigma=aSigmaSeed.xyz*support;
  vec3 sx=uRight*sigma,sy=uUp*sigma,sz=uForward*sigma;
  ${covariance?`${covariance===1?'if(vRotated>.5){':''}sx=transposeRoot(uRight,vRoot0,vRoot1)*support;sy=transposeRoot(uUp,vRoot0,vRoot1)*support;sz=transposeRoot(uForward,vRoot0,vRoot1)*support;${covariance===1?'}':''}`:''}
  float zz=dot(sz,sz);
  if (p.z - sqrt(zz) < 0.01) { gl_Position = vec4(corner, 0.0, 1.0); return; }
  // A tangent plane through the eye satisfies (px - slope*pz)^2 =
  // xx - 2*slope*xz + slope^2*zz. Solve for both screen-axis extrema.
  vec2 diagonal=vec2(dot(sx,sx),dot(sy,sy)),crossZ=vec2(dot(sx,sz),dot(sy,sz));
  float denom=p.z*p.z-zz;
  vec2 proj=(p.xy*p.z-crossZ)/denom;
  // This form avoids subtracting two nearly equal squared center coordinates
  // when tiny ellipsoids are far from the camera.
  vec3 tx=p.z*sx-p.x*sz,ty=p.z*sy-p.y*sz;
  vec2 discriminant=vec2(dot(tx,tx),dot(ty,ty))-(diagonal*zz-crossZ*crossZ);
  vec2 radius=sqrt(max(vec2(0.0),discriminant))/denom;
  vec2 lens=vec2(uTanFov*uAspect,uTanFov);
  proj/=lens;radius/=lens;
  // Expand by one hardware subpixel as well as float roundoff: triangle
  // rasterization quantizes vertices and can otherwise clip a tangent pixel.
  vec2 roundoff=(abs(proj)+radius+1.0)*0.000002+2.0*uRasterPadding/uResolution;
  gl_Position = vec4(proj+corner*(radius+roundoff)-uLensShift-2.0*uPixelJitter/uResolution,0.0,1.0);
}`;

export const splatVertex=splatVertexFor(false);
export const indexedSplatVertex=splatVertexFor(true);
export const mixedSplatVertex=splatVertexFor(true,1);
export const covarianceSplatVertex=splatVertexFor(true,2);

export const SHADOW_LOOKUP_GLSL = `
uniform sampler3D uShadow;
uniform float uShadowDepth,uShadowStep,uShadowCubic;
float shadowSample(vec3 uv) {
  float z=clamp(uv.z,0.0,1.0)*(uShadowDepth-1.0);
  if(uShadowCubic<.5)return texture(uShadow,vec3(uv.xy,(z+.5)/uShadowDepth)).r;
  float layer=floor(z),t=z-layer;
  vec2 a=texture(uShadow,vec3(uv.xy,(layer+.5)/uShadowDepth)).rg;
  vec2 b=texture(uShadow,vec3(uv.xy,(min(layer+1.0,uShadowDepth-1.0)+.5)/uShadowDepth)).rg;
  float delta=b.r-a.r;
  if(delta>=-0.000001)return mix(a.r,b.r,t);
  // d(tau)/dz = -density. Monotone cubic Hermite reconstruction uses this
  // analytic derivative to retain boundary curvature between light planes.
  vec2 slope=-vec2(a.g,b.g)*uShadowStep;
  vec2 ratio=slope/delta;
  float norm=length(ratio);
  if(norm>3.0)slope*=3.0/norm;
  float tau=mix(a.r,b.r,t)+t*(1.0-t)*((1.0-t)*(slope.x-delta)-t*(slope.y-delta));
  return clamp(tau,b.r,a.r);
}
`;

const splatFragmentFor = (covariance=0) => `#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler3D;
${CAMERA}
${SKY}
${GAUSSIAN_GLSL}
${ABSORPTION_GLSL}
${covariance?COVARIANCE_GLSL:''}
flat in vec4 vCenterWeight;
flat in vec4 vSigmaSeed;
${covariance?'flat in vec3 vRoot0,vRoot1;':''}
${covariance===1?'flat in float vRotated;':''}
flat in vec4 vAppearance;
flat in vec3 vFineNormal;
flat in vec2 vLocalAccess;
flat in vec3 vLightningTau;
flat in vec4 vBoundaryTerms;
flat in vec2 vAmbientTerms;
flat in vec4 vRayOriginAndFull;
flat in vec3 vCloudOffset;
flat in highp int vLodLevel;
uniform highp int uColorByLOD;
${LOD_COLOR_GLSL}
${SHADOW_LOOKUP_GLSL}
uniform vec3 uLightRight, uLightUp, uLightForward, uLightMin, uLightSpan;
uniform float uDensity, uScattering, uTop;
uniform float uAbsorptionSample;
uniform float uBoundaryStrength,uBoundaryPower,uDepthStrength,uSkyStrength;
uniform float uLocalShadowStrength,uFineShadingStrength;
uniform vec3 uAmbient;
uniform int uView;
uniform sampler2D uRayAngular,uRaySky;
layout(location=0) out vec4 color;
layout(location=1) out vec4 lightning;

float opticalDepth(vec3 p) {
  vec3 q = (vec3(dot(p, uLightRight), dot(p, uLightUp), dot(p, uLightForward)) - uLightMin) / uLightSpan;
  if (any(lessThan(q, vec3(0.0))) || any(greaterThan(q, vec3(1.0)))) return 0.0;
  return max(0.0, shadowSample(q)) * uDensity;
}
${PHASE_GLSL}
vec3 lightningAt(vec3 p,vec3 ray) {
  vec3 response=vec3(0.0);
  ${STORM.lights.map((light,i)=>`{
    vec3 start=vec3(${light.start.map(v=>v.toFixed(4)).join(',')}),end=vec3(${light.end.map(v=>v.toFixed(4)).join(',')});
    vec3 axis=end-start;float length2=dot(axis,axis);
    float u=clamp(dot(p-start,axis)/length2,0.0,1.0);
    vec3 toLight=start+u*axis-p;
    float distance2=dot(toLight,toLight),tau=vLightningTau[${i}]*uDensity;
    float mu=dot(ray,toLight*inversesqrt(max(distance2,.0001)));
    float access=exp(-tau)*(.65+.35*phase(mu,.22))+.12*exp(-tau*.22)*uScattering;
    // Three-point quadrature of inverse-square irradiance along the source.
    // Attenuation uses the baked closest-point path as a bounded-cost proxy.
    float irradiance=0.0;
    for(int k=0;k<3;k++){vec3 d=mix(start,end,(float(k)+.5)/3.0)-p;irradiance+=1.0/(dot(d,d)+${(light.radius**2).toFixed(4)});}
    response[${i}]=${light.power.toFixed(1)}*access*irradiance/3.0;
  }`).join('\n')}
  return response;
}
vec3 lightingAt(vec3 p,vec3 lobes,vec3 viewDirection,float reflection) {
  float lightTau=opticalDepth(p);
  if(uView==2)return mix(vec3(0.045,0.10,0.28),vec3(2.5,0.67,0.08),exp(-lightTau*0.45));
  float direct=exp(-lightTau)*lobes.x;
  float multiple=0.48*exp(-lightTau*0.50)*lobes.y
                +0.28*exp(-lightTau*0.20)*lobes.z
                +0.16*exp(-lightTau*0.035);
  float muLight=vBoundaryTerms.x;
  float muView=max(0.0,dot(vFineNormal,viewDirection));
  // Bounded diffuse-boundary response. This approximates angular coupling
  // omitted by independent center-sorted source terms, not surface extinction.
  float hView=(1.0+2.0*muView)/(1.0+.45*muView);
  float diffusion=clamp(muLight/(muLight+muView+.04)*hView*vBoundaryTerms.y,.08,1.5+.3*uBoundaryPower);
  float coupling=mix(1.0,diffusion,vBoundaryTerms.z);
  // Retain transmission/forward scattering at backlit silhouettes. On the
  // reflecting side, use the same boundary coupling for the low-order source.
  direct*=mix(1.0,coupling,reflection);
  multiple*=coupling*vBoundaryTerms.w;
  float skyAccess=exp(-max(0.0,uTop-p.y)*0.15);
  skyAccess*=vAmbientTerms.y;
  vec3 ambient=uAmbient*vAmbientTerms.x;
  return sunlight()*(direct*2.1+multiple*uScattering*1.65)
        +ambient*(0.17+0.34*skyAccess)+(uNight>.5?vec3(.00015,.00025,.0005):vec3(0.032,0.030,0.028));
}
void main() {
  lightning=vec4(0.0);
  vec3 ray = cameraRay();
  vec3 m = vRayOriginAndFull.xyz;
  vec3 d = ${covariance===2?'whiten(ray,vRoot0,vRoot1)':'ray / vSigmaSeed.xyz'};
  ${covariance===1?'if(vRotated>.5)d=whiten(ray,vRoot0,vRoot1);':''}
  float q, t, a;
  gaussianRayCoordinates(m,d,q,t,a);
  if (q > ${(GAUSSIAN_SUPPORT ** 2).toFixed(1)}) discard;
  float tau=gaussianDepth(vCenterWeight.w*uDensity,q,t,a,vRayOriginAndFull.w);
  float alpha = 1.0-exp(-tau);
  if (alpha < ${MIN_SPLAT_ALPHA}) discard;
  if (uView == 1) {
    vec3 idColor = 0.45 + 0.42 * cos(vec3(0.0, 2.1, 4.2) + vSigmaSeed.w * 47.0);
    if(uColorByLOD==1)idColor=LOD_COLORS[vLodLevel];
    vec3 radiance = idColor * (0.7 + 0.4*exp(-q));
    alpha = (1.0 - exp(-tau * 0.32)) * (1.0-smoothstep(5.0, ${(GAUSSIAN_SUPPORT ** 2).toFixed(1)}, q));
    color=vec4(radiance*alpha,alpha);return;
  }
  vec4 angular=texelFetch(uRayAngular,ivec2(gl_FragCoord.xy),0);
  // One source sample in absorbed-energy coordinates. A per-pixel/per-splat
  // rotation decorrelates the low-discrepancy temporal sequence spatially.
  uint hash=uint(gl_FragCoord.x)*1973u+uint(gl_FragCoord.y)*9277u+floatBitsToUint(vSigmaSeed.w)*26699u;
  hash^=hash>>16;hash*=0x7feb352du;hash^=hash>>15;hash*=0x846ca68bu;hash^=hash>>16;
  float node=fract(uAbsorptionSample+float(hash & 0x00ffffffu)/16777216.0);
  float position=absorptionPosition(t,sqrt(a),tau,alpha,node,vRayOriginAndFull.w);
  vec3 radiance=lightingAt(uEye+ray*position-vCloudOffset,angular.rgb,-ray,angular.a);
  float haze = 1.0-exp(-max(0.0, t-8.0)*0.0025);
  radiance = mix(radiance,texelFetch(uRaySky,ivec2(gl_FragCoord.xy),0).rgb,haze);
  if(uColorByLOD==1)radiance=LOD_COLORS[vLodLevel];
  color = vec4(radiance * alpha, alpha);
  if(uNight>.5&&uView==0)lightning=vec4(lightningAt(uEye+ray*position-vCloudOffset,ray)*alpha*(1.0-haze),alpha);
}
`;

const shadowVertexFor = slab => `#version 300 es
precision highp float;
layout(location=0) in vec4 aCenterWeight;
layout(location=1) in vec4 aSigmaSeed;
uniform vec3 uLightRight, uLightUp, uLightForward, uLightMin, uLightSpan;
uniform float uSlice${slab ? ', uSlabLength' : ''};
flat out vec4 vCenterWeight;
flat out vec3 vSigma;
void main() {
  vCenterWeight = aCenterWeight;
  vSigma = aSigmaSeed.xyz;
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vec2 center = vec2(dot(aCenterWeight.xyz, uLightRight), dot(aCenterWeight.xyz, uLightUp));
  vec2 radius = ${GAUSSIAN_SUPPORT.toFixed(1)} * vec2(length(uLightRight * vSigma), length(uLightUp * vSigma));
  float centerZ=dot(aCenterWeight.xyz,uLightForward);
  float radiusZ=${(slab ? SHADOW_SLAB_SUPPORT : GAUSSIAN_SUPPORT).toFixed(1)}*length(uLightForward*vSigma);
  if (centerZ+radiusZ < uSlice${slab ? ' || centerZ-radiusZ > uSlice+uSlabLength' : ''}) { gl_Position = vec4(2.0,2.0,0.0,1.0); return; }
  gl_Position = vec4((center + corner * radius - uLightMin.xy) / uLightSpan.xy * 2.0 - 1.0, 0.0, 1.0);
}`;
export const splatFragment=splatFragmentFor();
export const mixedSplatFragment=splatFragmentFor(1);
export const covarianceSplatFragment=splatFragmentFor(2);

const shadowFragmentFor = slab => `#version 300 es
precision highp float;
${GAUSSIAN_GLSL}
flat in vec4 vCenterWeight;
flat in vec3 vSigma;
uniform vec3 uLightRight, uLightUp, uLightForward, uLightMin, uLightSpan;
uniform vec2 uShadowResolution;
uniform float uSlice${slab ? ', uSlabLength' : ''};
out vec4 color;
void main() {
  vec2 xy = uLightMin.xy + gl_FragCoord.xy / uShadowResolution * uLightSpan.xy;
  vec3 p = uLightRight * xy.x + uLightUp * xy.y + uLightForward * uSlice;
  vec3 m = (p - vCenterWeight.xyz) / vSigma;
  vec3 d = uLightForward / vSigma;
  float q, center, a;
  gaussianRayCoordinates(m,d,q,center,a);
  if (q > ${(GAUSSIAN_SUPPORT ** 2).toFixed(1)}) discard;
  ${slab ? `float s=sqrt(a*0.5),lo=-center*s,hi=(uSlabLength-center)*s;
  float mass=lo>0.0 ? erfcApprox(lo)-erfcApprox(hi) : hi<0.0 ? erfcApprox(-hi)-erfcApprox(-lo) : 2.0-erfcApprox(-lo)-erfcApprox(hi);
  float tau=max(0.0,vCenterWeight.w*exp(-0.5*q)*sqrt(1.57079632679/a)*mass);`
  : 'float tau=gaussianDepth(vCenterWeight.w,q,center,a);'}
  float density=vCenterWeight.w*exp(-.5*dot(m,m));
  color = vec4(tau,density,0.0,0.0);
}`;

// Each finite segment extends an already computed sunward prefix to a new
// lattice node. All nodes use the same original Gaussian mixture.
export const shadowVertex = shadowVertexFor(false);
export const shadowFragment = shadowFragmentFor(false);
export const shadowSlabVertex = shadowVertexFor(true);
export const shadowSlabFragment = shadowFragmentFor(true);

export const opacityMaskFragment = `#version 300 es
precision highp float;
uniform sampler2D uVisibility;
out vec4 color;
void main() {
  if(texelFetch(uVisibility,ivec2(gl_FragCoord.xy),0).a >= ${TRANSMITTANCE_CUTOFF}) discard;
  gl_FragDepth=0.0;
  color=vec4(0.0);
}`;

export const shadowResolveFragment = `#version 300 es
precision highp float;
uniform sampler2D uSource;
out vec4 color;
void main(){color=vec4(texelFetch(uSource,ivec2(gl_FragCoord.xy),0).rg,0.0,0.0);}
`;

export const radianceFragment = `#version 300 es
precision highp float;
${CAMERA}
${SKY}
uniform sampler2D uScene;
out vec4 color;
${CLOUD_RECONSTRUCTION_GLSL}
void main() {
  vec4 cloud=cloudReconstruct(uScene,gl_FragCoord.xy/uResolution,uResolution);
  color=vec4(cloud.rgb+cloud.a*backgroundRadiance(cameraRay()),cloud.a);
}`;

export const bloomFragment = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uOutputSize;
uniform int uPrefilter;
uniform float uExposure;
out vec4 color;
vec3 sampleLight(vec2 uv) {
  vec3 c=texture(uSource,uv).rgb;
  if(uPrefilter==0)return c;
  c*=exp2(uExposure);
  float brightness=max(c.r,max(c.g,c.b));
  float knee=clamp(brightness-0.65,0.0,0.8);
  float energy=max(brightness-1.05,knee*knee/1.6);
  return c*(energy/max(brightness,0.0001));
}
void main() {
  vec2 uv=gl_FragCoord.xy/uOutputSize, texel=1.0/vec2(textureSize(uSource,0));
  vec3 sum=vec3(0.0);
  // Overlapping, symmetric footprints reduce phase shifts when downsampling
  // odd image sizes. Weights sum to one; threshold before averaging highlights.
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++) {
    float weight=float((2-abs(x))*(2-abs(y)))/32.0;
    sum+=sampleLight(uv+vec2(x,y)*texel*2.0)*weight;
  }
  for(int y=-1;y<=1;y+=2)for(int x=-1;x<=1;x+=2)
    sum+=sampleLight(uv+vec2(x,y)*texel)*.125;
  color=vec4(sum,1.0);
}`;

export const lensFragment = `#version 300 es
precision highp float;
uniform sampler2D uImage,uBloom0,uBloom1,uBloom2,uBloom3,uBloom4;
uniform vec2 uResolution;
uniform float uExposure,uGlare,uVignette,uAberration,uDetailCrispness,uDetailScale;
out vec4 color;
vec3 aces(vec3 x) { return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
float cloudDetailGain(vec2 uv) {
  vec4 center=texture(uImage,uv);
  if(center.a>.04)return 1.0;
  vec2 stepUV=vec2(max(1.0,uResolution.y/360.0*uDetailScale))/uResolution;
  vec4 left=texture(uImage,uv-vec2(stepUV.x,0.0)),right=texture(uImage,uv+vec2(stepUV.x,0.0));
  vec4 down=texture(uImage,uv-vec2(0.0,stepUV.y)),up=texture(uImage,uv+vec2(0.0,stepUV.y));
  float maxT=max(center.a,max(max(left.a,right.a),max(down.a,up.a)));
  float mask=1.0-smoothstep(.005,.04,maxT);
  vec3 luma=vec3(.2126,.7152,.0722);
  float c=dot(center.rgb,luma);
  vec4 neighbors=vec4(dot(left.rgb,luma),dot(right.rgb,luma),dot(down.rgb,luma),dot(up.rgb,luma));
  float low=min(c,min(min(neighbors.x,neighbors.y),min(neighbors.z,neighbors.w)));
  float high=max(c,max(max(neighbors.x,neighbors.y),max(neighbors.z,neighbors.w)));
  float range=high-low;
  // Restore a small resolved detail band. Luminance-only gain preserves hue;
  // local extrema and a 10% ceiling bound ringing and single-sample noise.
  float detail=(c-dot(neighbors,vec4(.25)))*clamp(uDetailCrispness,0.0,1.0);
  float sharpened=clamp(c+detail,low-range*.04,high+range*.04);
  return 1.0+mask*clamp((sharpened-c)/max(c,.02),-.10,.10);
}
void main() {
  vec2 uv=gl_FragCoord.xy/uResolution,radial=uv-0.5;
  float radius=dot(radial,radial)*2.0;
  vec2 fringe=radial*radius*uAberration*3.0/uResolution;
  vec3 linear=vec3(texture(uImage,uv+fringe).r,texture(uImage,uv).g,texture(uImage,uv-fringe).b)*exp2(uExposure);
  if(uDetailCrispness>0.0)linear*=cloudDetailGain(uv);
  if(uGlare>0.0) {
    vec3 halo=texture(uBloom0,uv).rgb*.12+texture(uBloom1,uv).rgb*.20
             +texture(uBloom2,uv).rgb*.25+texture(uBloom3,uv).rgb*.25+texture(uBloom4,uv).rgb*.18;
    // Symmetric offsets keep diffraction centered on visible HDR highlights.
    vec3 streak=vec3(0.0);
    for(int i=1;i<=4;i++) {
      vec2 d=vec2(float(i)*6.0)/uResolution;
      float weight=exp(-float(i)*.65);
      streak+=(texture(uBloom0,uv+vec2(d.x,0)).rgb+texture(uBloom0,uv-vec2(d.x,0)).rgb
              +texture(uBloom0,uv+vec2(0,d.y)).rgb+texture(uBloom0,uv-vec2(0,d.y)).rgb)*weight;
    }
    linear+=uGlare*(halo+streak*.055);
  }
  linear*=1.0-uVignette*smoothstep(.12,.85,radius);
  vec3 mapped=pow(aces(max(linear,vec3(0.0))),vec3(1.0/2.2));
  float dither=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
  color=vec4(mapped+(dither-.5)/255.0,1.0);
}`;
