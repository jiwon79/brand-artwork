// Preserve the established 2/4/8-source groups exactly. Cube ownership ends
// here: coarser error-driven merges can join any nearby groups.
import {reductionModule} from './gaussian-reduction-wasm.js';
export const FINE_LOD_LEVEL=3;
export const FINE_LOD_SPAN=2**FINE_LOD_LEVEL;
export function buildFinePartition(data,cellSize) {
  const count=data.length/8,h=cellSize,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<count;i++)for(let a=0;a<3;a++){const cell=Math.floor(data[i*8+a]/h);lo[a]=Math.min(lo[a],cell);hi[a]=Math.max(hi[a],cell);}
  const dims=hi.map((v,a)=>v-lo[a]+1),key=i=>((Math.floor(data[i*8+2]/h)-lo[2])*dims[1]+Math.floor(data[i*8+1]/h)-lo[1])*dims[0]+Math.floor(data[i*8]/h)-lo[0];
  if(!Number.isSafeInteger(dims.reduce((a,b)=>a*b,1)))throw new Error('Cloud extent exceeds spatial LOD indexing');
  const occupied=new Map();
  for(let i=0;i<count;i++){const k=key(i);occupied.set(k,(occupied.get(k)||0)+1);}
  const cells=[...occupied.keys()].sort((a,b)=>a-b),offsets=new Uint32Array(cells.length+1),centers=new Float32Array(cells.length*3);
  cells.forEach((k,c)=>{offsets[c+1]=offsets[c]+occupied.get(k);occupied.set(k,c);const x=k%dims[0],yz=Math.floor(k/dims[0]),y=yz%dims[1],z=Math.floor(yz/dims[1]);centers.set([(x+lo[0]+.5)*h,(y+lo[1]+.5)*h,(z+lo[2]+.5)*h],c*3);});
  const cursor=offsets.slice(),order=new Uint32Array(count);
  for(let i=0;i<count;i++)order[cursor[occupied.get(key(i))]++]=i;
  // Partial selection finds the same nested partitions without fully
  // sorting every recursive range. Include both transfers in build time.
  const engine=new WebAssembly.Instance(reductionModule).exports;engine._initialize();
  const dataPointer=engine.malloc(data.byteLength),orderPointer=engine.malloc(order.byteLength),offsetPointer=engine.malloc(offsets.byteLength);
  if(!dataPointer||!orderPointer||!offsetPointer)throw new Error('There is not enough memory to prepare this cloud. Choose standard source splats.');
  new Float32Array(engine.memory.buffer,dataPointer,data.length).set(data);
  new Uint32Array(engine.memory.buffer,orderPointer,order.length).set(order);
  new Uint32Array(engine.memory.buffer,offsetPointer,offsets.length).set(offsets);
  engine.fine_order(dataPointer,orderPointer,offsetPointer,cells.length,FINE_LOD_SPAN);
  order.set(new Uint32Array(engine.memory.buffer,orderPointer,order.length));
  return {order,offsets,centers};
}
