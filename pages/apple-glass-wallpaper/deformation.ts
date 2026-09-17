export type Point = { x: number; y: number };
export type MaterialState = { contact: Point; pull: Point; press: number };
export const front = { x: 298, y: 645, width: 252, height: 386, shear: .045, exponent: 2.45 };
const pullRadius = 210, pressRadius = 145, spread = .055;

export function rotate(point: Point, angle: number): Point {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: c*point.x-s*point.y, y: s*point.x+c*point.y };
}

// Material coordinates -> deformed local coordinates. A broad elastic field
// pulls the contact region; pressure displaces its neighbors radially.
export function deform(p: Point, state: MaterialState): Point {
  const dx = p.x-state.contact.x, dy = p.y-state.contact.y, r2 = dx*dx+dy*dy;
  const w = Math.exp(-.5*r2/(pullRadius*pullRadius));
  const h = state.press*spread*Math.exp(-.5*r2/(pressRadius*pressRadius));
  return { x: p.x+state.pull.x*w+dx*h, y: p.y+state.pull.y*w+dy*h };
}

export function deformationGradient(p: Point, state: MaterialState) {
  const dx = p.x-state.contact.x, dy = p.y-state.contact.y, r2 = dx*dx+dy*dy;
  const w = Math.exp(-.5*r2/(pullRadius*pullRadius));
  const h = state.press*spread*Math.exp(-.5*r2/(pressRadius*pressRadius));
  const gx = -dx*w/(pullRadius*pullRadius), gy = -dy*w/(pullRadius*pullRadius);
  const hx = -dx*h/(pressRadius*pressRadius), hy = -dy*h/(pressRadius*pressRadius);
  return { a: 1+state.pull.x*gx+h+dx*hx, b: state.pull.x*gy+dx*hy,
    c: state.pull.y*gx+dy*hx, d: 1+state.pull.y*gy+h+dy*hy };
}

// CPU picking and all render passes share this invertible material mapping.
export function undeform(point: Point, state: MaterialState): Point {
  let p = { ...point };
  for (let i=0;i<4;i++) {
    const warped = deform(p,state), j = deformationGradient(p,state);
    const ex = warped.x-point.x, ey = warped.y-point.y;
    const determinant = Math.max(.15,j.a*j.d-j.b*j.c);
    p = { x: p.x-(j.d*ex-j.b*ey)/determinant, y: p.y-(-j.c*ex+j.a*ey)/determinant };
  }
  return p;
}

export const deformationSource = `
uniform vec2 uContact;
uniform vec2 uPull;
uniform float uCompression;
const float pullRadius = ${pullRadius.toFixed(1)};
const float pressRadius = ${pressRadius.toFixed(1)};
const float lateralSpread = ${spread};
vec2 deform(vec2 p) {
  vec2 d = p-uContact;
  float r2 = dot(d,d);
  float w = exp(-.5*r2/(pullRadius*pullRadius));
  float h = uCompression*lateralSpread*exp(-.5*r2/(pressRadius*pressRadius));
  return p+uPull*w+d*h;
}
mat2 deformationGradient(vec2 p) {
  vec2 d = p-uContact;
  float r2 = dot(d,d);
  float w = exp(-.5*r2/(pullRadius*pullRadius));
  float h = uCompression*lateralSpread*exp(-.5*r2/(pressRadius*pressRadius));
  vec2 g = -d*w/(pullRadius*pullRadius);
  vec2 gh = -d*h/(pressRadius*pressRadius);
  return mat2(1.0)+outerProduct(uPull,g)+mat2(h)+outerProduct(d,gh);
}
vec2 undeform(vec2 point) {
  vec2 p = point;
  for (int i=0;i<4;i++) {
    vec2 error = deform(p)-point;
    mat2 j = deformationGradient(p);
    p -= mat2(j[1][1],-j[0][1],-j[1][0],j[0][0])*error/max(determinant(j),.15);
  }
  return p;
}
// A pressure dent and a shallow displaced-material shoulder. Height and its
// derivative are used together, so light bends around the actual depression.
vec3 contactRelief(vec2 p) {
  vec2 d = p-uContact;
  float r2 = dot(d,d)/(pressRadius*pressRadius);
  float inner = exp(-r2), shoulder = exp(-.5*r2);
  float height = -45.0*inner+8.0*r2*shoulder;
  float derivative = 45.0*inner+8.0*(1.0-.5*r2)*shoulder;
  return vec3(height,2.0*d*derivative/(pressRadius*pressRadius))*uCompression;
}`;
