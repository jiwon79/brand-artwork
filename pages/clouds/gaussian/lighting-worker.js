import { binShadowGaussians } from './lighting.js';
let data, sceneId;
self.onmessage = ({data: message}) => {
  if(message.type==='scene') { data=message.data; sceneId=message.sceneId; return; }
  if(message.sceneId!==sceneId)return;
  try {
    const start=performance.now(), result=binShadowGaussians(data,message.light);
    self.postMessage({id:message.id,sceneId,result,cpuMs:performance.now()-start},[result.data.buffer]);
  } catch(error) { self.postMessage({id:message.id,sceneId,error:error.message}); }
};
