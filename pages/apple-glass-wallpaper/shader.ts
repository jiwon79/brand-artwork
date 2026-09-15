// A fixed-camera, analytic relief renderer. Coordinates are in the reference's
// 590 × 1280 composition. Each pebble has an independent silhouette, material,
// depth profile and object-space grain; no photograph is used as a texture.
export const vertexSource = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const colorSpaceSource = `
vec3 toLinear(vec3 c) {
  return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));
}
vec3 toSrgb(vec3 c) {
  return mix(c*12.92,1.055*pow(max(c,0.0),vec3(1.0/2.4))-.055,step(vec3(.0031308),c));
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
uniform float uCursorLight;
uniform float uFrontAbsorption;
uniform float uRearAbsorption;
uniform float uAbsorptionWidth;
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
// Height and analytic derivatives: a grain has a lit shoulder and a shaded
// hollow, instead of being an unrelated black or white screen-space dot.
vec3 reliefNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f), du = 6.0*f*(1.0-f);
  float a = hash(i), b = hash(i+vec2(1,0));
  float c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
  float crossTerm = a-b-c+d;
  return vec3(a+(b-a)*u.x+(c-a)*u.y+crossTerm*u.x*u.y,
    du*vec2(b-a+crossTerm*u.y,c-a+crossTerm*u.x));
}
float bell(vec2 p, vec2 c, vec2 r) {
  vec2 q = (p-c)/r;
  return exp(-dot(q,q)*2.0);
}
// The upper rear pebble narrows at its cropped crown, rather than keeping the
// same rounded-rectangle width all the way to the top of the portrait.
vec2 upperProfile(float y) {
  float taper = clamp((-y-.30)/.44,0.0,1.5);
  float width = 245.0*(1.0-.22*taper*taper);
  float derivative = y > -.96 && y < -.30 ? 245.0*taper : 0.0;
  return vec2(width,derivative);
}
vec2 frontProfile(float y) {
  float lower = clamp((y+.10)/.40,0.0,1.0);
  float lowerTaper = lower*lower*(3.0-2.0*lower);
  float lowerSlope = 6.0*lower*(1.0-lower)/.40;
  return vec2(252.0*(1.0-.11*y-.0325*lowerTaper+uPress*.014),
    -252.0*(.11+.0325*lowerSlope));
}
vec2 localPoint(vec2 p, int id) {
  if (id == 0) {
    p -= vec2(321.0, 299.0) - uOffset*.16;
    float y = p.y/408.0;
    return vec2((p.x-p.y*.16)/upperProfile(y).x,y);
  }
  if (id == 1) {
    p -= vec2(274.0, 941.0) - uOffset*.26;
    return vec2(p.x - p.y*.19, p.y) / vec2(260.0, 366.0);
  }
  p -= vec2(298.0, 645.0) + uOffset;
  float y = p.y / (386.0 * (1.0-uPress*.018));
  return vec2((p.x-p.y*.045)/frontProfile(y).x, y);
}
float field(vec2 q, int id) {
  float power = id == 2 ? 2.45 : 2.35;
  return pow(abs(q.x),power) + pow(abs(q.y),power);
}
vec3 background(vec2 p) {
  return mix(vec3(.865,.710,.735), vec3(1.0,.970,.972),
    pow(clamp(p.y / 1250.0,0.0,1.0),.82));
}
${colorSpaceSource}
// A large studio light occupies a lobe of the reflected hemisphere. The
// highlights follow the relief normals and the pointer's virtual light.
float softbox(vec3 reflected, vec3 center, float spread) {
  return exp(-(1.0-dot(reflected,normalize(center)))/spread);
}
// Reference-pixel width and relative optical density of the edge volume.
// Thick shoulders cast a wide inward penumbra; thinner crowns stay narrower.
// These are artist-shaped optical paths, not physically traced refraction.
vec2 edgeVolume(vec2 q, int id) {
  float leftSide = 1.0-smoothstep(-.92,-.22,q.x);
  float rightSide = smoothstep(.22,.92,q.x);
  float base = smoothstep(.25,.96,q.y);
  if (id == 2) {
    float shoulder = exp(-pow((q.y+.12)/.90,2.0));
    return vec2((12.0+45.0*leftSide*shoulder+55.0*rightSide+20.0*base)*uAbsorptionWidth,
      .22+.45*leftSide*shoulder+.45*rightSide+.18*base);
  }
  if (id == 0) {
    return vec2((12.0+14.0*leftSide+20.0*rightSide+8.0*base)*uAbsorptionWidth,
      .20+.60*leftSide+.53*rightSide+.12*base);
  }
  return vec2((14.0+16.0*leftSide+24.0*rightSide+12.0*base)*uAbsorptionWidth,
    .20+.60*leftSide+.64*rightSide+.18*base);
}
vec3 pebble(vec3 under, vec2 p, int id, inout float blurRadius) {
  vec2 q = localPoint(p,id);
  float f = field(q,id);
  // Reference-pixel contour distance, including each silhouette's shear and
  // taper. Optical width varies with position; this is not a stroked outline.
  float exponent = id == 2 ? 2.45 : 2.35;
  vec2 gradient = exponent*sign(q)*pow(abs(q),vec2(exponent-1.0));
  vec2 radii = id == 0 ? vec2(245,408) : id == 1 ? vec2(260,366) : vec2(252,386);
  vec2 sceneGradient = gradient/radii;
  if (id == 2) {
    float height = 386.0*(1.0-uPress*.018);
    vec2 profile = frontProfile(q.y);
    sceneGradient = vec2(gradient.x/profile.x,
      gradient.y/height+gradient.x*(-.045-q.x*profile.y/height)/profile.x);
  } else if (id == 0) {
    vec2 profile = upperProfile(q.y);
    sceneGradient = vec2(gradient.x/profile.x,
      gradient.y/408.0+gradient.x*(-.16-q.x*profile.y/408.0)/profile.x);
  } else {
    sceneGradient.y -= .19*sceneGradient.x;
  }
  float contourDistance = (1.0-f)/max(length(sceneGradient),.0001);
  float aa = max(fwidth(contourDistance)*.7,.65);
  float mask = smoothstep(-aa,aa,contourDistance);
  float softSide = .58*smoothstep(-.65,.85,q.x)+.42*smoothstep(-.15,.95,q.y);
  float opticalWidth = mix(9.0,42.0,softSide);
  vec2 volume = edgeVolume(q,id);
  // Store a smoothly varying blur footprint alongside the unblurred color.
  // The resolve pass really filters color AND grain, including across the
  // silhouette; merely fading a bright band would leave a hard contour.
  float focusWidth = max(mix(14.0,52.0,softSide),volume.x*1.2);
  float localBlur = mix(.70,3.6,softSide)
    *exp(-pow(max(contourDistance,0.0)/focusWidth,1.35));
  float outsideFalloff = exp(-pow(max(-contourDistance,0.0)/9.0,2.0));
  blurRadius = mix(blurRadius,localBlur,mask);
  blurRadius = max(blurRadius,localBlur*outsideFalloff*(1.0-mask));
  float depth = sqrt(max(0.0,1.0-f));
  // Project material coordinates around the relief so grain compresses on
  // steep sides. Suppress subpixel relief when the portrait is scaled down.
  vec2 curvedGrain = vec2(atan(q.x,depth*.72+.48),atan(q.y,depth*.72+.48))*radii;
  // Rear inclusions lie through a shallower layer: less foreshortening keeps
  // them readable on the shoulders instead of packing into subpixel noise.
  vec2 grainUV = mix(q*radii,curvedGrain,id == 2 ? 1.0 : .20);
  float grainFilter = 1.0-smoothstep(1.1,3.5,length(fwidth(grainUV)));
  if (mask <= 0.0) return under;
  vec2 slope = sign(q)*pow(abs(q),vec2(1.45));
  vec3 normal = normalize(vec3(slope.x, slope.y*.62, depth*.70+.03));
  vec3 micro = reliefNoise(grainUV*.76);
  vec3 coarse = reliefNoise(grainUV*.29+17.3);
  float surfaceRelief = id == 2 ? 1.0 : .20;
  vec2 reliefSlope = (micro.yz*.030+coarse.yz*.014)*uGrain*grainFilter*surfaceRelief;
  vec3 grainNormal = normalize(normal+vec3(reliefSlope,0));
  vec3 reflected = reflect(vec3(0,0,-1),grainNormal);
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
    color = mix(color,vec3(.44,.14,.16),bell(q,vec2(-.42,-.94),vec2(.80,.24))*.64);
    // Wide, diagonal internal shadow visible in the reference, softened by
    // scattering. It moves slightly with the virtual light, not with pixels.
    float bandY = q.y + .075 - q.x*.27 - uLight.y*.06;
    float band = exp(-pow(bandY/.19,2.0)) * (.62+.38*smoothstep(-.8,.6,q.x));
    color = mix(color,vec3(.865,.34,.33),band*.85);
    color -= vec3(.030,.020,.017)*band;
    color -= vec3(.39,.29,.265)*left*(.20+.80*exp(-pow((q.y+.48)/.65,2.0)));
    color -= vec3(.19,.23,.21)*right*(.25+.75*(1.0-smoothstep(.2,.75,q.y)));
    color += vec3(.075,.022,.018)*bell(q,vec2(.62,-.28),vec2(.30,.80));
    color -= vec3(.095,.10,.095)*right*exp(-max(contourDistance,0.0)/(opticalWidth*1.5))
      *(.35+.65*(1.0-smoothstep(.35,.9,q.y)));
    color -= vec3(.125,.065,.050)*bell(q,vec2(.78,.12),vec2(.50,.30));
    color -= vec3(.028,.022,.018)*bell(q,vec2(.26,1.02),vec2(.90,.25));
  } else {
    // Independent rear materials: rose-tinted glass above, milky glass below.
    // Keep their transmitted centers bright; thickness darkens the shoulders
    // asymmetrically instead of dimming the entire object or drawing a rim.
    if (id == 0) {
      color = mix(vec3(.858,.690,.698),vec3(.940,.802,.805),
        bell(lightingQ,vec2(-.12,-.05),vec2(1.40,1.90))*.80);
      color -= vec3(.170,.268,.258)*pow(left,2.2);
      color -= vec3(.15,.18,.18)*pow(right,1.7)*(.80+.50*smoothstep(-.35,.50,q.y));
      color -= vec3(.095,.075,.070)*pow(max(normal.y,0.0),3.0);
    } else {
      color = mix(vec3(.938,.865,.849),vec3(.985,.950,.945),
        bell(lightingQ,vec2(-.12,-.05),vec2(1.40,1.90))*.80);
      color -= vec3(.155,.235,.245)*pow(left,1.3);
      color -= vec3(.190,.315,.320)*pow(right,1.8);
      color -= vec3(.035,.065,.065)*pow(max(normal.y,0.0),3.0);
      color += vec3(.010,.009,.008)*bell(lightingQ,vec2(-.22,.43),vec2(.75,.95));
    }
    color = mix(color,under,.07*depth);
    // Contact darkening and a wider rose-colored transmitted shadow follow
    // the moving front object. Stronger on the exposed right-hand overlap.
    vec2 front = localPoint(p-vec2(8,11)-uLight*5.0,2);
    float separation = max(field(front,2)-1.0,0.0);
    float overlapSide = smoothstep(-.35,.85,front.x);
    float contact = exp(-separation*16.0)*(.12+.16*overlapSide);
    float transmittedShadow = exp(-separation*4.5)*overlapSide;
    color = mix(color,vec3(.54,.32,.33),contact);
    color -= vec3(.020,.045,.040)*transmittedShadow;
  }
  // A grazing reflection rolls inward from the surface, rather than peaking
  // at a fixed inset. Its width, absorption and intensity change independently.
  float sideLight = .12+.64*bell(q,vec2(.90,-.45),vec2(.50,.80))
    +.28*bell(q,vec2(-.65,.72),vec2(.65,.65));
  float inside = max(contourDistance,0.0);
  float rimLight = exp(-inside/opticalWidth)*sideLight;
  vec2 lightShift = uLight*.75;
  float upperLight = softbox(reflected,vec3(.92+lightShift.x,-.48+lightShift.y,.70),.52);
  float lowerLight = softbox(reflected,vec3(-1.10+lightShift.x,.32+lightShift.y,.48),.55);
  float reflection = upperLight*bell(q,vec2(.55,-.66),vec2(1.4,1.05))*.12
    + lowerLight*bell(q,vec2(-.86,.51),vec2(1.4,1.0))*.15;
  if (id != 2) reflection *= id == 0 ? .25 : .32;
  // A broad cursor-driven light sits above the surface. Diffuse energy gives
  // the response a soft frosted character, while a low-power specular lobe
  // makes its movement legible without turning into a sharp glossy dot.
  vec2 cursorAnchor = uLight*vec2(2.15,2.05);
  vec3 cursorDirection = normalize(vec3(cursorAnchor-q,.72));
  float cursorFacing = max(dot(grainNormal,cursorDirection),0.0);
  float cursorPool = bell(q,cursorAnchor,vec2(.88,1.0));
  float cursorSpecular = pow(max(dot(reflect(-cursorDirection,grainNormal),vec3(0,0,1)),0.0),5.0);
  float cursorEnergy = (cursorPool*(.040+.065*cursorFacing)+cursorSpecular*.070)
    *uCursorLight*(id == 2 ? 1.0 : .42);
  float fresnel = .04+.96*pow(1.0-max(normal.z,0.0),5.0);
  float grazing = rimLight*.13*(0.6+fresnel*.4)*uRim;
  float luminance = dot(color,vec3(.2126,.7152,.0722));
  color = mix(vec3(luminance),color,uSaturation);
  // A dense outer shoulder and a longer, softer inward tail. Unlike a fixed
  // inset stripe, the shadow is darkest at the edge and rolls into the face.
  float edgeCore = exp(-pow(inside/volume.x,1.45));
  float edgeTail = exp(-pow(inside/(volume.x*1.8),2.0));
  float absorption = id == 2 ? uFrontAbsorption : uRearAbsorption;
  float opticalDepth = volume.y*(.78*edgeCore+.22*edgeTail)*absorption;
  vec3 extinction = id == 1 ? vec3(.50,.57,.55) : vec3(.44,.48,.46);
  vec3 transmission = exp(-extinction*opticalDepth);
  vec3 litSurface = toLinear(max(color,0.0))
    +vec3(1.0,.94,.91)*(reflection*uSpecular+grazing+cursorEnergy);
  // Attenuate the grazing reflection as well, so white light cannot wash the
  // thick edge back to a pale outline. The resolve progressively softens it.
  color = toSrgb(litSurface*transmission);

  // Several scales of frost: buried cloudy inclusions, relief and small
  // reflective facets. Larger grains survive mobile downscaling.
  float fine = noise(grainUV*2.1)-.5;
  float mottling = noise(grainUV*.34)-.5;
  vec2 poreUV = grainUV*(id == 2 ? .78 : .42);
  vec2 cell = floor(poreUV);
  vec2 poreCenter = vec2(hash(cell),hash(cell+31.7));
  if (id != 2) poreCenter = .20+.60*poreCenter;
  vec2 spot = fract(poreUV)-poreCenter;
  float poreRadius = id == 2 ? .24 : .16+.14*hash(cell+22.9);
  float pore = (1.0-smoothstep(.035,poreRadius,length(spot))) * step(.73,hash(cell+72.1));
  float textureStrength = id == 2 ? .11 : id == 0 ? .14 : .13;
  float facets = smoothstep(.58,.86,micro.x);
  float diagonal = exp(-pow((q.y+.075-q.x*.27)/.34,2.0));
  vec2 grainLight = normalize(vec2(-.65,-.78)+uLight*.55);
  float relief = dot(micro.yz*.018+coarse.yz*.009,grainLight)*grainFilter*surfaceRelief;
  float sparkle = facets*((id == 2 ? .020 : .010)+reflection*.15+(id == 2 ? diagonal*.045 : 0.0));
  float inclusions = smoothstep(.55,.85,coarse.x)*.020;
  float frostVisibility = id == 2 ? .65+.35*diagonal : .48+.35*sqrt(edge);
  color += (fine*.026*grainFilter + mottling*(id == 2 ? .025 : .012) - pore*textureStrength*grainFilter
    -inclusions + relief + sparkle) * uGrain * frostVisibility * (1.0+edge*.35);
  if (id != 2) {
    // Sparse inclusions appear inside the glass, distinct from the tiny
    // surface relief. Warm dark flecks stay legible against the milky center.
    float flakes = smoothstep(.74,.88,noise(grainUV*.40+41.7))
      *(.25+.75*noise(grainUV*.23));
    float broadFlakes = smoothstep(.68,.87,noise(grainUV*.26+21.6))
      *noise(grainUV*.18+7.0)*right;
    color -= vec3(.100,.075,.065)*flakes*uGrain*(.30+.70*edge);
    color -= vec3(.080,.065,.055)*broadFlakes*uGrain;
  }
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
  float blurRadius = 0.0;
  float shadow = bell(p,vec2(260,1160),vec2(300,135));
  color -= vec3(.10,.105,.105)*shadow*.50;
  color = pebble(color,p,0,blurRadius);
  color = pebble(color,p,1,blurRadius);
  color = pebble(color,p,2,blurRadius);
  fragColor = vec4(color,clamp(blurRadius/8.0,0.0,1.0));
}`;

