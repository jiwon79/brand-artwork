// Camera-space plane slopes, with the same lens shift used by the shader.
export function makeFrustum(aspect, tanFov, shift = [0, 0], margin = [0,0]) {
  const slopes = [(shift[0]-1-margin[0])*tanFov*aspect, (shift[0]+1+margin[0])*tanFov*aspect, (shift[1]-1-margin[1])*tanFov, (shift[1]+1+margin[1])*tanFov];
  return [...slopes, ...slopes.map(s => Math.hypot(1,s))];
}

// A conservative sphere test; ellipsoidal Gaussian support fits in this sphere.
// False positives are harmless. A Gaussian intersecting any visible ray must
// survive, including near-plane crossings and a camera inside the cloud.
export function sphereInFrustum(x,y,z,r,f) {
  return z+r >= 0.01 &&
    x-f[0]*z >= -r*f[4] && f[1]*z-x >= -r*f[5] &&
    y-f[2]*z >= -r*f[6] && f[3]*z-y >= -r*f[7];
}

export function worldFrustumPlanes(frame,f) {
  const {right,up,forward,eye}=frame;
  return [[0,0,1,.01],[1,0,-f[0],0],[-1,0,f[1],0],[0,1,-f[2],0],[0,-1,f[3],0]].map(local=>{
    const p=[0,1,2].map(i=>local[0]*right[i]+local[1]*up[i]+local[2]*forward[i]);
    return [...p,-(p[0]*eye[0]+p[1]*eye[1]+p[2]*eye[2])-local[3]];
  });
}

// -1 outside, 0 intersecting, 1 entirely inside. Bounds are center + extents.
export function classifyBox(bounds,offset,planes) {
  let inside=true;
  for(const p of planes) {
    const d=p[0]*bounds[offset]+p[1]*bounds[offset+1]+p[2]*bounds[offset+2]+p[3];
    const r=Math.abs(p[0])*bounds[offset+3]+Math.abs(p[1])*bounds[offset+4]+Math.abs(p[2])*bounds[offset+5];
    if(d+r<0)return -1;
    if(d-r<0)inside=false;
  }
  return inside?1:0;
}
