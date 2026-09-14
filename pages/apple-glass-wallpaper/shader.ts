// A fixed-camera, analytic relief renderer. Coordinates are in the reference's
// 590 × 1280 composition. Each pebble has an independent silhouette, material,
// depth profile and object-space grain; no photograph is used as a texture.
export const vertexSource = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const fragmentSource = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform vec2 uView;
uniform vec2 uOffset;
uniform vec2 uLight;
uniform float uPress;
uniform float uGrain;
uniform float uWarmth;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float bell(vec2 p, vec2 c, vec2 r) {
  vec2 q = (p-c)/r;
  return exp(-dot(q,q)*2.0);
}
vec2 localPoint(vec2 p, int id) {
  if (id == 0) {
    p -= vec2(321.0, 299.0) - uOffset*.16;
    return vec2(p.x - p.y*.16, p.y) / vec2(245.0, 408.0);
  }
  if (id == 1) {
    p -= vec2(274.0, 941.0) - uOffset*.26;
    return vec2(p.x - p.y*.19, p.y) / vec2(253.0, 366.0);
  }
  p -= vec2(298.0, 645.0) + uOffset;
  float y = p.y / (386.0 * (1.0-uPress*.018));
  float width = 252.0 * (1.0 - .19*y + uPress*.014);
  return vec2((p.x-p.y*.045)/width, y);
}
float field(vec2 q, int id) {
  float power = id == 2 ? 2.20 : 2.35;
  return pow(abs(q.x),power) + pow(abs(q.y),power);
}
vec3 background(vec2 p) {
  return mix(vec3(.842,.705,.723), vec3(.998,.968,.969),
    clamp(p.y / 1250.0,0.0,1.0));
}
vec3 pebble(vec3 under, vec2 p, int id) {
  vec2 q = localPoint(p,id);
  float f = field(q,id);
  float aa = max(fwidth(f)*1.3,.006);
  float mask = 1.0-smoothstep(1.0-aa,1.0+aa,f);
  if (mask <= 0.0) return under;
  float depth = sqrt(max(0.0,1.0-f));
  vec2 slope = sign(q)*pow(abs(q),vec2(1.45));
  vec3 normal = normalize(vec3(slope.x, slope.y*.62, depth*.70+.03));
  float edge = pow(1.0-depth,1.8);
  float left = pow(max(0.0,-normal.x),2.0);
  float right = pow(max(0.0,normal.x),2.0);
  vec2 lightingQ = q-uLight*.10;
  vec3 color;
  if (id == 2) {
    color = vec3(.882,.548,.548);
    color = mix(color,vec3(.975,.754,.742),bell(lightingQ,vec2(.30,-.51),vec2(1.40,1.10)));
    color = mix(color,vec3(.995,.854,.804),bell(lightingQ,vec2(-.35,.49),vec2(1.15,.90)));
    color = mix(color,vec3(.917,.518,.467),bell(lightingQ,vec2(.72,.49),vec2(.65,.80))*.75);
    color = mix(color,vec3(.88,.40,.43),bell(q,vec2(-.40,-.66),vec2(.75,.57))*.48);
    color = mix(color,vec3(.49,.20,.22),bell(q,vec2(-.42,-.94),vec2(.94,.30))*.64);
    // Wide, diagonal internal shadow visible in the reference, softened by
    // scattering. It moves slightly with the virtual light, not with pixels.
    float bandY = q.y - .08 - q.x*.24 - uLight.y*.05;
    float band = exp(-pow(bandY/.22,2.0)) * (.48+.52*smoothstep(-.8,.6,q.x));
    color = mix(color,vec3(.67,.285,.285),band*.58);
    color -= vec3(.46,.39,.36)*left*(.52+.48*exp(-pow((q.y+.35)/.75,2.0)));
    color -= vec3(.17,.22,.21)*right*.72;
    color = mix(color,vec3(.91,.70,.67),pow(edge,3.0)*.55);
    float innerRim = exp(-pow((f-.94)/.045,2.0));
    color += vec3(.065,.053,.047)*innerRim*smoothstep(-.15,.8,q.x);
    color += vec3(.045,.026,.019)*bell(q,vec2(.16,.91),vec2(.7,.23));
  } else {
    color = id == 0 ? vec3(.796,.663,.668) : vec3(.893,.847,.821);
    color = mix(color, id == 0 ? vec3(.889,.769,.770) : vec3(.968,.939,.910),
      bell(q,vec2(-.12,-.05),vec2(1.22,1.70))*.80);
    color -= vec3(.26,.255,.24)*left;
    color -= vec3(.26,.255,.24)*right;
    color -= vec3(.10,.095,.09)*pow(max(normal.y,0.0),3.0);
    color = mix(color,under,.12*depth);
    // Blurred colored occlusion from the front pebble, in scene space.
    vec2 front = localPoint(p-vec2(7,9),2);
    float occlusion = exp(-max(field(front,2)-1.0,0.0)*10.0);
    color = mix(color,vec3(.57,.36,.36),occlusion*.22);
    color += vec3(.044,.035,.032)*pow(edge,2.0);
  }
  // Fine etched grain + sparse pores, anchored to the moving surface.
  vec2 grainUV = q*vec2(252.0,386.0);
  float fine = noise(grainUV*2.1)-.5;
  float mottling = noise(grainUV*.34)-.5;
  vec2 cell = floor(grainUV*.78);
  vec2 spot = fract(grainUV*.78)-vec2(hash(cell),hash(cell+31.7));
  float pore = (1.0-smoothstep(.035,.24,length(spot))) * step(.73,hash(cell+72.1));
  float textureStrength = id == 2 ? .10 : .17;
  color += (fine*.028 + mottling*.014 - pore*textureStrength) * uGrain * (1.0+edge*.8);
  // A very narrow frosted edge, not a white outline around every object.
  color += vec3(.09,.075,.069)*exp(-max(1.0-f,0.0)*100.0)*.32;
  color.r += uWarmth*.015;
  color.b -= uWarmth*.015;
  return mix(under,clamp(color,0.0,1.0),mask);
}
void main() {
  vec2 uv = gl_FragCoord.xy/uResolution;
  uv.y = 1.0-uv.y;
  // Fit the entire portrait composition; wide displays extend the backdrop.
  float scale = uView.y/1280.0;
  if (uView.x/uView.y < 590.0/1280.0) scale = uView.x/590.0;
  vec2 p = (uv*uView-uView*.5)/scale+vec2(295,640);
  vec3 color = background(p);
  float shadow = bell(p,vec2(260,1160),vec2(300,135));
  color -= vec3(.10,.105,.105)*shadow*.50;
  color = pebble(color,p,0);
  color = pebble(color,p,1);
  color = pebble(color,p,2);
  color += (hash(gl_FragCoord.xy)-.5)/255.0;
  fragColor = vec4(color,1);
}`;
