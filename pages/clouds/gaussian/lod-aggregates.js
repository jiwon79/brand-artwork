// Unrounded moments and appearance sums are sufficient to combine groups.
// Cache only the coarse tree: keeping these records for every original
// Gaussian would cost much more memory than the hierarchy itself.
export function buildCoarseAggregates(scene,tree,fields) {
  const {aggregateSeeds:{moments,roots,firstParent},left,right,begin,end,sourceOrder}=tree;
  const seedCount=roots.length,stride=10+fields.reduce((n,field)=>n+field.stride,0);
  const table=new Float64Array((seedCount+tree.stats.nodeCount-firstParent)*stride);
  const seedIndices=new Uint32Array(firstParent);
  const index=node=>node>=firstParent?seedCount+node-firstParent:seedIndices[node];
  for(let i=0;i<seedCount;i++) {
    const node=roots[i],out=i*stride;seedIndices[node]=i;
    table.set(moments.subarray(i*10,i*10+10),out);
    for(let j=begin[node];j<end[node];j++) {
      const id=sourceOrder[j],at=id*8,m=scene.data[at+3]*scene.data[at+4]*scene.data[at+5]*scene.data[at+6];let column=out+10;
      for(const {name,input,stride:width}of fields)for(let a=0;a<width;a++){
        const value=input[id*width+a];table[column++]+=m*(name==='lightning'&&a<3?value*value:value);
      }
    }
  }
  for(let node=firstParent;node<tree.stats.nodeCount;node++) {
    const a=index(left[node-scene.count])*stride,b=index(right[node-scene.count])*stride,out=index(node)*stride;
    const mass=table[a]+table[b],w=mass>0?table[a]/mass:.5,v=1-w;
    const dx=table[a+1]-table[b+1],dy=table[a+2]-table[b+2],dz=table[a+3]-table[b+3];
    table[out]=mass;
    for(let axis=1;axis<=3;axis++)table[out+axis]=w*table[a+axis]+v*table[b+axis];
    table[out+4]=w*table[a+4]+v*table[b+4]+w*v*dx*dx;
    table[out+5]=w*table[a+5]+v*table[b+5]+w*v*dy*dy;
    table[out+6]=w*table[a+6]+v*table[b+6]+w*v*dz*dz;
    table[out+7]=w*table[a+7]+v*table[b+7]+w*v*dx*dy;
    table[out+8]=w*table[a+8]+v*table[b+8]+w*v*dx*dz;
    table[out+9]=w*table[a+9]+v*table[b+9]+w*v*dy*dz;
    for(let column=10;column<stride;column++)table[out+column]=table[a+column]+table[b+column];
  }
  return {table,stride,index,bytes:table.byteLength+seedIndices.byteLength};
}
