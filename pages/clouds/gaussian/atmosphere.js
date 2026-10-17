import {mix,smoothstep,dot} from './math.js';

const PALETTE={"sunLow":[1,0.37,0.12],"sunHigh":[1,0.97,0.91],"zenithLow":[0.035,0.055,0.14],"zenithHigh":[0.014,0.095,0.29],"horizonLow":[0.52,0.19,0.095],"horizonHigh":[0.32,0.49,0.67],"groundLow":[0.18,0.14,0.14],"groundHigh":[0.23,0.34,0.43]};
const glslColor=v=>'vec3('+v.map(x=>Number.isInteger(x)?x.toFixed(1):String(x)).join(',')+')';

export const SKY_GLSL = `
uniform vec3 uSun;
uniform float uSunElevation;
uniform float uNight;
vec3 sunlight() {
  if(uNight>.5)return vec3(.008,.014,.028);
  float day = smoothstep(2.0, 35.0, uSunElevation);
  return mix(${glslColor(PALETTE.sunLow)}, ${glslColor(PALETTE.sunHigh)}, day);
}
// Analytic art-directed atmosphere: air-mass fit, Rayleigh-like angular lobe,
// Mie-like aureole. This is not a solved spherical atmosphere transport model.
vec3 skyRadiance(vec3 ray) {
  if(uNight>.5) {
    float h=exp(-max(ray.y+.06,0.0)*5.0);
    vec3 night=mix(vec3(.0006,.0012,.0035),vec3(.0035,.0065,.014),h);
    night+=vec3(.008,.014,.028)*pow(max(0.0,dot(ray,uSun)),32.0)*.018;
    return mix(night,vec3(.001,.0014,.0027),(1.0-smoothstep(-.15,-.035,ray.y))*.7);
  }
  float day = smoothstep(-4.0, 26.0, uSunElevation);
  float elevation = max(ray.y + 0.09, 0.0);
  float horizon = exp(-elevation * 5.0);
  vec3 zenith = mix(${glslColor(PALETTE.zenithLow)}, ${glslColor(PALETTE.zenithHigh)}, day);
  vec3 horizonColor = mix(${glslColor(PALETTE.horizonLow)}, ${glslColor(PALETTE.horizonHigh)}, day);
  vec3 sky = mix(zenith, horizonColor, horizon * 0.86);
  float mu = dot(ray, uSun);
  sky *= 0.93 + 0.07 * mu * mu;
  float aureole = pow(max(0.0, mu), 18.0) * 0.22 + pow(max(0.0, mu), 180.0) * 0.24;
  sky += sunlight() * aureole * mix(1.8, 0.65, day);
  float ground = 1.0 - smoothstep(-0.15, -0.035, ray.y);
  vec3 groundColor = mix(${glslColor(PALETTE.groundLow)}, ${glslColor(PALETTE.groundHigh)}, day);
  sky = mix(sky, groundColor, ground * 0.68);
  return sky;
}
// The solar disk is a background emitter, never in the haze/source term inside
// a cloud. Only the camera ray's remaining transmittance can reveal it.
vec3 backgroundRadiance(vec3 ray) {
  float disk=smoothstep(cos(0.0054),cos(0.0045),dot(ray,uSun));
  return skyRadiance(ray)+sunlight()*8.0*disk;
}
`;


const mixColor=(a,b,t)=>a.map((x,i)=>mix(x,b[i],t));
export function skyRadiance(ray,sun,elevation,night=false) {
  if(night) {
    const h=Math.exp(-Math.max(ray[1]+.06,0)*5),halo=Math.max(0,dot(ray,sun))**32*.018;
    const sky=mixColor([.0006,.0012,.0035],[.0035,.0065,.014],h).map((v,i)=>v+[.008,.014,.028][i]*halo);
    return mixColor(sky,[.001,.0014,.0027],(1-smoothstep(-.15,-.035,ray[1]))*.7);
  }
  const day=smoothstep(-4,26,elevation),sunColor=mixColor(PALETTE.sunLow,PALETTE.sunHigh,smoothstep(2,35,elevation));
  const horizon=Math.exp(-Math.max(ray[1]+.09,0)*5);
  let sky=mixColor(mixColor(PALETTE.zenithLow,PALETTE.zenithHigh,day),mixColor(PALETTE.horizonLow,PALETTE.horizonHigh,day),horizon*.86);
  const mu=dot(ray,sun),aureole=Math.max(0,mu)**18*.22+Math.max(0,mu)**180*.24;
  sky=sky.map((x,i)=>x*(.93+.07*mu*mu)+sunColor[i]*aureole*mix(1.8,.65,day));
  const ground=1-smoothstep(-.15,-.035,ray[1]);
  return mixColor(sky,mixColor(PALETTE.groundLow,PALETTE.groundHigh,day),ground*.68);
}

// Integrate the same sky used behind the cloud. The solar disk is excluded:
// direct sunlight already has its own analytic extinction path.
export function ambientSky(sun,elevation,night=false) {
  const result=[0,0,0],samples=64;
  for(let i=0;i<samples;i++) {
    const y=(i+.5)/samples,r=Math.sqrt(1-y*y),phi=i*2.399963229728653;
    const c=skyRadiance([Math.cos(phi)*r,y,Math.sin(phi)*r],sun,elevation,night);
    for(let k=0;k<3;k++)result[k]+=c[k]*1.8/samples;
  }
  return result;
}
