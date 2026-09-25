export type Point = { x: number; y: number };
export type DeformationField = { center: Point; displacement: Point; indentation: number };
export type DeformationState = { deformationFields: DeformationField[] };
export const glassBodyIds = { upper: 0, lower: 1, foreground: 2 } as const;
export type GlassBodyId = typeof glassBodyIds[keyof typeof glassBodyIds];
export const glassBodyOrder = [glassBodyIds.upper, glassBodyIds.lower, glassBodyIds.foreground] as const;
export const maxGrips = 5;
export const deformationSubsteps = 4;
export const maxDeformationFields = maxGrips*deformationSubsteps;
export const foregroundGlassShape = { x: 298, y: 645, width: 252, height: 386, shear: .045, exponent: 2.45 };
export const glassBodyShapes = [
  { x: 321, y: 299, width: 245, height: 408, shear: .16, exponent: 2.35 },
  { x: 274, y: 941, width: 260, height: 366, shear: .19, exponent: 2.35 },
  foregroundGlassShape,
] as const;
export function glassBodyWidthAt(id: GlassBodyId, y: number) {
  const shape = glassBodyShapes[id];
  if (id === 0) {
    const t = (-y-.30)/.44, taper = .5*(t+Math.sqrt(t*t+.035));
    return shape.width*(1-.22*taper*taper);
  }
  if (id === 1) return shape.width;
  const lower = Math.max(0,Math.min(1,(y+.10)/.40));
  return shape.width*(1-.11*y-.0325*lower*lower*(3-2*lower));
}
const pressRadius = 145, spread = .055;

export function rotate(point: Point, angle: number): Point {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: c*point.x-s*point.y, y: s*point.x+c*point.y };
}

// Compose four small maps per grip. At the maximum stretch setting each
// substep stays below the Gaussian foldover threshold; its footprint grows
// modestly so opposing grips stretch the middle without cancelling out.
function influenceRadius(field: DeformationField) {
  return 210+.25*Math.hypot(field.displacement.x,field.displacement.y);
}
function warp(p: Point, field: DeformationField): Point {
  const dx = p.x-field.center.x, dy = p.y-field.center.y, r2 = dx*dx+dy*dy;
  const r = influenceRadius(field), w = Math.exp(-.5*r2/(r*r));
  const h = field.indentation*spread*Math.exp(-.5*r2/(pressRadius*pressRadius));
  return { x: p.x+field.displacement.x*w+dx*h, y: p.y+field.displacement.y*w+dy*h };
}
function gradient(p: Point, field: DeformationField) {
  const dx = p.x-field.center.x, dy = p.y-field.center.y, r2 = dx*dx+dy*dy;
  const r = influenceRadius(field), w = Math.exp(-.5*r2/(r*r));
  const h = field.indentation*spread*Math.exp(-.5*r2/(pressRadius*pressRadius));
  const gx = -dx*w/(r*r), gy = -dy*w/(r*r);
  const hx = -dx*h/(pressRadius*pressRadius), hy = -dy*h/(pressRadius*pressRadius);
  return { a: 1+field.displacement.x*gx+h+dx*hx, b: field.displacement.x*gy+dx*hy,
    c: field.displacement.y*gx+dy*hx, d: 1+field.displacement.y*gy+h+dy*hy };
}
export function applyDeformation(p: Point, state: DeformationState): Point {
  for (const field of state.deformationFields) p = warp(p,field);
  return p;
}
export function deformationGradient(p: Point, state: DeformationState) {
  let j = { a: 1, b: 0, c: 0, d: 1 };
  for (const field of state.deformationFields) {
    const g = gradient(p,field);
    j = { a: g.a*j.a+g.b*j.c, b: g.a*j.b+g.b*j.d,
      c: g.c*j.a+g.d*j.c, d: g.c*j.b+g.d*j.d };
    p = warp(p,field);
  }
  return j;
}
export function invertDeformation(point: Point, state: DeformationState): Point {
  const deformationFields = state.deformationFields;
  for (let k=deformationFields.length-1;k>=0;k--) {
    const field = deformationFields[k];
    let p = { ...point };
    for (let i=0;i<5;i++) {
      const warped = warp(p,field), j = gradient(p,field);
      const ex = warped.x-point.x, ey = warped.y-point.y;
      const determinant = Math.max(.05,j.a*j.d-j.b*j.c);
      p = { x: p.x-(j.d*ex-j.b*ey)/determinant, y: p.y-(-j.c*ex+j.a*ey)/determinant };
    }
    point = p;
  }
  return point;
}

export const deformationSource = `
uniform ivec2 uDeformationRanges[3];
uniform vec4 uDeformationFields[${maxDeformationFields}];
// x = indentation, y = inverse squared influence radius (constant per field).
uniform vec2 uDeformationMeta[${maxDeformationFields}];
const float pressRadius = ${pressRadius.toFixed(1)};
const float inversePressRadius2 = 1.0/(pressRadius*pressRadius);
vec2 warpGradient(vec2 p, int i, out mat2 j, out float shoulder) {
  vec2 d = p-uDeformationFields[i].xy, displacement = uDeformationFields[i].zw;
  float r2 = dot(d,d), inverseRadius2 = uDeformationMeta[i].y;
  float w = exp(-.5*r2*inverseRadius2);
  shoulder = exp(-.5*r2*inversePressRadius2);
  float h = uDeformationMeta[i].x*${spread}*shoulder;
  j = mat2(1.0+h)+outerProduct(displacement,-d*w*inverseRadius2)
    +outerProduct(d,-d*h*inversePressRadius2);
  return p+displacement*w+d*h;
}
mat2 deformationGradient(vec2 p, int id) {
  mat2 j = mat2(1.0);
  for (int i=uDeformationRanges[id].x;i<uDeformationRanges[id].y;i++) {
    mat2 g; float shoulder;
    p = warpGradient(p,i,g,shoulder);
    j = g*j;
  }
  return j;
}
vec2 invertDeformation(vec2 point, int id) {
  for (int k=uDeformationRanges[id].y-1;k>=uDeformationRanges[id].x;k--) {
    vec2 p = point;
    for (int i=0;i<5;i++) {
      mat2 j; float shoulder;
      vec2 error = warpGradient(p,k,j,shoulder)-point;
      // Keep all five iterations: early exit error can accumulate through
      // heavily compressed, overlapping grips.
      p -= mat2(j[1][1],-j[0][1],-j[1][0],j[0][0])*error/max(determinant(j),.05);
    }
    point = p;
  }
  return point;
}
// Compute pressure relief and the material Jacobian in a single traversal.
void deformedSurfaceGeometry(vec2 p, int id, out mat2 j, out vec3 relief) {
  relief = vec3(0);
  j = mat2(1.0);
  for (int i=uDeformationRanges[id].x;i<uDeformationRanges[id].y;i++) {
    vec2 d = p-uDeformationFields[i].xy;
    mat2 g; float shoulder;
    vec2 next = warpGradient(p,i,g,shoulder);
    float r2 = dot(d,d)*inversePressRadius2;
    float inner = shoulder*shoulder;
    float height = -45.0*inner+8.0*r2*shoulder;
    float derivative = 45.0*inner+8.0*(1.0-.5*r2)*shoulder;
    relief += vec3(height,transpose(j)*(2.0*d*derivative*inversePressRadius2))*uDeformationMeta[i].x;
    j = g*j;
    p = next;
  }
}
`;
