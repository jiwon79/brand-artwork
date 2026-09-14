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
uniform float uSpecular;
uniform float uRim;
uniform float uSaturation;

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
  float width = 252.0 * (1.0 - .11*y + uPress*.014);
  return vec2((p.x-p.y*.045)/width, y);
}
float field(vec2 q, int id) {
  float power = id == 2 ? 2.45 : 2.35;
  return pow(abs(q.x),power) + pow(abs(q.y),power);
}
vec3 background(vec2 p) {
  return mix(vec3(.865,.710,.735), vec3(1.0,.970,.972),
    pow(clamp(p.y / 1250.0,0.0,1.0),.82));
}
vec3 toLinear(vec3 c) {
  return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));
}
vec3 toSrgb(vec3 c) {
  return mix(c*12.92,1.055*pow(max(c,0.0),vec3(1.0/2.4))-.055,step(vec3(.0031308),c));
}
// A large studio light occupies a lobe of the reflected hemisphere. The
// highlights follow the relief normals and the pointer's virtual light.
float softbox(vec3 reflected, vec3 center, float spread) {
  return exp(-(1.0-dot(reflected,normalize(center)))/spread);
}
vec3 pebble(vec3 under, vec2 p, int id) {
  vec2 q = localPoint(p,id);
  float f = field(q,id);
  // Convert the implicit contour to a local pixel distance. This keeps the
  // several-pixel optical rim consistent on the sides, crown and base.
  float exponent = id == 2 ? 2.45 : 2.35;
  vec2 gradient = exponent*sign(q)*pow(abs(q),vec2(exponent-1.0));
  vec2 radii = id == 0 ? vec2(245,408) : id == 1 ? vec2(253,366) : vec2(252,386);
  float contourDistance = (1.0-f)/max(length(gradient/radii),.0001);
  float aa = max(fwidth(contourDistance)*.8,.8);
  float mask = smoothstep(-aa,aa,contourDistance);
  float halo = exp(-pow(contourDistance/3.5,2.0))*.025*uRim;
  under += vec3(1.0,.84,.79)*halo;
  if (mask <= 0.0) return under;
  float depth = sqrt(max(0.0,1.0-f));
  vec2 slope = sign(q)*pow(abs(q),vec2(1.45));
  vec3 normal = normalize(vec3(slope.x, slope.y*.62, depth*.70+.03));
  vec3 reflected = reflect(vec3(0,0,-1),normal);
  float edge = pow(1.0-depth,1.8);
  float left = pow(max(0.0,-normal.x),2.0);
  float right = pow(max(0.0,normal.x),2.0);
  vec2 lightingQ = q-uLight*.10;
  vec3 color;
  if (id == 2) {
    color = vec3(.945,.559,.550);
    color = mix(color,vec3(.945,.738,.738),bell(lightingQ,vec2(.30,-.51),vec2(1.40,1.10)));
    color = mix(color,vec3(.958,.812,.786),bell(lightingQ,vec2(-.35,.49),vec2(1.15,.90)));
    color = mix(color,vec3(.990,.616,.538),bell(lightingQ,vec2(.72,.49),vec2(.72,.85))*.85);
    color = mix(color,vec3(.99,.43,.48),bell(q,vec2(-.40,-.66),vec2(.75,.57))*.48);
    color = mix(color,vec3(.49,.16,.18),bell(q,vec2(-.42,-.94),vec2(.80,.20))*.52);
    // Wide, diagonal internal shadow visible in the reference, softened by
    // scattering. It moves slightly with the virtual light, not with pixels.
    float bandY = q.y + .075 - q.x*.27 - uLight.y*.06;
    float band = exp(-pow(bandY/.19,2.0)) * (.62+.38*smoothstep(-.8,.6,q.x));
    color = mix(color,vec3(.865,.34,.33),band*.85);
    color -= vec3(.39,.37,.34)*left*(.20+.80*exp(-pow((q.y+.48)/.65,2.0)));
    color -= vec3(.19,.23,.21)*right*(.25+.75*(1.0-smoothstep(.2,.75,q.y)));
    color -= vec3(.095,.045,.035)*bell(q,vec2(.78,.12),vec2(.50,.30));
    color = mix(color,vec3(.85,.56,.52),pow(edge,3.0)*.40);
  } else {
    color = id == 0 ? vec3(.855,.692,.707) : vec3(.938,.865,.849);
    color = mix(color, id == 0 ? vec3(.938,.805,.814) : vec3(.989,.948,.934),
      bell(q,vec2(-.12,-.05),vec2(1.40,1.90))*.80);
    color -= vec3(.16,.175,.165)*left;
    color -= vec3(.15,.17,.16)*right*(id == 1 ? .55 : 1.0);
    color -= vec3(.10,.095,.09)*pow(max(normal.y,0.0),3.0);
    color = mix(color,under,.07*depth);
    // Blurred colored occlusion from the front pebble, in scene space.
    vec2 front = localPoint(p-vec2(7,9),2);
    float occlusion = exp(-max(field(front,2)-1.0,0.0)*10.0);
    color = mix(color,vec3(.57,.36,.36),occlusion*.22);
  }
  // Frosted glass has a dark absorption band just inside a soft reflected rim.
  // Directional weighting prevents the contour from becoming a uniform stroke.
  float sideLight = .25+.75*smoothstep(-.8,.8,normal.x + .25*normal.y);
  float innerShade = exp(-pow((contourDistance-16.0)/16.0,2.0));
  color -= vec3(.065,.085,.080)*innerShade*uRim;
  float rimLight = exp(-pow((contourDistance-2.8)/4.8,2.0))*sideLight;
  float broadRim = exp(-pow((contourDistance-8.0)/16.0,2.0))*sideLight;
  vec2 lightShift = uLight*.75;
  float upperLight = softbox(reflected,vec3(.92+lightShift.x,-.48+lightShift.y,.70),.52);
  float lowerLight = softbox(reflected,vec3(-1.10+lightShift.x,.32+lightShift.y,.48),.55);
  float reflection = upperLight*bell(q,vec2(.55,-.66),vec2(1.4,1.05))*.12
    + lowerLight*bell(q,vec2(-.86,.51),vec2(1.4,1.0))*.15;
  if (id != 2) reflection *= .30;
  float fresnel = .04+.96*pow(1.0-max(normal.z,0.0),5.0);
  float grazing = (rimLight*.09+broadRim*.038)*(0.6+fresnel*.4)*uRim;
  float luminance = dot(color,vec3(.2126,.7152,.0722));
  color = mix(vec3(luminance),color,uSaturation);
  color = toSrgb(toLinear(max(color,0.0))
    +vec3(1.0,.94,.91)*(reflection*uSpecular+grazing));

  // Frost: irregular bright microfacets and softer pits. Both belong to the
  // moving surface, with sparkle strongest where a studio light is reflected.
  vec2 grainUV = q*vec2(252.0,386.0);
  float fine = noise(grainUV*2.1)-.5;
  float mottling = noise(grainUV*.34)-.5;
  vec2 cell = floor(grainUV*.78);
  vec2 spot = fract(grainUV*.78)-vec2(hash(cell),hash(cell+31.7));
  float pore = (1.0-smoothstep(.035,.24,length(spot))) * step(.73,hash(cell+72.1));
  float textureStrength = id == 2 ? .075 : .11;
  float facets = smoothstep(.62,.88,noise(grainUV*1.8));
  float diagonal = exp(-pow((q.y+.075-q.x*.27)/.34,2.0));
  float sparkle = facets*(.018+reflection*.20+(id == 2 ? diagonal*.045 : 0.0));
  color += (fine*.025 + mottling*.012 - pore*textureStrength + sparkle)
    * uGrain * (1.0+edge*.6);
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
