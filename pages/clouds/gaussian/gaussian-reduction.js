import {reductionModule} from './gaussian-reduction-wasm.js';
import {FINE_LOD_LEVEL,FINE_LOD_SPAN} from './lod-partition.js';

// Error-driven coarse merges retain a tree over the exact existing fine
// groups. Every local LOD cut remains a disjoint partition of the sources.
export function buildReductionTree(data,targets,partition) {
  const sourceCount=data.length/8,started=performance.now();
  if(!Number.isInteger(sourceCount)||sourceCount<1||targets[0]!==sourceCount||targets.some((n,i)=>!Number.isInteger(n)||n<1||n>(targets[i-1]??sourceCount)))throw new Error('Invalid cloud reduction budgets.');
  for(let i=0;i<sourceCount;i++){const at=i*8;if(!data.subarray(at,at+8).every(Number.isFinite)||data[at+3]<0||data[at+4]<=0||data[at+5]<=0||data[at+6]<=0)throw new Error('Cloud reduction requires finite nonnegative density and positive widths.');}
  const left=new Uint32Array(Math.max(0,sourceCount-1)),right=new Uint32Array(left.length),cuts=[Uint32Array.from({length:sourceCount},(_,i)=>i)];let fineNodes=sourceCount,initialCount=sourceCount,coarseTargets=targets,initialRoots=cuts[0],initialOrder=cuts[0],ranges;
  if(partition) {
    const {order,offsets}=partition;initialOrder=order;
    let previous=order.slice(),previousOffsets=offsets;
    for(let level=1;level<=FINE_LOD_LEVEL;level++) {
      const nextOffsets=new Uint32Array(offsets.length);for(let c=0;c<offsets.length-1;c++)nextOffsets[c+1]=nextOffsets[c]+Math.ceil((previousOffsets[c+1]-previousOffsets[c])/2);
      const next=new Uint32Array(nextOffsets.at(-1));let output=0;
      for(let c=0;c<offsets.length-1;c++)for(let i=previousOffsets[c];i<previousOffsets[c+1];i+=2){
        if(i+1===previousOffsets[c+1])next[output++]=previous[i];
        else {left[fineNodes-sourceCount]=previous[i];right[fineNodes-sourceCount]=previous[i+1];next[output++]=fineNodes++;}
      }
      if(next.length!==targets[level])throw new Error('Fine LOD partition does not match the retained budget.');cuts.push(next);previous=next;previousOffsets=nextOffsets;
    }
    initialRoots=cuts[FINE_LOD_LEVEL];initialCount=initialRoots.length;coarseTargets=targets.slice(FINE_LOD_LEVEL);ranges=new Uint32Array(initialCount+1);let output=0;
    for(let c=0;c<offsets.length-1;c++)for(let first=offsets[c];first<offsets[c+1];first+=FINE_LOD_SPAN)ranges[++output]=Math.min(first+FINE_LOD_SPAN,offsets[c+1]);
  }
  const initial=new Float64Array(initialCount*10);
  for(let group=0;group<initialCount;group++) {
    const first=ranges?ranges[group]:group,last=ranges?ranges[group+1]:group+1,out=group*10;let mass=0;
    for(let j=first;j<last;j++){const at=initialOrder[j]*8,m=data[at+3]*data[at+4]*data[at+5]*data[at+6];mass+=m;for(let a=0;a<3;a++)initial[out+1+a]+=m*data[at+a];}
    initial[out]=mass;
    if(mass===0){const at=initialOrder[first]*8;for(let a=0;a<3;a++){initial[out+1+a]=data[at+a];initial[out+4+a]=data[at+4+a]**2;}continue;}
    for(let a=0;a<3;a++)initial[out+1+a]/=mass;
    for(let j=first;j<last;j++){
      const at=initialOrder[j]*8,m=data[at+3]*data[at+4]*data[at+5]*data[at+6],dx=data[at]-initial[out+1],dy=data[at+1]-initial[out+2],dz=data[at+2]-initial[out+3];
      initial[out+4]+=m*(data[at+4]**2+dx*dx);initial[out+5]+=m*(data[at+5]**2+dy*dy);initial[out+6]+=m*(data[at+6]**2+dz*dz);initial[out+7]+=m*dx*dy;initial[out+8]+=m*dx*dz;initial[out+9]+=m*dy*dz;
    }
    for(let a=4;a<10;a++)initial[out+a]/=mass;
  }
  const engine=new WebAssembly.Instance(reductionModule).exports;engine._initialize();
  const initialPointer=engine.malloc(initial.byteLength),targetPointer=engine.malloc(coarseTargets.length*4);
  if(!initialPointer||!targetPointer)throw new Error('There is not enough memory to prepare this cloud. Choose standard source splats.');
  new Float64Array(engine.memory.buffer,initialPointer,initial.length).set(initial);new Uint32Array(engine.memory.buffer,targetPointer,coarseTargets.length).set(coarseTargets);
  const resultPointer=engine.reduce_tree(initialPointer,initialCount,targetPointer,coarseTargets.length);
  if(!resultPointer)throw new Error('There is not enough memory to reduce this cloud. Choose standard source splats.');
  const result=new Uint32Array(engine.memory.buffer,resultPointer,6);
  if(result[0])throw new Error(result[0]===1?'Cloud reduction requires finite nonnegative density and positive widths.':result[0]===2?'There is not enough memory to prepare this cloud. Choose standard source splats.':'Cloud reduction could not form the next detail level.');
  const coarseNodes=result[1],nodeCount=fineNodes+coarseNodes-initialCount,coarseLeft=new Uint32Array(engine.memory.buffer,result[3],coarseNodes-initialCount),coarseRight=new Uint32Array(engine.memory.buffer,result[4],coarseNodes-initialCount);
  const remap=id=>id<initialCount?initialRoots[id]:fineNodes+id-initialCount;
  for(let i=0;i<coarseLeft.length;i++){left[fineNodes-sourceCount+i]=remap(coarseLeft[i]);right[fineNodes-sourceCount+i]=remap(coarseRight[i]);}
  let cutPointer=result[5]+initialCount*4;
  for(const target of coarseTargets.slice(1)){cuts.push(Uint32Array.from(new Uint32Array(engine.memory.buffer,cutPointer,target),remap));cutPointer+=target*4;}
  const workerHeapBytes=engine.memory.buffer.byteLength;
  // DFS makes every tree node a contiguous original-source range. Output
  // moments and attributes are recomputed from those immutable sources.
  const roots=cuts.at(-1),sourceOrder=new Uint32Array(sourceCount),begin=new Uint32Array(nodeCount),end=new Uint32Array(nodeCount),owner=new Uint32Array(nodeCount);let cursor=0;
  for(let chunk=0;chunk<roots.length;chunk++){
    const stack=[roots[chunk]];
    while(stack.length){const entry=stack.pop();if(entry<0){end[-entry-1]=cursor;continue;}owner[entry]=chunk;begin[entry]=cursor;if(entry<sourceCount){sourceOrder[cursor++]=entry;end[entry]=cursor;}else stack.push(-entry-1,right[entry-sourceCount],left[entry-sourceCount]);}
  }
  return {cuts,roots,sourceOrder,begin,end,owner,left,right,
    aggregateSeeds:{moments:initial,roots:initialRoots,firstParent:fineNodes},
    stats:{mergeMs:performance.now()-started,nodeCount,workerHeapBytes,exactFineSpan:partition?FINE_LOD_SPAN:1}};
}
