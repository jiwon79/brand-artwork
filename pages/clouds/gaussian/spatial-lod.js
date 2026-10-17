import {GAUSSIAN_SUPPORT} from './config.js';
import {buildReductionTree} from './gaussian-reduction.js';
import {buildCoarseAggregates} from './lod-aggregates.js';
import {buildFinePartition,FINE_LOD_LEVEL,FINE_LOD_SPAN} from './lod-partition.js';
export {FINE_LOD_LEVEL} from './lod-partition.js';

// Local ownership follows the density-driven reduction tree. The former
// cubes remain only for exact fine groups and the budget/distance reference.
// Peak extinction is a volume density: every replacement conserves mass.
export const CLOUD_LOD = Object.freeze({
  cellSize:.5,hysteresis:.10,minMultiplier:1,maxMultiplier:512,defaultMultiplier:4,
  fittedSpan:32,fittedWidth:.925,covarianceSpan:64,
  // Ten slider steps per doubling keeps the default 4x exactly representable.
  sliderMin:0,sliderMax:90,sliderStep:1,
  // Preserve the nearest transition; double merge span when projected
  // diameter halves, matching a linear falloff in detail with distance.
  levels:Object.freeze(Array.from({length:10},(_,level)=>Object.freeze({
    span:2**level,maxPixels:level===0?Infinity:128/2**(level-1),
  }))),
});
export function snapLODMultiplier(value){return value===0?0:Math.max(CLOUD_LOD.minMultiplier,Math.min(CLOUD_LOD.maxMultiplier,Math.round(value)));}
export function lodMultiplier(value) {
  if(!Number.isFinite(value))throw new Error('Invalid LOD control value');
  const t=(Math.max(CLOUD_LOD.sliderMin,Math.min(CLOUD_LOD.sliderMax,value))-CLOUD_LOD.sliderMin)/(CLOUD_LOD.sliderMax-CLOUD_LOD.sliderMin);
  return CLOUD_LOD.minMultiplier*2**(t*Math.log2(CLOUD_LOD.maxMultiplier/CLOUD_LOD.minMultiplier));
}
export function lodSliderValue(multiplier=CLOUD_LOD.defaultMultiplier) {
  return CLOUD_LOD.sliderMin+(CLOUD_LOD.sliderMax-CLOUD_LOD.sliderMin)*Math.log2(multiplier/CLOUD_LOD.minMultiplier)/Math.log2(CLOUD_LOD.maxMultiplier/CLOUD_LOD.minMultiplier);
}

// A sphere's perspective diameter, including off-axis magnification. A cube
// containing/crossing the camera's near plane always keeps original detail.
export function projectedCubePixels(x,y,z,focal,r=CLOUD_LOD.cellSize*Math.sqrt(3)/2) {
  const reference=CLOUD_LOD.cellSize*Math.sqrt(3)/2;
  if(z-r<=.01)return Infinity;
  const den=z*z-r*r;
  return 2*focal*reference*Math.sqrt(x*x+y*y+den)/den;
}
export function chooseLodLevel(pixels,multiplier,previous=-1,counts) {
  if(multiplier===0)return 0;
  for(let level=CLOUD_LOD.levels.length-1;level>0;level--) {
    const limit=CLOUD_LOD.levels[level].maxPixels*multiplier*(1+(previous>=level?CLOUD_LOD.hysteresis:-CLOUD_LOD.hysteresis));
    if(pixels<=limit&&(!counts||(counts[level]>0&&counts[level]<counts[0])))return level;
  }
  return 0;
}

export function lodWidthScale(span) {
  return span<=FINE_LOD_SPAN||span>=CLOUD_LOD.covarianceSpan?1:1-(1-CLOUD_LOD.fittedWidth)*Math.log2(span/FINE_LOD_SPAN)/Math.log2(CLOUD_LOD.fittedSpan/FINE_LOD_SPAN);
}

export function lodRecordId(lod,level,index) {
  if(level===0)return lod.sourceOrder[index];
  const order=lod.fine?.rootOrders?.[level-1];
  return order?order[index-lod.offsets[level][0]]:index;
}