// Variable-radius, linear-light resolve. Only the grazing/far-side region is
// progressively softened; the central frosted surface retains its relief.
export const resolveSource = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uReferenceScale;
uniform float uDiffusion;
${colorSpaceSource}
vec3 sampleLight(vec2 uv) { return toLinear(texture(uScene,uv).rgb); }
void main() {
  vec2 uv = gl_FragCoord.xy/uResolution;
  vec4 center = texture(uScene,uv);
  float dither = fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
  float pixelRadius = center.a*8.0*uReferenceScale*uDiffusion;
  if (pixelRadius < .25) {
    fragColor = vec4(center.rgb+dither/255.0,1);
    return;
  }
  vec2 radius = vec2(pixelRadius)/uResolution;
  vec3 color = toLinear(center.rgb)*.20;
  color += (sampleLight(uv+vec2(radius.x,0))+sampleLight(uv-vec2(radius.x,0))
    +sampleLight(uv+vec2(0,radius.y))+sampleLight(uv-vec2(0,radius.y)))*.12;
  color += (sampleLight(uv+radius)+sampleLight(uv-radius)
    +sampleLight(uv+vec2(radius.x,-radius.y))+sampleLight(uv+vec2(-radius.x,radius.y)))*.07;
  color += (sampleLight(uv+vec2(radius.x*2.2,0))+sampleLight(uv-vec2(radius.x*2.2,0))
    +sampleLight(uv+vec2(0,radius.y*2.2))+sampleLight(uv-vec2(0,radius.y*2.2)))*.01;
  fragColor = vec4(toSrgb(color)+dither/255.0,1);
}`;
