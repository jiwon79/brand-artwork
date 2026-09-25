import { deformationSource, foregroundGlassShape } from './deformation';

// A fixed-camera, analytic relief renderer. Coordinates are in the reference's
// 590 × 1280 composition. Each glass body has an independent silhouette, material,
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
uniform vec2 uOffsets[3];
uniform vec2 uLight;
uniform float uRotations[3];
uniform float uGrain;
uniform float uWarmth;
uniform float uSpecular;
uniform float uRim;
uniform float uLightIntensity;
uniform float uForegroundAbsorption;
uniform float uRearAbsorption;
uniform float uAbsorptionWidth;
uniform float uSaturation;
uniform float uRearBlur;
uniform float uEdgeRoll;
uniform float uShadowStrength;
uniform float uShadowSpread;
uniform int uColorway;
uniform bool uUpperGlass;
uniform bool uLowerGlass;
uniform bool uForegroundGlass;
uniform bool uShadows;
uniform bool uShading;
uniform bool uEdgeOptics;
uniform bool uLighting;
// Export-only isolated body response. Zero is the normal artwork path.
uniform int uExportMode;
${deformationSource}

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
vec2 rotate(vec2 p, float angle) {
  float c = cos(angle), s = sin(angle);
  return vec2(c*p.x-s*p.y,s*p.x+c*p.y);
}
// Shared with CPU picking: the reference silhouette before local strain.
const vec2 foregroundCenter = vec2(${foregroundGlassShape.x.toFixed(1)},${foregroundGlassShape.y.toFixed(1)});
const vec2 foregroundSize = vec2(${foregroundGlassShape.width.toFixed(1)},${foregroundGlassShape.height.toFixed(1)});
const float foregroundShear = ${foregroundGlassShape.shear};
const float foregroundExponent = ${foregroundGlassShape.exponent};
const float lightHeight = 550.0;
// The upper rear glass body narrows at its cropped crown, rather than keeping the
// same rounded-rectangle width all the way to the top of the portrait.
vec2 upperProfile(float y) {
  // A soft positive part keeps curvature continuous through the shoulder.
  float t = (-y-.30)/.44;
  float root = sqrt(t*t+.035);
  float taper = .5*(t+root);
  return vec2(245.0*(1.0-.22*taper*taper),
    122.5*taper*(1.0+t/root));
}
vec2 foregroundProfile(float y) {
  float lower = clamp((y+.10)/.40,0.0,1.0);
  float lowerTaper = lower*lower*(3.0-2.0*lower);
  float lowerSlope = 6.0*lower*(1.0-lower)/.40;
  return vec2(foregroundSize.x*(1.0-.11*y-.0325*lowerTaper),
    -foregroundSize.x*(.11+.0325*lowerSlope));
}
vec2 centerFor(int id) { return id == 0 ? vec2(321,299) : id == 1 ? vec2(274,941) : foregroundCenter; }
vec2 canonicalMaterialPoint(vec2 q, int id) {
  if (id == 0) { float y = q.y*408.0; return vec2(q.x*upperProfile(q.y).x+y*.16,y); }
  if (id == 1) { float y = q.y*366.0; return vec2(q.x*260.0+y*.19,y); }
  float y = q.y*foregroundSize.y;
  return vec2(q.x*foregroundProfile(q.y).x+y*foregroundShear,y);
}
vec2 normalizedBodyPoint(vec2 p, int id) {
  p = invertDeformation(rotate(p-centerFor(id)-uOffsets[id],-uRotations[id]),id);
  if (id == 0) {
    float y = p.y/408.0;
    return vec2((p.x-p.y*.16)/upperProfile(y).x,y);
  }
  if (id == 1) return vec2(p.x-p.y*.19,p.y)/vec2(260,366);
  float y = p.y/foregroundSize.y;
  return vec2((p.x-p.y*foregroundShear)/foregroundProfile(y).x,y);
}
float superellipseField(vec2 q, int id) {
  float power = id == 2 ? foregroundExponent : 2.35;
  return pow(abs(q.x),power) + pow(abs(q.y),power);
}
vec3 background(vec2 p) {
  float t = pow(clamp(p.y / 1250.0,0.0,1.0),.82);
  if (uColorway == 1) return mix(vec3(.776,.749,.667),vec3(1.0,.976,.914),t);
  if (uColorway == 2) return mix(vec3(.722,.804,.675),vec3(.980,.996,.957),t);
  if (uColorway == 3) return mix(vec3(.722,.753,.839),vec3(.976,.980,1.0),t);
  if (uColorway == 4) return mix(vec3(.753),vec3(.976),t);
  return mix(vec3(.865,.710,.735),vec3(1.0,.970,.972),t);
}
${colorSpaceSource}
vec3 rgbToHsv(vec3 c) {
  vec4 k = vec4(0.0,-1.0/3.0,2.0/3.0,-1.0);
  vec4 p = mix(vec4(c.bg,k.wz),vec4(c.gb,k.xy),step(c.b,c.g));
  vec4 q = mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));
  float d = q.x-min(q.w,q.y);
  return vec3(abs(q.z+(q.w-q.y)/(6.0*d+1e-7)),d/(q.x+1e-7),q.x);
}
vec3 hsvToRgb(vec3 c) {
  vec3 p = abs(fract(c.xxx+vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0);
  return c.z*mix(vec3(1.0),clamp(p-1.0,0.0,1.0),c.y);
}
// The four iPhone color choices retain the original relief and value pattern.
// Foreground and the two rear bodies use separate saturation/exposure: the
// yellow, green, blue and graphite references do not tint all three equally.
vec3 colorwayGlass(vec3 rose, int id, vec2 q) {
  if (uColorway == 0) return rose;
  vec3 hsv = rgbToHsv(clamp(rose,0.0,1.0));
  if (uColorway == 4) {
    float luma = dot(rose,vec3(.2126,.7152,.0722));
    float lowerSoftening = smoothstep(-.05,.78,q.y);
    float graphite = id == 2 ? .08+.86*pow(luma,.85)+.025*lowerSoftening
      : id == 0 ? pow(luma,1.02)*.89 : pow(luma,1.0)*.92;
    float tint = id == 2 ? .025 : id == 0 ? .035 : .018;
    return clamp(vec3(graphite-tint,graphite,graphite-tint*.25),0.0,1.0);
  }
  float hue = uColorway == 1 ? .145 : uColorway == 2 ? .285 : .540;
  if (id == 1 && uColorway == 1) hue = .095;
  if (id == 0 && uColorway == 2) hue = .250;
  if (id == 0 && uColorway == 3) hue = .560;
  if (id == 1 && uColorway == 2) hue = .350;
  if (id == 1 && uColorway == 3) hue = .505;
  // Keep the peach-vs-rose variation in the existing surface, but place it
  // around the selected color's hue rather than leaving a pink highlight.
  hue += (fract(hsv.x+.5)-.5)*.22;
  // The reference keeps a colored, denser right edge even where the lower
  // left turns milky; do not bleach the whole lower body uniformly.
  float lowerSoftening = smoothstep(-.05,.78,q.y)
    * (1.0-.55*smoothstep(-.1,.85,q.x));
  if (id == 2) hue -= lowerSoftening*(uColorway == 1 ? .025 : .020);
  float saturation = id == 2
    ? (uColorway == 1 ? 1.98 : uColorway == 2 ? 1.78 : 1.64)
    : id == 0 ? 1.55 : 1.60;
  float cap = id == 2 ? (uColorway == 1 ? .86 : uColorway == 2 ? .78 : .72) : .48;
  hsv.y = min(hsv.y*saturation,cap);
  if (id == 2) hsv.y *= mix(1.0,uColorway == 3 ? .76 : .57,lowerSoftening);
  else {
    // Clear rear glass still has a colored body. Rose's near-neutral rear
    // highlights need a pigment floor, otherwise hue rotation stays gray.
    float pigment = id == 0 ? (uColorway == 3 ? .20 : .17)
      : (uColorway == 1 ? .075 : uColorway == 2 ? .095 : .13);
    hsv.y = max(hsv.y,pigment);
  }
  float exposure = id == 2 ? (uColorway == 1 ? .92 : uColorway == 2 ? .91 : .96)+.03*lowerSoftening
    : id == 0 ? .84 : .90;
  hsv.z = min(1.0,pow(hsv.z,id == 2 ? 1.28 : 1.08)*exposure);
  return hsvToRgb(vec3(fract(hue),hsv.y,hsv.z));
}
// A large studio light occupies a lobe of the reflected hemisphere. The
// fixed fill preserves the reference palette while a separate lamp moves.
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
    return vec2((14.0+45.0*leftSide*shoulder+55.0*rightSide+20.0*base)*uAbsorptionWidth,
      .22+.45*leftSide*shoulder+.45*rightSide+.18*base);
  }
  if (id == 0) {
    return vec2((12.0+18.0*leftSide+24.0*rightSide+8.0*base)*uAbsorptionWidth,
      .20+.60*leftSide+.53*rightSide+.12*base);
  }
  return vec2((14.0+22.0*leftSide+24.0*rightSide+12.0*base)*uAbsorptionWidth,
    .20+.60*leftSide+.64*rightSide+.18*base);
}
float contourDistance(vec2 q, int id, mat2 jacobian) {
  // Reference-pixel contour distance, including each silhouette's shear and
  // taper. Optical width varies with position; this is not a stroked outline.
  float exponent = id == 2 ? foregroundExponent : 2.35;
  vec2 gradient = exponent*sign(q)*pow(abs(q),vec2(exponent-1.0));
  vec2 radii = id == 0 ? vec2(245,408) : id == 1 ? vec2(260,366) : vec2(252,386);
  vec2 sceneGradient = gradient/radii;
  if (id == 2) {
    float height = foregroundSize.y;
    vec2 profile = foregroundProfile(q.y);
    sceneGradient = vec2(gradient.x/profile.x,
      gradient.y/height+gradient.x*(-foregroundShear-q.x*profile.y/height)/profile.x);
  } else if (id == 0) {
    vec2 profile = upperProfile(q.y);
    sceneGradient = vec2(gradient.x/profile.x,
      gradient.y/408.0+gradient.x*(-.16-q.x*profile.y/408.0)/profile.x);
  } else {
    sceneGradient.y -= .19*sceneGradient.x;
  }
  sceneGradient = transpose(inverse(jacobian))*sceneGradient;
  return (1.0-superellipseField(q,id))/max(length(sceneGradient),.0001);
}
float contourDistance(vec2 q, int id) {
  return contourDistance(q,id,deformationGradient(canonicalMaterialPoint(q,id),id));
}
// Gaussian half-plane coverage near the projected contour. Two footprints
// separate the close contact shadow from the broad, rose-tinted penumbra.
float shadowCoverage(float distance, float sigma) {
  float t = distance/max(sigma,.1);
  return .5+.5*sign(t)*sqrt(1.0-exp(-.63662*t*t));
}
vec3 castShadow(vec3 under, vec2 p, int id) {
  vec2 center = centerFor(id)+uOffsets[id];
  float gap = id == 2 ? 37.0 : id == 0 ? 10.0 : 16.0;
  vec2 fillOffset = id == 0 ? vec2(-5,9) : id == 1 ? vec2(-8,12) : vec2(7,12);
  vec2 lampOffset = (center-uLight)*gap/(lightHeight-gap);
  // A very distant cursor contributes little light, so it cannot cast an
  // enormous shadow. The studio fill remains when the cursor lamp is off.
  float influence = (1.0-exp(-uLightIntensity))*exp(-dot(center-uLight,center-uLight)/900000.0);
  vec2 offset = mix(fillOffset,lampOffset,influence);
  float contactDistance = contourDistance(normalizedBodyPoint(p-offset*.35,id),id);
  float diffuseDistance = contourDistance(normalizedBodyPoint(p-offset,id),id);
  float spread = id == 0 ? 16.0 : id == 1 ? 27.0 : 17.0;
  float nearShadow = shadowCoverage(contactDistance,(id == 2 ? 3.5 : 5.0)*uShadowSpread);
  float farShadow = shadowCoverage(diffuseDistance,spread*uShadowSpread);
  float density = nearShadow*(id == 2 ? .065 : .04)
    +farShadow*(id == 0 ? .06 : id == 1 ? .095 : .10);
  vec3 extinction = uColorway == 3 ? vec3(1.05,.97,.83)
    : uColorway == 2 ? vec3(1.02,.85,1.08)
    : uColorway == 4 ? vec3(1.0)
    : vec3(.78,1.0,1.04);
  return toSrgb(toLinear(under)*exp(-extinction*density*uShadowStrength));
}
vec3 glassBody(vec3 under, vec2 p, int id, inout float blurRadius) {
  vec2 q = normalizedBodyPoint(p,id);
  mat2 jacobian = mat2(1.0);
  vec3 dent = vec3(0);
  deformedSurfaceGeometry(canonicalMaterialPoint(q,id),id,jacobian,dent);
  float f = superellipseField(q,id);
  vec2 radii = id == 0 ? vec2(245,408) : id == 1 ? vec2(260,366) : vec2(252,386);
  float distance = contourDistance(q,id,jacobian);
  float aa = max(fwidth(distance)*.7,.65);
  float mask = smoothstep(-aa,aa,distance);
  float softSide = .58*smoothstep(-.65,.85,q.x)+.42*smoothstep(-.15,.95,q.y);
  float opticalWidth = mix(9.0,42.0,softSide);
  vec2 volume = edgeVolume(q,id);
  // Store a smoothly varying blur footprint alongside the unblurred color.
  // The resolve pass really filters color AND grain, including across the
  // silhouette; merely fading a bright band would leave a hard contour.
  // Defocus belongs to the silhouette, not the whole dark shoulder: buried
  // inclusions must remain visible inside the rear objects' thick glass.
  float focusWidth = id == 2 ? mix(10.0,24.0,softSide) : mix(7.0,15.0,softSide);
  float edgeBlur = id == 2 ? mix(1.1,2.5,softSide)
    : (id == 0 ? mix(1.35,2.3,softSide) : mix(1.6,2.8,softSide))*uRearBlur;
  float localBlur = edgeBlur*exp(-pow(max(distance,0.0)/focusWidth,1.35));
  float outsideFalloff = exp(-pow(max(-distance,0.0)/max(12.0,edgeBlur*3.0),2.0));
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
  float thickness = 1.0;
  {
    mat2 normalMatrix = transpose(inverse(jacobian));
    // Local area expansion thins the relief; compression thickens it. This
    // is an approximate volume response, not a full volumetric simulation.
    thickness = inversesqrt(clamp(determinant(jacobian),.60,1.55));
    normal = normalize(vec3(normalMatrix*(normal.xy*thickness-dent.yz*normal.z),normal.z));
    grainNormal = normalize(vec3(normalMatrix*(grainNormal.xy*thickness-dent.yz*grainNormal.z),grainNormal.z));
  }
  float objectRotation = uRotations[id];
  vec3 sceneNormal = vec3(rotate(grainNormal.xy,objectRotation),grainNormal.z);
  vec3 reflected = reflect(vec3(0,0,-1),sceneNormal);
  float edge = pow(1.0-depth,1.8);
  float left = pow(max(0.0,-normal.x),2.0);
  float right = pow(max(0.0,normal.x),2.0);
  vec2 lightingQ = q;
  vec3 color;
  if (id == 2) {
    color = vec3(.945,.559,.550);
    color = mix(color,vec3(.945,.738,.738),bell(lightingQ,vec2(.30,-.51),vec2(1.40,1.10)));
    color = mix(color,vec3(.958,.812,.786),bell(lightingQ,vec2(-.35,.49),vec2(1.15,.90)));
    color = mix(color,vec3(.990,.616,.538),bell(lightingQ,vec2(.72,.49),vec2(.72,.85))*.85);
    color = mix(color,vec3(.99,.43,.48),bell(q,vec2(-.40,-.66),vec2(.75,.57))*.48);
    color = mix(color,vec3(.44,.14,.16),bell(q,vec2(-.42,-.94),vec2(.80,.24))*.64);
    // Wide, diagonal internal shadow visible in the reference, softened by
    // scattering. The inclusion belongs to the glass, not to the cursor.
    float bandY = q.y + .075 - q.x*.27;
    float band = exp(-pow(bandY/.19,2.0)) * (.62+.38*smoothstep(-.8,.6,q.x));
    color = mix(color,vec3(.865,.34,.33),band*.85);
    color -= vec3(.030,.020,.017)*band;
    color -= vec3(.39,.29,.265)*left*(.20+.80*exp(-pow((q.y+.48)/.65,2.0)));
    color -= vec3(.19,.23,.21)*right*(.25+.75*(1.0-smoothstep(.2,.75,q.y)));
    color += vec3(.075,.022,.018)*bell(q,vec2(.62,-.28),vec2(.30,.80));
    color -= vec3(.095,.10,.095)*right*exp(-max(distance,0.0)/(opticalWidth*1.5))
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
  }
  if (!uShading) color = id == 2 ? vec3(.945,.559,.550) : id == 0 ? vec3(.858,.690,.698) : vec3(.938,.865,.849);
  // A grazing reflection rolls inward from the surface, rather than peaking
  // at a fixed inset. Its width, absorption and intensity change independently.
  float sideLight = .12+.64*bell(q,vec2(.90,-.45),vec2(.50,.80))
    +.28*bell(q,vec2(-.65,.72),vec2(.65,.65));
  float inside = max(distance,0.0);
  float rimLight = exp(-inside/opticalWidth)*sideLight;
  float upperLight = softbox(reflected,vec3(.92,-.48,.70),.52);
  float lowerLight = softbox(reflected,vec3(-1.10,.32,.48),.55);
  float reflection = upperLight*bell(q,vec2(.55,-.66),vec2(1.4,1.05))*.12
    + lowerLight*bell(q,vec2(-.86,.51),vec2(1.4,1.0))*.15;
  if (id != 2) reflection *= id == 0 ? .25 : .32;
  // One scene-space area-light approximation. Surface height, distance and
  // rotated normals determine where each glass body receives the same lamp.
  // Broad diffuse + tighter frosted reflection, not three cloned spotlights.
  float surfaceHeight = id == 2 ? 100.0+depth*125.0*thickness+dent.x : 15.0+depth*85.0*thickness+dent.x;
  vec3 toLight = vec3(uLight-p,lightHeight-surfaceHeight);
  vec3 cursorDirection = normalize(toLight);
  float cursorFacing = max(dot(sceneNormal,cursorDirection),0.0);
  vec3 halfVector = normalize(cursorDirection+vec3(0,0,1));
  float cursorSpecular = pow(max(dot(sceneNormal,halfVector),0.0),14.0);
  float falloff = 280000.0/(280000.0+dot(toLight,toLight));
  float cursorEnergy = uLightIntensity*falloff*(.09*cursorFacing+.34*cursorSpecular);
  float lightResponse = 1.0-exp(-cursorEnergy);
  float fresnel = .04+.96*pow(1.0-max(normal.z,0.0),5.0);
  float grazing = rimLight*.13*(0.6+fresnel*.4)*uRim;
  float luminance = dot(color,vec3(.2126,.7152,.0722));
  color = mix(vec3(luminance),color,uSaturation);
  // A dense shoulder with a longer inward tail. The thin transmitted lip
  // below softens the outside, placing peak density just inside the glass.
  float edgeCore = exp(-pow(inside/volume.x,1.45));
  float edgeTail = exp(-pow(inside/(volume.x*1.8),2.0));
  float absorption = id == 2 ? uForegroundAbsorption : uRearAbsorption;
  float opticalDepth = (uEdgeOptics ? 1.0 : 0.0)*volume.y*(.78*edgeCore+.22*edgeTail)*absorption*thickness;
  vec3 extinction = id == 1 ? vec3(.50,.57,.55) : vec3(.44,.48,.46);
  vec3 transmission = exp(-extinction*opticalDepth);
  vec3 litSurface = toLinear(max(color,0.0))
    +vec3(1.0,.94,.91)*(reflection*uSpecular+grazing)*(uLighting ? 1.0 : 0.0);
  // Approach white without clipping away the rose color or frost relief.
  litSurface += max(vec3(1.0,.97,.96)-litSurface,0.0)*lightResponse*(uLighting ? 1.0 : 0.0);
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
  float textureStrength = id == 2 ? .11 : id == 0 ? .21 : .20;
  float facets = smoothstep(.58,.86,micro.x);
  float diagonal = exp(-pow((q.y+.075-q.x*.27)/.34,2.0));
  vec2 grainLight = normalize(vec2(-.16,-.20)+rotate(cursorDirection.xy,-objectRotation)*uLightIntensity);
  float relief = dot(micro.yz*.018+coarse.yz*.009,grainLight)*grainFilter*surfaceRelief;
  float sparkle = facets*((id == 2 ? .020 : .010)+(uLighting ? reflection*.15
    +cursorSpecular*falloff*uLightIntensity*.030 : 0.0)+(id == 2 ? diagonal*.045 : 0.0));
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
    color -= vec3(.100,.075,.065)*flakes*uGrain*(.35+.65*edge);
    color -= vec3(.080,.065,.055)*broadFlakes*uGrain;
  }
  color.r += uWarmth*.015;
  color.b -= uWarmth*.015;
  color = colorwayGlass(color,id,q);
  // The reference's outer skin transmits the backdrop before the optical
  // path thickens. This asymmetric inward roll is separate from blur and
  // from the cast shadow; blurring an opaque dark cutout cannot reproduce it.
  float leftLip = 1.0-smoothstep(-.92,-.22,q.x);
  float rightLip = smoothstep(.22,.92,q.x);
  float lowerLip = smoothstep(.25,.96,q.y);
  float lipWidth = id == 2 ? 3.0+6.0*leftLip+2.0*rightLip+lowerLip
    : 3.0+1.0*leftLip+2.0*rightLip+lowerLip;
  float lipStrength = id == 2 ? .40+.22*leftLip : .68;
  float lipTransmission = uEdgeOptics && uEdgeRoll > .001 ? lipStrength*exp(-inside/(lipWidth*uEdgeRoll)) : 0.0;
  color = toSrgb(mix(toLinear(clamp(color,0.0,1.0)),toLinear(under),lipTransmission));
  return mix(under,clamp(color,0.0,1.0),mask);
}
void main() {
  vec2 uv = gl_FragCoord.xy/uResolution;
  uv.y = 1.0-uv.y;
  // Fit the entire portrait composition; wide displays extend the backdrop.
  float scale = uView.y/1280.0;
  if (uView.x/uView.y < 590.0/1280.0) scale = uView.x/590.0;
  vec2 p = (uv*uView-uView*.5)/scale+vec2(295,640);
  if (uExportMode != 0) {
    if (uExportMode >= 7) {
      vec3 shadow = castShadow(vec3(1.0),p,uExportMode-7);
      fragColor = vec4(shadow,0.0);
      return;
    }
    int id = (uExportMode-1)%3;
    vec3 under = uExportMode <= 3 ? vec3(0.0) : vec3(1.0);
    float isolatedBlur = 0.0;
    vec3 isolatedColor = glassBody(under,p,id,isolatedBlur);
    fragColor = vec4(isolatedColor,clamp(isolatedBlur/16.0,0.0,1.0));
    return;
  }
  vec3 color = background(p);
  float blurRadius = 0.0;
  if (uUpperGlass) {
    if (uShadows) color = castShadow(color,p,0);
    color = glassBody(color,p,0,blurRadius);
  }
  if (uLowerGlass) {
    if (uShadows) color = castShadow(color,p,1);
    color = glassBody(color,p,1,blurRadius);
  }
  if (uForegroundGlass) {
    if (uShadows) color = castShadow(color,p,2);
    color = glassBody(color,p,2,blurRadius);
  }
  fragColor = vec4(color,clamp(blurRadius/16.0,0.0,1.0));
}`;

// Variable-radius, linear-light resolve. Only the grazing/far-side region is
// progressively softened; the central frosted surface retains its relief.
export const resolveSource = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uMaterialTexture;
uniform vec2 uResolution;
uniform vec2 uOutputResolution;
uniform float uReferenceScale;
uniform float uDiffusion;
${colorSpaceSource}
vec3 sampleLight(vec2 uv) { return toLinear(texture(uMaterialTexture,uv).rgb); }
void main() {
  vec2 uv = gl_FragCoord.xy/uOutputResolution;
  vec4 center = texture(uMaterialTexture,uv);
  float dither = fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
  float pixelRadius = center.a*16.0*uReferenceScale*uDiffusion;
  if (pixelRadius < .25) {
    fragColor = vec4(center.rgb+dither/255.0,1);
    return;
  }
  vec2 radius = vec2(pixelRadius)/uResolution;
  // Binomial Gaussian kernel avoids a sharp center or cross-shaped halo at
  // larger footprints. Its weights sum to one, preserving surface exposure.
  const float weights[5] = float[5](1.0,4.0,6.0,4.0,1.0);
  vec3 color = vec3(0);
  for (int y=0; y<5; y++) {
    for (int x=0; x<5; x++) {
      color += sampleLight(uv+vec2(x-2,y-2)*radius)*weights[x]*weights[y]/256.0;
    }
  }
  fragColor = vec4(toSrgb(color)+dither/255.0,1);
}`;
