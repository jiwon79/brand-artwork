import {randomGenerator, mix} from './math.js';

// Shared by geometry, edge erosion and the sparse entrainment plumes. Wind is
// world-space, so these features remain attached when the camera or sun moves.
export const CLOUD_WIND = [1, 0, .28];

export function cloudEnvelope(preset, seed) {
  const rng=randomGenerator(seed ^ 0x51ed270b),lobes=[],plumes=[];
  function lobe(x,y,z,rx,ry=rx,rz=rx,kind='dome',parent=null) {
    const radius=Math.min(rx,ry,rz);
    const erosion=Math.min(1.7,.14+.55*radius)*(kind==='anvil'?.45:kind==='base'?.7:1);
    const support=.8+.45*erosion;
    const l=[x,y,z,rx,ry,rz,radius,erosion,support,(1+support/radius)**2];
    l.kind=kind;l.id=lobes.length;l.parentId=parent?.id??-1;
    l.level=parent?parent.level+1:0;l.rootId=parent?.rootId??l.id;
    lobes.push(l);return l;
  }
  function thermal(x,y,z,rx,ry,rz,kind='dome') {
    return lobe(x+(rng()-.5)*.65,y+(rng()-.5)*.3,z+(rng()-.5)*.7,
      rx*mix(.91,1.09,rng()),ry*mix(.92,1.08,rng()),rz*mix(.9,1.1,rng()),kind);
  }
  if(preset==='bank') {
    // Staggered, partially joined rolls with openings, rather than unrelated
    // balls spread uniformly across a rectangle.
    for(let row=0;row<3;row++)for(let col=0;col<6;col++) {
      const x=(col-2.5)*4.6+(row%2)*1.7+(rng()-.5)*1.6;
      const z=(row-1)*5.1+Math.sin(col*1.7+row)*.8+(rng()-.5)*1.4;
      thermal(x,.75+rng()*.8,z,2.7+rng()*.8,1.35+rng()*.85,2.5+rng()*.6);
    }
  } else {
    thermal(-3.8,.55,-.1,4.2,1.1,2.5,'base');
    thermal(1.0,.55,.15,4.5,1.15,2.6,'base');
    thermal(5.1,.4,.1,2.7,.85,1.85,'base');
    thermal(-6.2,1.15,.3,1.85,1.4,1.7);
    thermal(-3.6,2.35,-.45,2.65,2.35,2.75);
    thermal(.1,2.65,-.45,2.65,2.65,2.8);
    thermal(3.5,1.6,.25,2.2,1.65,2.35);
    if(preset==='tower'||preset==='storm') {
      thermal(-1,5.7,-.8,3.15,3.75,2.8);
      thermal(-.8,9.1,-1.2,2.55,3.0,2.4);
      thermal(.0,11.1,-.8,1.85,1.85,1.85);
      thermal(2.7,5.8,.0,1.95,2.8,1.95);
    }
    if(preset==='storm') {
      // The mature top spreads downwind. It is a shallow, smooth ice canopy,
      // not another recursively cauliflower-covered ellipsoid.
      thermal(-.2,11.65,-.8,5.1,1.15,3.65,'anvil');
      thermal(4.2,11.9,-.6,4.3,.85,3.1,'anvil');
      thermal(7.5,12.1,-.3,3.0,.48,2.3,'anvil');
    }
  }
  const parents=[...lobes];
  const inside=(p,exclude,threshold=.86)=>parents.some(l=>l!==exclude&&
    ((p[0]-l[0])/l[3])**2+((p[1]-l[1])/l[4])**2+((p[2]-l[2])/l[5])**2<threshold**2);
  for(const parent of parents) {
    if(parent.kind==='base'||parent.kind==='anvil')continue;
    const [x,y,z,rx,ry,rz]=parent;
    const count=6+Math.floor(rng()*5);
    for(let n=0;n<count;n++) {
      const phi=rng()*Math.PI*2,h=mix(-.35,.95,rng()),rr=Math.sqrt(1-h*h);
      const r=Math.min(rx,ry,rz)*mix(.24,.58,rng()**1.4);
      const p=[x+Math.cos(phi)*rr*rx*.85,y+h*ry*.87,z+Math.sin(phi)*rr*rz*.85];
      if(inside(p,parent))continue;
      lobe(...p,r*mix(.85,1.2,rng()),r*mix(.9,1.2,rng()),r,'dome',parent);
    }
  }
  const secondary=lobes.slice(parents.length);
  for(const parent of secondary) {
    const [x,y,z,rx,ry,rz]=parent;
    const count=3+Math.floor(rng()*6);
    for(let n=0;n<count;n++) {
      const phi=rng()*Math.PI*2,h=mix(-.2,.95,rng()),rr=Math.sqrt(1-h*h);
      const r=Math.min(rx,ry,rz)*mix(.17,.37,rng());
      if(r<.12)continue;
      const p=[x+Math.cos(phi)*rr*rx*.93,y+h*ry*.93,z+Math.sin(phi)*rr*rz*.93];
      if(inside(p,null,.96))continue;
      lobe(...p,r,r*mix(.9,1.15,rng()),r,'dome',parent);
    }
  }
  // Localized, low-density tongues peeling off exposed sides. Each is sampled
  // as a torn volume later, not rendered as a line or a screen-space fringe.
  for(const parent of parents) {
    const anvil=parent.kind==='anvil',count=anvil?7:3;
    for(let n=0;n<count;n++) {
      const phi=mix(-1.65,1.65,(n+.15+.7*rng())/count),h=anvil?mix(-.2,.2,rng()):mix(-.5,.25,rng());
      const rr=Math.sqrt(1-h*h);
      const outward=[Math.cos(phi)*rr,h,Math.sin(phi)*rr];
      const p=[parent[0]+outward[0]*parent[3]*1.02,
        parent[1]+h*parent[4],parent[2]+outward[2]*parent[5]*1.02];
      if(p[1]<-.1||inside(p,parent,.98))continue;
      const r=Math.min(parent[3],parent[4],parent[5]);
      plumes.push({origin:p,outward,length:anvil?mix(1.8,3.6,rng()):mix(1.0,2.8,rng()),
        width:anvil?mix(.32,.65,rng()):Math.min(.65,mix(.28,.5,rng())*Math.sqrt(r)),
        thickness:anvil?mix(.10,.20,rng()):mix(.20,.42,rng()),
        rise:anvil?mix(-.1,.18,rng()):mix(-.12,.65,rng()),
        phase:rng()*Math.PI*2,strength:anvil?.65:mix(.85,1.35,rng()),anvil,parentId:parent.id});
    }
  }
  return {lobes,plumes};
}
