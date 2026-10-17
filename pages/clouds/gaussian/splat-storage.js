// Immutable attributes stay in source order. Only a uint32 index stream is
// sorted and uploaded for a new camera, preserving every float32 input bit.
export function packSplatTextures(scene,maxTextureSize){
  const count=scene.count;
  if(!Number.isInteger(count)||count<0||scene.data.length!==count*8)throw new Error('Invalid Gaussian attribute count.');
  if(scene.detail && (!(scene.detail instanceof Uint8Array)||scene.detail.length!==count*12))throw new Error('Cloud detail attributes must contain twelve bytes per Gaussian.');
  if(scene.lightning && (!(scene.lightning instanceof Uint8Array)||scene.lightning.length!==count*4))throw new Error('Lightning attributes must contain four bytes per Gaussian.');
  const texels=scene.detail?3:2;
  const minimumColumns=Math.max(1,Math.min(count,1024,Math.floor(maxTextureSize/texels)),Math.ceil(count/maxTextureSize));
  const columns=2**Math.ceil(Math.log2(minimumColumns)),rows=Math.max(1,Math.ceil(count/columns));
  if(columns*texels>maxTextureSize||rows>maxTextureSize)throw new Error('This cloud exceeds the GPU texture capacity. Reload to restore the default cloud.');
  const attributes=new Float32Array(columns*rows*8);attributes.set(scene.data);
  const appearance=new Uint8Array(columns*rows*4);
  if(scene.lighting){
    if(scene.lighting.length!==count*4)throw new Error('Invalid Gaussian appearance count.');
    appearance.set(scene.lighting);
  }else{
    appearance.fill(128);for(let i=3;i<appearance.length;i+=4)appearance[i]=255;
  }
  const detail=scene.detail?new Uint8Array(columns*rows*12):new Uint8Array(4);
  if(scene.detail)detail.set(scene.detail);
  const lightning=scene.lightning?new Uint8Array(columns*rows*4):null;
  if(lightning)lightning.set(scene.lightning);
  const covarianceStart=scene.covarianceStart??count,rootCount=count-covarianceStart,roots=scene.covarianceRoots;
  if(!Number.isInteger(covarianceStart)||covarianceStart<0||rootCount<0||
    ((rootCount>0||roots!==undefined)&&(!(roots instanceof Float32Array)||roots.length!==rootCount*6)))throw new Error('Invalid cloud covariance attributes.');
  const covarianceRows=Math.max(1,Math.ceil(rootCount/columns)),covariance=new Float32Array(columns*covarianceRows*8);
  for(let i=0;i<rootCount;i++) {
    const at=i*6;
    if(!roots.subarray(at,at+6).every(Number.isFinite)||roots[at]<=0||roots[at+2]<=0||roots[at+5]<=0)throw new Error('Cloud covariance widths must be finite and positive.');
    covariance.set(roots.subarray(at,at+6),i*8);
  }
  return {columns,rows,columnBits:Math.log2(columns),attributes,appearance,detail,lightning,covarianceStart,covarianceRows,covariance};
}
