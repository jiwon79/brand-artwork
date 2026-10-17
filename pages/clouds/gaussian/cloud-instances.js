const choices=Object.freeze([1,8,64,512]);
export const CLOUD_INSTANCES=Object.freeze({choices,min:choices[0],max:choices.at(-1)});
export const SINGLE_CLOUD=Object.freeze([Object.freeze([0,0,0])]);
export function validateCloudCount(count){
  if(!Number.isInteger(count)||count<CLOUD_INSTANCES.min||count>CLOUD_INSTANCES.max)throw new Error(`Choose between ${CLOUD_INSTANCES.min} and ${CLOUD_INSTANCES.max} clouds.`);
}

// Keep the original cloud fixed. Add stable rows across the horizontal XZ
// plane, extending away from the default view instead of filling the foreground.
// Existing offsets form a prefix, so changing count never rearranges them.
export function cloudInstanceLayout(scene,count){
  validateCloudCount(count);
  if(count===1)return {offsets:SINGLE_CLOUD};
  const pitchX=Math.max(.01,scene.max[0]-scene.min[0])*1.08;
  const pitchZ=Math.max(.01,scene.max[2]-scene.min[2])*1.08;
  const offsets=[[0,0,0]];
  for(let radius=1;offsets.length<count;radius++){
    for(let depth=0;depth<=radius&&offsets.length<count;depth++){
      for(let x=-radius;x<=radius&&offsets.length<count;x++){
        if(Math.max(Math.abs(x),depth)===radius)offsets.push([x*pitchX,0,depth?-depth*pitchZ:0]);
      }
    }
  }
  return {offsets};
}
