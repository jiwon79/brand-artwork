export type Point = { x: number; y: number };
export type ContactField = { contact: Point; pull: Point; press: number };
export type MaterialState = { fields: ContactField[] };
export const maxContacts = 5;
export const substeps = 4;
export const maxFields = maxContacts*substeps;
export const front = { x: 298, y: 645, width: 252, height: 386, shear: .045, exponent: 2.45 };
const pressRadius = 145, spread = .055;

export function rotate(point: Point, angle: number): Point {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: c*point.x-s*point.y, y: s*point.x+c*point.y };
}

// Compose four small maps per grip. At the maximum stretch setting each
// substep stays below the Gaussian foldover threshold; its footprint grows
// modestly so opposing grips stretch the middle without cancelling out.
function radius(field: ContactField) { return 210+.25*Math.hypot(field.pull.x,field.pull.y); }
function warp(p: Point, field: ContactField): Point {
  const dx = p.x-field.contact.x, dy = p.y-field.contact.y, r2 = dx*dx+dy*dy;
  const r = radius(field), w = Math.exp(-.5*r2/(r*r));
  const h = field.press*spread*Math.exp(-.5*r2/(pressRadius*pressRadius));
  return { x: p.x+field.pull.x*w+dx*h, y: p.y+field.pull.y*w+dy*h };
}
function gradient(p: Point, field: ContactField) {
  const dx = p.x-field.contact.x, dy = p.y-field.contact.y, r2 = dx*dx+dy*dy;
  const r = radius(field), w = Math.exp(-.5*r2/(r*r));
  const h = field.press*spread*Math.exp(-.5*r2/(pressRadius*pressRadius));
  const gx = -dx*w/(r*r), gy = -dy*w/(r*r);
  const hx = -dx*h/(pressRadius*pressRadius), hy = -dy*h/(pressRadius*pressRadius);
  return { a: 1+field.pull.x*gx+h+dx*hx, b: field.pull.x*gy+dx*hy,
    c: field.pull.y*gx+dy*hx, d: 1+field.pull.y*gy+h+dy*hy };
}
export function deform(p: Point, state: MaterialState): Point {
  for (const field of state.fields) p = warp(p,field);
  return p;
}
export function deformationGradient(p: Point, state: MaterialState) {
  let j = { a: 1, b: 0, c: 0, d: 1 };
  for (const field of state.fields) {
    const g = gradient(p,field);
    j = { a: g.a*j.a+g.b*j.c, b: g.a*j.b+g.b*j.d,
      c: g.c*j.a+g.d*j.c, d: g.c*j.b+g.d*j.d };
    p = warp(p,field);
  }
  return j;
}
export function undeform(point: Point, state: MaterialState): Point {
  for (let k=state.fields.length-1;k>=0;k--) {
    const field = state.fields[k];
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
uniform int uContactCount;
uniform vec4 uContacts[${maxFields}];
uniform float uPressures[${maxFields}];
const float pressRadius = ${pressRadius.toFixed(1)};
vec2 warp(vec2 p, int i) {
  vec2 d = p-uContacts[i].xy, pull = uContacts[i].zw;
  float r = 210.0+.25*length(pull), r2 = dot(d,d);
  float w = exp(-.5*r2/(r*r));
  float h = uPressures[i]*${spread}*exp(-.5*r2/(pressRadius*pressRadius));
  return p+pull*w+d*h;
}
mat2 gradient(vec2 p, int i) {
  vec2 d = p-uContacts[i].xy, pull = uContacts[i].zw;
  float r = 210.0+.25*length(pull), r2 = dot(d,d);
  float w = exp(-.5*r2/(r*r));
  float h = uPressures[i]*${spread}*exp(-.5*r2/(pressRadius*pressRadius));
  return mat2(1.0)+outerProduct(pull,-d*w/(r*r))+mat2(h)
    +outerProduct(d,-d*h/(pressRadius*pressRadius));
}
mat2 deformationGradient(vec2 p) {
  mat2 j = mat2(1.0);
  for (int i=0;i<uContactCount;i++) { j = gradient(p,i)*j; p = warp(p,i); }
  return j;
}
vec2 undeform(vec2 point) {
  for (int k=uContactCount-1;k>=0;k--) {
    vec2 p = point;
    for (int i=0;i<5;i++) {
      vec2 error = warp(p,k)-point;
      mat2 j = gradient(p,k);
      p -= mat2(j[1][1],-j[0][1],-j[1][0],j[0][0])*error/max(determinant(j),.05);
    }
    point = p;
  }
  return point;
}
vec3 contactRelief(vec2 p) {
  vec3 result = vec3(0);
  mat2 j = mat2(1.0);
  for (int i=0;i<uContactCount;i++) {
    vec2 d = p-uContacts[i].xy;
    float r2 = dot(d,d)/(pressRadius*pressRadius);
    float inner = exp(-r2), shoulder = exp(-.5*r2);
    float height = -45.0*inner+8.0*r2*shoulder;
    float derivative = 45.0*inner+8.0*(1.0-.5*r2)*shoulder;
    result += vec3(height,transpose(j)*(2.0*d*derivative/(pressRadius*pressRadius)))*uPressures[i];
    j = gradient(p,i)*j;
    p = warp(p,i);
  }
  return result;
}`;