export function buildSpatialLOD(scene) {
  const started=performance.now(),{data,count}=scene,h=CLOUD_LOD.cellSize;
  if(data.length!==count*8||!count)throw new Error('LOD requires a nonempty Gaussian volume');
  const partition=buildFinePartition(data,h);
  const targets=CLOUD_LOD.levels.map(({span})=>{let n=0;for(let c=0;c<partition.offsets.length-1;c++)n+=Math.ceil((partition.offsets[c+1]-partition.offsets[c])/span);return n;});
  const tree=buildReductionTree(data,targets,partition),{roots,sourceOrder,begin,end,owner}=tree,chunks=roots.length;
  const offsets=[new Uint32Array(chunks+1)],centers=new Float32Array(chunks*3),radii=new Float32Array(chunks),bounds=new Float32Array(chunks*6);
  for(let c=0;c<chunks;c++)offsets[0][c+1]=end[roots[c]];
  const ordered=[null];let total=count;
  for(let level=1;level<tree.cuts.length;level++) {
    const cut=tree.cuts[level],table=new Uint32Array(chunks+1);table[0]=total;
    for(const id of cut){const c=owner[id];if(level<=FINE_LOD_LEVEL||end[roots[c]]-begin[roots[c]]>1)table[c+1]++;}
    for(let c=0;c<chunks;c++)table[c+1]+=table[c];
    const cursor=table.slice(),nodes=new Uint32Array(table[chunks]-total);
    for(const id of cut){const c=owner[id];if(level<=FINE_LOD_LEVEL||end[roots[c]]-begin[roots[c]]>1)nodes[cursor[c]++-total]=id;}
    ordered.push(nodes);offsets.push(table);total=table[chunks];
  }
  const covarianceLevel=CLOUD_LOD.levels.findIndex(({span})=>span>=CLOUD_LOD.covarianceSpan),covarianceStart=offsets[covarianceLevel][0];
  const covarianceRoots=new Float32Array((total-covarianceStart)*6),allData=new Float32Array(total*8);allData.set(data);
  const attributes={};
  for(const [name,stride]of [['lighting',4],['detail',12],['lightning',4]])if(scene[name]){attributes[name]=new Uint8Array(total*stride);attributes[name].set(scene[name]);}
  const fields=Object.entries(attributes).map(([name,output])=>({name,stride:name==='detail'?12:4,input:scene[name],output}));
  const aggregateStart=performance.now(),aggregates=buildCoarseAggregates(scene,tree,fields),aggregateMs=performance.now()-aggregateStart;
  const attributeSums=new Float64Array(fields.reduce((n,field)=>n+field.stride,0));
  const copy=(id,output)=>{allData.set(data.subarray(id*8,id*8+8),output*8);for(const {stride,input,output:packed}of fields)packed.set(input.subarray(id*stride,(id+1)*stride),output*stride);};
  function merge(node,output,span) {
    const first=begin[node],last=end[node],seedId=sourceOrder[first],full=span>=CLOUD_LOD.covarianceSpan;
    if(last-first===1){copy(seedId,output);if(full)covarianceRoots.set([data[seedId*8+4],0,data[seedId*8+5],0,0,data[seedId*8+6]],(output-covarianceStart)*6);return;}
    let mass=0;const mean=[0,0,0],covariance=[0,0,0,0,0,0];attributeSums.fill(0);
    if(span>FINE_LOD_SPAN) {
      const {table,stride,index}=aggregates,at=index(node)*stride;mass=table[at];
      for(let a=0;a<3;a++)mean[a]=table[at+1+a];
      for(let a=0;a<6;a++)covariance[a]=table[at+4+a];
      for(let a=0;a<attributeSums.length;a++)attributeSums[a]=table[at+10+a];
    }else {
    for(let j=first;j<last;j++){
      const id=sourceOrder[j],i=id*8,m=data[i+3]*data[i+4]*data[i+5]*data[i+6];mass+=m;for(let a=0;a<3;a++)mean[a]+=m*data[i+a];
      let column=0;for(const {name,stride,input}of fields)for(let a=0;a<stride;a++){const value=input[id*stride+a];attributeSums[column++]+=m*(name==='lightning'&&a<3?value*value:value);}
    }
    if(mass===0){copy(seedId,output);if(full)covarianceRoots.set([data[seedId*8+4],0,data[seedId*8+5],0,0,data[seedId*8+6]],(output-covarianceStart)*6);return;}
    for(let a=0;a<3;a++)mean[a]/=mass;
    for(let j=first;j<last;j++){
      const i=sourceOrder[j]*8,m=data[i+3]*data[i+4]*data[i+5]*data[i+6],dx=data[i]-mean[0],dy=data[i+1]-mean[1],dz=data[i+2]-mean[2];
      covariance[0]+=m*(data[i+4]**2+dx*dx);covariance[1]+=m*(data[i+5]**2+dy*dy);covariance[2]+=m*(data[i+6]**2+dz*dz);
      covariance[3]+=m*dx*dy;covariance[4]+=m*dx*dz;covariance[5]+=m*dy*dz;
    }
    for(let a=0;a<6;a++)covariance[a]/=mass;
    }
    if(mass===0){copy(seedId,output);if(full)covarianceRoots.set([data[seedId*8+4],0,data[seedId*8+5],0,0,data[seedId*8+6]],(output-covarianceStart)*6);return;}
    const sigma=covariance.slice(0,3).map(v=>Math.sqrt(v)*lodWidthScale(span));let determinantRoot=sigma[0]*sigma[1]*sigma[2];
    if(full) {
      const [xx,yy,zz,xy,xz,yz]=covariance,a=Math.sqrt(xx),b=xy/a,d=xz/a,c=Math.sqrt(yy-b*b),e=(yz-d*b)/c,f=Math.sqrt(zz-d*d-e*e);
      if(![a,b,c,d,e,f].every(Number.isFinite)||a*c*f<=0)throw new Error('Cloud reduction produced an invalid covariance.');
      covarianceRoots.set([a,b,c,d,e,f],(output-covarianceStart)*6);determinantRoot=a*c*f;
    }
    allData.set([...mean,mass/determinantRoot,...sigma,data[seedId*8+7]],output*8);
    let column=0;for(const {name,stride,output:packed}of fields)for(let a=0;a<stride;a++){
      const sum=attributeSums[column++];
      packed[output*stride+a]=Math.round(name==='lightning'&&a<3?Math.sqrt(sum/mass):sum/mass);
    }
  }
  const fine={centers:partition.centers,offsets:[partition.offsets],orders:[partition.order],rootOrders:[],owners:new Uint32Array(offsets[FINE_LOD_LEVEL].at(-1)),bounds:new Float32Array(partition.centers.length*2)};
  fine.owners.set(owner.subarray(0,count));
  const recordByNode=new Uint32Array(owner.length);
  for(let level=1;level<offsets.length;level++) {
    // Keep fine attributes in the old sequential cell order. Coarse regions
    // use an index map to refer back to these immutable fine records.
    const nodes=level<=FINE_LOD_LEVEL?tree.cuts[level]:ordered[level];
    for(let j=0;j<nodes.length;j++){
      const id=offsets[level][0]+j,node=nodes[j];merge(node,id,CLOUD_LOD.levels[level].span);
      if(level<=FINE_LOD_LEVEL){recordByNode[node]=id;fine.owners[id]=owner[node];}
    }
    if(level<=FINE_LOD_LEVEL){fine.rootOrders.push(Uint32Array.from(ordered[level],node=>recordByNode[node]));fine.orders.push(Uint32Array.from(nodes,(_,i)=>offsets[level][0]+i));}
  }
  const ranges={sourceOrder,offsets,fine};
  for(let c=0;c<chunks;c++) {
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],positionMin=[Infinity,Infinity,Infinity],positionMax=[-Infinity,-Infinity,-Infinity];
    for(let level=0;level<offsets.length;level++)for(let j=offsets[level][c];j<offsets[level][c+1];j++) {
      const id=lodRecordId(ranges,level,j),i=id*8,sx=allData[i+4],sy=allData[i+5],sz=allData[i+6],r=GAUSSIAN_SUPPORT*(id>=covarianceStart?Math.hypot(sx,sy,sz):Math.max(sx,sy,sz));
      for(let a=0;a<3;a++){min[a]=Math.min(min[a],allData[i+a]-r);max[a]=Math.max(max[a],allData[i+a]+r);if(level===0){positionMin[a]=Math.min(positionMin[a],allData[i+a]);positionMax[a]=Math.max(positionMax[a],allData[i+a]);}}
    }
    for(let a=0;a<3;a++){centers[c*3+a]=(positionMin[a]+positionMax[a])*.5;bounds[c*6+a]=(min[a]+max[a])*.5;bounds[c*6+3+a]=(max[a]-min[a])*.5+1e-5;}
    radii[c]=Math.max(h*Math.sqrt(3)/2,Math.hypot(...positionMax.map((v,a)=>(v-positionMin[a])*.5)));
  }
  const fineCells=partition.centers.length/3,rootCells=Array.from({length:chunks},()=>new Set());
  for(let level=1;level<=FINE_LOD_LEVEL;level++) {
    const table=new Uint32Array(fineCells+1),span=CLOUD_LOD.levels[level].span;
    for(let c=0;c<fineCells;c++)table[c+1]=table[c]+Math.ceil((partition.offsets[c+1]-partition.offsets[c])/span);
    fine.offsets.push(table);
  }
  for(let c=0;c<fineCells;c++) {
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let level=0;level<=FINE_LOD_LEVEL;level++)for(let j=fine.offsets[level][c];j<fine.offsets[level][c+1];j++) {
      const id=fine.orders[level][j],i=id*8,r=GAUSSIAN_SUPPORT*Math.max(allData[i+4],allData[i+5],allData[i+6]);
      for(let a=0;a<3;a++){min[a]=Math.min(min[a],allData[i+a]-r);max[a]=Math.max(max[a],allData[i+a]+r);}
      if(level===FINE_LOD_LEVEL)rootCells[fine.owners[id]].add(c);
    }
    for(let a=0;a<3;a++){fine.bounds[c*6+a]=(min[a]+max[a])*.5;fine.bounds[c*6+3+a]=(max[a]-min[a])*.5+1e-5;}
  }
  fine.rootCellOffsets=new Uint32Array(chunks+1);
  for(let c=0;c<chunks;c++)fine.rootCellOffsets[c+1]=fine.rootCellOffsets[c]+rootCells[c].size;
  fine.rootCells=new Uint32Array(fine.rootCellOffsets.at(-1));
  for(let c=0;c<chunks;c++)fine.rootCells.set([...rootCells[c]],fine.rootCellOffsets[c]);
  return {data:allData,...attributes,count:total,sourceCount:count,sourceOrder,offsets,centers,radii,bounds,covarianceStart,covarianceRoots,fine,
    stats:{chunks,sourceCount:count,residentCount:total,buildMs:performance.now()-started,cellSize:h,targets,method:'nested-error-fit-covariance',aggregateMs,aggregateBytes:aggregates.bytes,...tree.stats}};
}
