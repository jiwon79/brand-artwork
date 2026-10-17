import {CLOUD_LOD} from './spatial-lod.js';

const colors=['#2d7dff','#00d7f3','#00bfa5','#73d83e','#f3e34d','#ffac33','#f1663d','#f14387','#a671f1','#eceff4'];
export const LOD_PALETTE=Object.freeze(CLOUD_LOD.levels.map(({span},level)=>Object.freeze({
  span,color:colors[level],label:span===1?'Original':`1/${span}`,
})));
// CSS swatches are sRGB; the renderer composites linear-light radiance.
const linear=value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4;
export const LOD_COLOR_GLSL=`
const vec3 LOD_COLORS[${LOD_PALETTE.length}]=vec3[${LOD_PALETTE.length}](
  ${LOD_PALETTE.map(({color})=>`vec3(${[1,3,5].map(i=>linear(parseInt(color.slice(i,i+2),16)/255).toFixed(8)).join(',')})`).join(',\n  ')}
);
`;

// LOD banks are contiguous, while instances share the same source index space.
// Missing banks start past the final record, keeping source-only scenes blue.
export function lodColorStarts(scene){
  return Int32Array.from(CLOUD_LOD.levels.slice(1),(_,i)=>scene.lod?.offsets[i+1]?.[0]??(scene.lod?.count||scene.count));
}
