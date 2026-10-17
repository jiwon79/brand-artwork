import {CompletedFrameCache} from '../completed-frame-cache.ts';
import {completedViewKey,FRAME_MEMORY_LIMIT} from '../completed-frame.ts';
import {MotionRefinement} from '../refinement.ts';
import {ambientSky} from './atmosphere.js';
import { clamp, dot, cross, normalize, sunDirection, lightBasis } from './math.js';
import * as shaders from './shaders.js';
import { GAUSSIAN_SUPPORT, SHADOW_RESOLUTION, SAMPLING_DEFAULTS, APPEARANCE_DEFAULTS, OPACITY_BATCHES, CAMERA_DEFAULTS } from './config.js';
import { clusterLightBounds, lightBounds, shadowSegmentRanges, lightDirectionDelta } from './lighting.js';
import {sampleSequence,jitterLight,ShadowHistory} from './sampling.js';
import {TemporalAccumulator} from './accumulation.js';
import { CameraEffects } from './lens.js';
import { makeFrustum, sphereInFrustum, worldFrustumPlanes, classifyBox } from './visibility.js';

import {packSplatTextures} from './splat-storage.js';
import {STORM,lightningPreview} from './storm.js';
import {StormEffects} from './storm-effects.js';
import {RayTerms} from './ray-terms.js';
import {CLOUD_LOD,FINE_LOD_LEVEL,projectedCubePixels,chooseLodLevel,snapLODMultiplier} from './spatial-lod.js';
import {cloudResolution,CLOUD_SAMPLING} from './cloud-resolution.js';
import {AutoPerformance,automaticLODLimit} from './auto-performance.js';
import {CAMERA_VIEW,viewDistance,zoomCamera,installCameraControls} from './camera-controls.js';
import {SINGLE_CLOUD,validateCloudCount} from './cloud-instances.js';
import {FrameRate,RENDER_STATS,lodSummary} from './render-stats.js';
import {lodColorStarts} from './lod-colors.js';
import {renderCapabilities} from './render-capabilities.js';

export function program(gl, vertex, fragment) {
  function compile(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(error);
    }
    return s;
  }
  const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const locations = new Map();
  return { id: p, uniform(name, value) {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(p, name));
    const loc = locations.get(name);
    if (loc === null) return;
    if (typeof value === 'number') gl.uniform1f(loc, value);
    else if (value.length === 2) gl.uniform2fv(loc, value);
    else if (value.length === 3) gl.uniform3fv(loc, value);
  }, integer(name, value) {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(p, name));
    gl.uniform1i(locations.get(name), value);
  }, integers(name, values) {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(p, name));
    gl.uniform1iv(locations.get(name), values);
  } };
}

export class CloudRenderer {
  constructor(canvas, onStatus = () => {}, {completedCache=true} = {}) {
    this.canvas = canvas;
    this.onStatus = onStatus;
    this.completedFrames=new CompletedFrameCache(completedCache,(key,redraw)=>{
      if(this.disposed)return;
      if(redraw&&key===this.completedFrameKey())this.dirty=true;
      this.canvas.dispatchEvent(new CustomEvent('framecachechange',{detail:this.completedFrames.diagnostics()}));
    });
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('This renderer needs WebGL 2. Enable graphics acceleration in your browser, then reload.');
    this.capabilities=renderCapabilities(gl);
    this.pendingRenderMode=null;
    this.gl = gl;
    this.rasterSubpixel = 2 ** -gl.getParameter(gl.SUBPIXEL_BITS);
    this.programs = {
      splat: program(gl, shaders.indexedSplatVertex, shaders.splatFragment),
      splatMixed: program(gl, shaders.mixedSplatVertex, shaders.mixedSplatFragment),
      splatCovariance: program(gl, shaders.covarianceSplatVertex, shaders.covarianceSplatFragment),
      shadowSlab: program(gl, shaders.shadowSlabVertex, shaders.shadowSlabFragment),
      radiance: program(gl,shaders.fullscreenVertex,shaders.radianceFragment),
      opacityMask: program(gl,shaders.fullscreenVertex,shaders.opacityMaskFragment),
      shadowResolve: program(gl,shaders.fullscreenVertex,shaders.shadowResolveFragment),
    };
    this.effects=new CameraEffects(gl,program);
    this.accumulation=new TemporalAccumulator(gl,program,this.capabilities);
    this.shadowHistory=new ShadowHistory();
    this.rayTerms=new RayTerms(gl,program,this.capabilities);
    this.fullscreenVAO = gl.createVertexArray();
    this.splatVAO = gl.createVertexArray();
    this.shadowVAO = gl.createVertexArray();
    this.splatBuffer = gl.createBuffer();
    this.splatDataTexture=gl.createTexture();
    this.splatAppearanceTexture=gl.createTexture();
    this.splatDetailTexture=gl.createTexture();
    this.splatCovarianceTexture=gl.createTexture();
    this.cloudOffsetsTexture=gl.createTexture();this.instances=SINGLE_CLOUD;this.instanceVersion=0;
    this.uploadCloudOffsets();
    this.shadowBuffer = gl.createBuffer();
    gl.bindVertexArray(this.shadowVAO);gl.bindBuffer(gl.ARRAY_BUFFER,this.shadowBuffer);
    for(let i=0;i<2;i++){
      gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,4,gl.FLOAT,false,32,i*16);gl.vertexAttribDivisor(i,1);
    }
    gl.bindVertexArray(this.splatVAO);gl.bindBuffer(gl.ARRAY_BUFFER,this.splatBuffer);
    gl.enableVertexAttribArray(0);gl.vertexAttribIPointer(0,1,gl.UNSIGNED_INT,4,0);gl.vertexAttribDivisor(0,1);
    gl.bindVertexArray(null);
    this.shadowSize = [...SHADOW_RESOLUTION];
    this.shadowFBO = gl.createFramebuffer();
    this.shadowScratchFBO=gl.createFramebuffer();
    this.shadowScratch=this.createShadowScratch(this.capabilities);
    this.sceneFBO = gl.createFramebuffer();
    this.sceneTexture = gl.createTexture();
    this.opacityFBO = gl.createFramebuffer();
    this.opacityDepth = gl.createRenderbuffer();
    this.shadowTextures = [this.createShadowTexture()];
    this.shadowKnown=new Uint8Array(this.shadowSize[2]);
    this.shadowSamples=0;
    this.shadowIndex = 0;
    this.shadowReady = false;
    this.scene = null;
    this.pendingLight = null;
    this.activeLight = null;
    this.shadowLayer = 0;
    this.lightVersion = 0; this.sceneVersion = 0;
    this.lightingWorker = new Worker(new URL('./lighting-worker.js', import.meta.url),{type:'module'});
    this.lightingWorker.onmessage = ({data: message}) => {
      this.lightingWorkerBusy=false;
      if(this.disposed || message.sceneId!==this.sceneVersion)return;
      if(message.error){this.onStatus({error:message.error});return;}
      // The index is reusable under conservative directional bounds. Keep
      // useful work even if a newer input arrived while the worker was busy.
      this.nextShadowBins=message.result;
      this.lightMetrics.binCpuMs=message.cpuMs;
    };
    this.lightingWorker.onerror = event => this.onStatus({error:event.message || 'Sunlight could not finish. Reload the renderer.'});
    this.camera = { target: [0, 3.1, 0], distance: 29, yaw: 0.23, pitch: 0.075 };
    this.autoPerformance=new AutoPerformance();this.motionRefinement=new MotionRefinement();
    this.frameRate=new FrameRate();this.lastRenderStatsAt=-Infinity;this.pendingFrameForFPS=false;
    // The interactive viewer enables adaptation; scripted captures keep explicit settings.
    this.settings = { autoPerformance:false, colorByLOD:false, density: 1.55, exposure: 0.2, scattering: 0.85, elevation: 42, azimuth: -52, quality: 1, cloudScale:CLOUD_SAMPLING.defaultScale, view: 0, orbit: false, lightning: true, occlusion: true, shadowCubic: 1, lodMultiplier:CLOUD_LOD.defaultMultiplier, ...CAMERA_DEFAULTS, ...SAMPLING_DEFAULTS, ...APPEARANCE_DEFAULTS };
    this.dirty = true; this.sortDirty = true; this.frameCount = 0; this.sortMs = 0; this.submitMs = 0;this.animationPaused=false;
    this.counts = new Uint32Array(65536);
    this.lastTime = performance.now();
    this.abort = new AbortController();
    this.installControls();
    document.addEventListener('visibilitychange',()=>{this.autoPerformance.resetMeasurements();this.autoTiming=null;clearTimeout(this.autoTimer);this.frameRate.reset();this.pendingFrameForFPS=false;this.reportRenderStats(true);},{signal:this.abort.signal});
    this.resizeObserver = new ResizeObserver(() => { this.dirty = true; });
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.contextLost = true;
      this.onStatus({ error: 'The graphics context was interrupted. Reload to restore the cloud.' });
    }, { signal: this.abort.signal });
    this.tick = this.tick.bind(this);
    this.animation = requestAnimationFrame(this.tick);
  }

  createShadowScratch(capabilities) {
    const gl=this.gl,texture=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texStorage2D(gl.TEXTURE_2D,1,capabilities.shadowFormat,this.shadowSize[0],this.shadowSize[1]);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowScratchFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.deleteTexture(texture);throw new Error('The cloud’s lighting buffer could not be created. Try another browser or device.');}
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);return texture;
  }

  setRenderingMode(mode) {
    renderCapabilities(this.gl,mode,this.capabilities);
    this.pendingRenderMode=mode===this.capabilities.mode?null:mode;
    this.dirty=true;this.reportProgress();
    this.canvas.dispatchEvent(new CustomEvent('renderingchange'));
  }

  applyRenderingMode() {
    if(this.pendingRenderMode==null)return;
    const gl=this.gl,next=renderCapabilities(gl,this.pendingRenderMode,this.capabilities);
    const imageChanged=next.imagePrecision!==this.capabilities.imagePrecision;
    const shadowChanged=next.shadowPrecision!==this.capabilities.shadowPrecision;
    // The caller has consumed the last GPU fence. Release obsolete buffers
    // before replacement so switching does not double image memory on phones.
    if(imageChanged) {
      this.accumulation.dispose();this.rayTerms.dispose();
      this.accumulation=new TemporalAccumulator(gl,program,next);
      this.rayTerms=new RayTerms(gl,program,next);
      this.accumulation.resize(this.canvas.width,this.canvas.height);
      this.rayTerms.resize(this.sceneWidth||this.canvas.width,this.sceneHeight||this.canvas.height);
    }
    if(shadowChanged){gl.deleteTexture(this.shadowScratch);this.shadowScratch=this.createShadowScratch(next);}
    if(imageChanged||shadowChanged){
      this.accumulation.setKey(null);this.shadowHistory=new ShadowHistory();
      this.shadowSampleKey=null;this.shadowReady=false;
      this.autoPerformance.resetMeasurements();this.frameRate.reset();this.pendingFrameForFPS=false;
      this.idleRefinementKey=null;this.autoWorkKind=null;
    }
    this.accumulation.capabilities=next;this.rayTerms.capabilities=next;
    this.capabilities=next;this.pendingRenderMode=null;this.dirty=true;
    this.canvas.dispatchEvent(new CustomEvent('renderingchange'));this.reportProgress();
  }

  createShadowTexture() {
    const gl = this.gl, [w, h, d] = this.shadowSize;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RG16F, w, h, d);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axis, gl.CLAMP_TO_EDGE);
    return texture;
  }

  setCloud(scene,{reuse=false,keepLighting=false}={}) {
    if(scene.lighting && (!(scene.lighting instanceof Uint8Array)||scene.lighting.length!==scene.count*4))throw new Error('Cloud lighting attributes must contain four bytes per Gaussian.');
    if(scene.lod&&scene.lod.sourceCount!==scene.count)throw new Error('Cloud LOD source count does not match the volume.');
    const sameSource=this.scene&&scene.count===this.scene.count&&scene.seed===this.scene.seed&&(scene.preset==='storm')===(this.scene.preset==='storm')&&
      ['data','lighting','detail','lightning','lightningDensity','lightBounds'].every(key=>scene[key]===this.scene[key]);
    if(keepLighting&&!sameSource)throw new Error('Existing lighting requires the same cloud source.');
    if(reuse&&sameSource&&scene.lod===this.scene.lod) {
      this.scene=scene;this.sortDirty=true;if(!keepLighting)this.relight();this.resize();this.motionRefinement=new MotionRefinement();return;
    }
    const renderScene=scene.lod?{...scene,...scene.lod}:scene;
    const packed=packSplatTextures(renderScene,this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE));
    if(scene.preset==='storm'&&!packed.lightning)throw new Error('The storm is missing its lightning illumination. Regenerate the cloud.');
    if(!keepLighting&&scene.preset==='storm') {
      this.storm?.dispose();this.storm=new StormEffects(this.gl,program,scene.lightningDensity,scene.seed);this.sceneWidth=0;
    }else if(!keepLighting&&this.storm) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,this.sceneFBO);
      this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER,this.gl.COLOR_ATTACHMENT1,this.gl.TEXTURE_2D,null,0);
      this.gl.drawBuffers([this.gl.COLOR_ATTACHMENT0]);this.storm.dispose();this.storm=null;this.sceneWidth=0;
    }
    this.autoPerformance.resetMeasurements();this.autoTiming=null;clearTimeout(this.autoTimer);
    this.frameRate?.reset();this.pendingFrameForFPS=false;
    this.scene = scene;
    this.lodColorStarts=lodColorStarts(scene);
    this.renderData=renderScene.data;
    this.lodTags=scene.lod?new Int8Array(scene.lod.centers.length/3*this.instanceCount).fill(-1):null;
    this.fineLodTags=scene.lod?.fine?new Int8Array(scene.lod.fine.centers.length/3*this.instanceCount).fill(-1):null;
    this.activeFineCells=scene.lod?.fine?new Uint8Array(scene.lod.fine.centers.length/3):null;
    this.lodStats=null;
    this.sortedIndices=new Uint32Array(scene.count);
    this.keys = new Uint16Array(scene.count);
    this.visibleIndices = new Uint32Array(scene.count);
    this.supportRadii = new Float32Array(renderScene.count);
    for(let i=0;i<renderScene.count;i++) {
      const d=renderScene.data,at=i*8;
      this.supportRadii[i]=GAUSSIAN_SUPPORT*(i>=packed.covarianceStart?Math.hypot(d[at+4],d[at+5],d[at+6]):Math.max(d[at+4],d[at+5],d[at+6]));
    }
    this.cullBlockSize=256;
    this.cullBlocks=new Float32Array(Math.ceil(scene.count/this.cullBlockSize)*6);
    for(let start=0;start<scene.count;start+=this.cullBlockSize) {
      const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      for(let i=start;i<Math.min(scene.count,start+this.cullBlockSize);i++) for(let axis=0;axis<3;axis++) {
        lo[axis]=Math.min(lo[axis],scene.data[i*8+axis]-this.supportRadii[i]);
        hi[axis]=Math.max(hi[axis],scene.data[i*8+axis]+this.supportRadii[i]);
      }
      const at=start/this.cullBlockSize*6;
      for(let axis=0;axis<3;axis++){this.cullBlocks[at+axis]=(lo[axis]+hi[axis])/2;this.cullBlocks[at+axis+3]=(hi[axis]-lo[axis])/2+1e-5;}
    }
    this.visibleCount = scene.count;
    const gl = this.gl;
    this.splatColumnBits=packed.columnBits;
    this.covarianceStart=packed.covarianceStart;
    gl.bindTexture(gl.TEXTURE_2D,this.splatCovarianceTexture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,packed.columns*2,packed.covarianceRows,0,gl.RGBA,gl.FLOAT,packed.covariance);
    for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.NEAREST);
    for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);
    for(const [texture,width,format,type,pixels] of [
      [this.splatDataTexture,packed.columns*2,gl.RGBA32F,gl.FLOAT,packed.attributes],
      [this.splatAppearanceTexture,packed.columns,gl.RGBA8,gl.UNSIGNED_BYTE,packed.appearance],
    ]){
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,format,width,packed.rows,0,gl.RGBA,type,pixels);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D,this.splatDetailTexture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,scene.detail?packed.columns*3:1,scene.detail?packed.rows:1,0,gl.RGBA,gl.UNSIGNED_BYTE,packed.detail);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    if(packed.lightning) {
      this.splatLightningTexture||=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.splatLightningTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,packed.columns,packed.rows,0,gl.RGBA,gl.UNSIGNED_BYTE,packed.lightning);
      for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.NEAREST);
      for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);
    }else if(this.splatLightningTexture){gl.deleteTexture(this.splatLightningTexture);this.splatLightningTexture=null;}
    gl.bindBuffer(gl.ARRAY_BUFFER, this.splatBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,this.sortedIndices.byteLength,gl.DYNAMIC_DRAW);
    this.sortDirty = true;
    if(keepLighting){
      // Only camera LOD storage changed. Source shadow geometry, its worker
      // index, current light and storm state remain valid throughout the swap.
      this.lodSelectionVersion=(this.lodSelectionVersion||0)+1;
      this.shadowHistory=new ShadowHistory();
      this.accumulation.setKey(null);this.dirty=true;this.reportProgress();
    }else {
      this.clusterBounds=scene.lightBounds || clusterLightBounds(scene.data);
      this.shadowBins=null;this.nextShadowBins=null;
      this.lightingWorker.postMessage({type:'scene',sceneId:++this.sceneVersion,data:scene.data});
      this.shadowReady = false;this.relight();
    }
    // Installing geometry (including its initial resize) is not camera motion.
    // Start at final LOD and let a cached HDR skip even the first shadow build.
    this.resize();this.motionRefinement=new MotionRefinement();
  }

  get autoActive(){return !!this.settings?.autoPerformance&&this.settings.view===0&&this.motionRefinement.active;}
  get effectiveLOD(){return snapLODMultiplier(this.autoActive?this.autoPerformance.settings.lod:(this.settings?.lodMultiplier??CLOUD_LOD.defaultMultiplier));}
  get instanceCount(){return this.instances?.length||1;}

  uploadCloudOffsets(){
    const gl=this.gl,offsets=this.instances||SINGLE_CLOUD,data=new Float32Array(offsets.length*4);
    offsets.forEach((p,i)=>data.set(p,i*4));
    gl.bindTexture(gl.TEXTURE_2D,this.cloudOffsetsTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,offsets.length,1,0,gl.RGBA,gl.FLOAT,data);
    for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.NEAREST);
    for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);
  }

  setInstances(offsets){
    validateCloudCount(offsets.length);
    if(offsets.some(p=>p.length!==3||p.some(v=>!Number.isFinite(Math.fround(v)))))throw new Error('Cloud positions must contain three finite coordinates.');
    if(this.scene&&(this.scene.lod?.count||this.scene.count)*offsets.length>2**32)throw new Error('This cloud group exceeds the renderer index capacity.');
    this.instances=offsets.map(p=>p.map(Math.fround));this.instanceVersion=(this.instanceVersion||0)+1;
    this.autoPerformance.setLimit(automaticLODLimit(this.instanceCount));
    this.uploadCloudOffsets();
    this.lodTags=this.scene?.lod?new Int8Array(this.scene.lod.centers.length/3*offsets.length).fill(-1):null;
    this.fineLodTags=this.scene?.lod?.fine?new Int8Array(this.scene.lod.fine.centers.length/3*offsets.length).fill(-1):null;
    this.sortDirty=true;this.dirty=true;this.accumulation?.setKey(null);
    this.autoTiming=null;clearTimeout(this.autoTimer);
    this.frameRate?.reset();this.pendingFrameForFPS=false;
  }

  ensureVisibleCapacity(required){
    if(this.visibleIndices.length>=required)return;
    const capacity=Math.max(required,Math.ceil(this.visibleIndices.length*1.5)),indices=new Uint32Array(capacity);
    indices.set(this.visibleIndices);this.visibleIndices=indices;this.sortedIndices=new Uint32Array(capacity);this.keys=new Uint16Array(capacity);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.splatBuffer);this.gl.bufferData(this.gl.ARRAY_BUFFER,capacity*4,this.gl.DYNAMIC_DRAW);
  }

  configure(values) {
    if(values.colorByLOD!==undefined&&typeof values.colorByLOD!=='boolean')throw new Error('Invalid colorByLOD');
    if(values.autoPerformance!==undefined&&typeof values.autoPerformance!=='boolean')throw new Error('Invalid autoPerformance');
    if(values.autoPerformance!==undefined&&values.autoPerformance!==this.settings.autoPerformance){
      this.autoPerformance.resetMeasurements();this.autoTiming=null;clearTimeout(this.autoTimer);
      this.sortDirty=true;this.lodTags?.fill(-1);this.fineLodTags?.fill(-1);
    }
    if(values.cloudScale!==undefined&&(!Number.isFinite(values.cloudScale)||(values.cloudScale!==0&&(values.cloudScale<CLOUD_SAMPLING.minimumScale||values.cloudScale>1))))throw new Error('Invalid cloudScale');
    if(values.lodMultiplier!==undefined&&(!Number.isFinite(values.lodMultiplier)||(values.lodMultiplier!==0&&(values.lodMultiplier<CLOUD_LOD.minMultiplier||values.lodMultiplier>CLOUD_LOD.maxMultiplier))))throw new Error('Invalid lodMultiplier');
    if(values.shadowReuse!==undefined&&(!Number.isInteger(values.shadowReuse)||values.shadowReuse<1||values.shadowReuse>16))throw new Error('Invalid shadowReuse');
    for(const name of ['localShadowStrength','fineShadingStrength'])if(values[name]!==undefined && (!Number.isFinite(values[name])||values[name]<0||values[name]>1))throw new Error(`Invalid ${name}`);
    for(const name of ['samplesPerFrame','maxSamples'])if(values[name]!==undefined && (!Number.isInteger(values[name]) || values[name]<1 || values[name]>(name==='samplesPerFrame'?8:4096)))throw new Error(`Invalid ${name}`);
    const needsLight = ['elevation','azimuth'].some(name=>values[name]!==undefined && values[name]!==this.settings[name]);
    const needsImage = ['autoPerformance','colorByLOD','density','scattering','view','quality','cloudScale','occlusion','opacityBatches','shadowCubic','shadowReuse','lodMultiplier',...Object.keys(APPEARANCE_DEFAULTS)].some(name=>values[name]!==undefined && values[name]!==this.settings[name]);
    if(values.view!==undefined&&values.view!==this.settings.view){this.sortDirty=true;this.lodTags?.fill(-1);this.fineLodTags?.fill(-1);}
    if(values.lodMultiplier!==undefined&&values.lodMultiplier!==this.settings.lodMultiplier){this.sortDirty=true;this.lodTags?.fill(-1);this.fineLodTags?.fill(-1);}
    Object.assign(this.settings, values);
    if(needsImage)this.accumulation?.setKey(null);
    this.dirty = true;
    if (needsLight && this.scene) this.relight();
  }

  resetCamera(preset) {
    this.camera = { target: [...preset.target], distance: preset.distance, yaw: preset.yaw, pitch: preset.pitch };
    this.motionRefinement=new MotionRefinement();
    this.sortDirty = true; this.dirty = true;
  }

  flashLightning() {
    if(!this.storm)return;
    this.storm.manualFlash=(this.storm.manualFlash||0)+1;
    this.storm.time=lightningPreview(this.storm.manualFlash%2?'internal':'external',Math.floor((this.storm.manualFlash-1)/2));this.dirty=true;
  }

  relight() {
    this.accumulation?.setKey(null);
    const basis = lightBasis(sunDirection(this.settings.elevation, this.settings.azimuth));
    const bounds=lightBounds(this.clusterBounds,basis);
    this.pendingLight = { ...basis, ...bounds, elevation:this.settings.elevation, azimuth:this.settings.azimuth,
      id:++this.lightVersion, requestedAt:performance.now(),ambient:ambientSky(basis.forward,this.settings.elevation,!!this.storm) };
    this.lightMetrics = { requestedId:this.lightVersion, fineInstances:0 };
    this.requestShadowBins(this.pendingLight);
    this.shadowLayer = 0;
    this.dirty = true;
    this.onStatus({ state: 'lighting', progress: 0, count: this.scene.count });
  }

  lightUniforms(p, light) {
    p.uniform('uLightRight', light.right); p.uniform('uLightUp', light.up); p.uniform('uLightForward', light.forward);
    p.uniform('uLightMin', light.min); p.uniform('uLightSpan', light.span);p.uniform('uAmbient',light.ambient);
  }

  requestShadowBins(light) {
    const index=this.closestShadowBins(light);
    if(this.lightingWorkerBusy || (index && lightDirectionDelta(index.forward,light.forward)<.06))return;
    this.lightingWorkerBusy=true;
    this.lightingWorker.postMessage({type:'light',id:light.id,sceneId:this.sceneVersion,light});
  }

  closestShadowBins(light) {
    if(!this.shadowBins)return this.nextShadowBins;
    if(!this.nextShadowBins)return this.shadowBins;
    return lightDirectionDelta(this.nextShadowBins.forward,light.forward)<lightDirectionDelta(this.shadowBins.forward,light.forward)?this.nextShadowBins:this.shadowBins;
  }

  shadowNodePosition(layer) {return layer/(this.shadowSize[2]-1);}

  bindShadow(p) {
    const gl=this.gl;
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,this.shadowTextures[0]);p.integer('uShadow',0);
    p.uniform('uShadowDepth',this.shadowSize[2]);
    p.uniform('uShadowStep',this.activeLight.span[2]/(this.shadowSize[2]-1));
    p.uniform('uShadowCubic',this.settings.shadowCubic);
  }

  bindShadowLayer(layer) {
    const gl=this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowFBO);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,this.shadowTextures[0],0,layer);
  }

  buildShadow(sampleIndex) {
    const gl=this.gl,base=this.pendingLight || this.light;
    if(!base)return false;
    this.requestShadowBins(base);
    const index=this.closestShadowBins(base);
    // A stale ordering changes only conservative draw ranges. The integrals
    // always use the current sun, including while the user drags the dial.
    if(!index || lightDirectionDelta(index.forward,base.forward)>.35)return false;
    if(index===this.nextShadowBins) {
      this.shadowBins=index;this.nextShadowBins=null;
      gl.bindBuffer(gl.ARRAY_BUFFER,this.shadowBuffer);
      gl.bufferData(gl.ARRAY_BUFFER,index.data,gl.DYNAMIC_DRAW);index.data=null;
    }
    const key=`${base.id}:${sampleIndex}`;
    if(key===this.shadowSampleKey)return true;
    const light=jitterLight(base,this.shadowSize,sampleSequence(sampleIndex));
    const [w,h,depth]=this.shadowSize,p=this.programs.shadowSlab,resolve=this.programs.shadowResolve;
    gl.viewport(0,0,w,h);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
    gl.clearColor(0,0,0,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowScratchFBO);gl.clear(gl.COLOR_BUFFER_BIT);
    this.bindShadowLayer(depth-1);gl.clear(gl.COLOR_BUFFER_BIT);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('The sunlight sample buffer is not renderable on this GPU.');
    gl.useProgram(p.id);this.lightUniforms(p,light);p.uniform('uShadowResolution',[w,h]);
    gl.blendFunc(gl.ONE,gl.ONE);
    let instances=0;
    // Each image sample uses the same complete lattice, shifted within one
    // cell. No coarse/high-quality modes or later replacement field exist.
    // Keep the prefix in the supported scratch format and add analytic
    // finite segments. The 32-bit path avoids half-float prefix rounding;
    // the compatibility path trades that precision for wider GPU support.
    for(let layer=depth-2;layer>=0;layer--) {
      const z=light.min[2]+this.shadowNodePosition(layer)*light.span[2];
      const upper=light.min[2]+this.shadowNodePosition(layer+1)*light.span[2];
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowScratchFBO);
      // Optical depth is a prefix; density is the derivative at this plane.
      // Clear only the derivative before adding this slice's contributions.
      gl.colorMask(false,true,false,false);gl.clear(gl.COLOR_BUFFER_BIT);gl.colorMask(true,true,true,true);
      gl.useProgram(p.id);gl.bindVertexArray(this.shadowVAO);gl.enable(gl.BLEND);
      p.uniform('uSlice',z);p.uniform('uSlabLength',upper-z);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.shadowBuffer);
      for(const [start,count] of shadowSegmentRanges(index,light,z,upper)) {
        gl.vertexAttribPointer(0,4,gl.FLOAT,false,32,start*32);gl.vertexAttribPointer(1,4,gl.FLOAT,false,32,start*32+16);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,count);instances+=count;
      }
      gl.disable(gl.BLEND);this.bindShadowLayer(layer);
      gl.useProgram(resolve.id);gl.bindVertexArray(this.fullscreenVAO);
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.shadowScratch);resolve.integer('uSource',2);
      gl.drawArrays(gl.TRIANGLES,0,3);
    }
    this.shadowKnown.fill(1);this.shadowSamples=depth;this.shadowLayer=depth;
    this.activeLight=light;this.light=base;this.shadowReady=true;this.pendingLight=null;this.shadowSampleKey=key;
    this.lightMetrics.fineInstances=instances;
    this.lightMetrics.fieldsBuilt=(this.lightMetrics.fieldsBuilt||0)+1;
    if(this.lightMetrics.firstFieldSubmittedMs===undefined)this.lightMetrics.firstFieldSubmittedMs=performance.now()-base.requestedAt;
    return true;
  }

  cameraFrame() {
    const c = this.camera;
    const offset = [Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)];
    const distance = viewDistance(c.distance,this.canvas.clientWidth,this.canvas.clientHeight);
    const eye = c.target.map((x, i) => x + distance * offset[i]);
    const forward = offset.map(x => -x);
    const right = normalize(cross(forward, [0, 1, 0]));
    return { eye, forward, right, up: normalize(cross(right, forward)) };
  }

  sort(frame) {
    const start=performance.now(),{count,lod}=this.scene,data=this.renderData||this.scene.data,f=frame.forward;
    const instances=this.instances||SINGLE_CLOUD,stride=lod?.count||count,counts=this.counts;counts.fill(0);
    const right=frame.right,up=frame.up;
    const frustum=makeFrustum(this.canvas.width/this.canvas.height,CAMERA_VIEW.tanHalfFov,CAMERA_VIEW.lensShift,[1/this.canvas.width,1/this.canvas.height]);
    const multiplier=this.effectiveLOD,chunks=lod?.centers.length/3||0,levels=lod?.offsets.length||1,fine=lod?.fine,fineCells=fine?.centers.length/3||0;
    const levelCounts=Array(levels).fill(0),drawnByLevel=Array(levels).fill(0),chunksByLevel=Array(levels).fill(0),rangeCounts=Array(levels).fill(0),perCloud=[];
    const focal=this.canvas.height/(2*CAMERA_VIEW.tanHalfFov);let min=Infinity,max=-Infinity,visible=0,covarianceVisible=0,selected=0,culled=0,selectionChanged=false;
    let farthestCenter=-Infinity;
    if(fine)for(let c=0;c<chunks;c++)farthestCenter=Math.max(farthestCenter,lod.centers[c*3]*f[0]+lod.centers[c*3+1]*f[1]+lod.centers[c*3+2]*f[2]);
    for(let instance=0;instance<instances.length;instance++){
      let hasCoarse=false;
      const eye=frame.eye.map((v,a)=>v-instances[instance][a]),planes=worldFrustumPlanes({...frame,eye},frustum),firstVisible=visible,indexBase=instance*stride;
      const appendRange=(begin,end,classification,sourceOrder,fineOnly=false)=>{
        this.ensureVisibleCapacity(visible+end-begin);
        let eligible=0;
        for(let j=begin;j<end;j++){
          const id=sourceOrder?sourceOrder[j]:j;
          if(fineOnly&&this.lodTags[instance*chunks+fine.owners[id]]!==0)continue;
          eligible++;
          const i=id*8,dx=data[i]-eye[0],dy=data[i+1]-eye[1],dz=data[i+2]-eye[2],depth=dx*f[0]+dy*f[1]+dz*f[2];
          if(classification===0&&!sphereInFrustum(dx*right[0]+dy*right[1]+dz*right[2],dx*up[0]+dy*up[1]+dz*up[2],depth,this.supportRadii[id],frustum))continue;
          this.visibleIndices[visible++]=indexBase+id;min=Math.min(min,depth);max=Math.max(max,depth);
          if(id>=this.covarianceStart)covarianceVisible++;
        }
        return eligible;
      };
      if(lod&&multiplier>0){
        if(fine){this.fineLodTags??=new Int8Array(fineCells*instances.length).fill(-1);this.activeFineCells??=new Uint8Array(fineCells);this.activeFineCells.fill(0);}
        // Every projected diameter is at least the on-axis point-depth
        // bound. If even the farthest center cannot use coarse detail,
        // traverse only the original fine cells, with no owner filtering.
        const farDepth=farthestCenter-dot(eye,f),coarsePossible=!fine||farDepth>0&&focal*CLOUD_LOD.cellSize*Math.sqrt(3)/farDepth<=CLOUD_LOD.levels[FINE_LOD_LEVEL+1].maxPixels*multiplier*(1+CLOUD_LOD.hysteresis);
        if(!coarsePossible)for(let c=0;c<chunks;c++){const tag=instance*chunks+c;if(this.lodTags[tag]!==0)selectionChanged=true;this.lodTags[tag]=0;}
        if(coarsePossible)for(let chunk=0;chunk<chunks;chunk++){
          const classification=classifyBox(lod.bounds,chunk*6,planes);
          if(classification===-1){culled++;if(fine)this.lodTags[instance*chunks+chunk]=-2;continue;}
          const cx=lod.centers[chunk*3]-eye[0],cy=lod.centers[chunk*3+1]-eye[1],cz=lod.centers[chunk*3+2]-eye[2];
          const pixels=projectedCubePixels(cx*right[0]+cy*right[1]+cz*right[2],cx*up[0]+cy*up[1]+cz*up[2],cx*f[0]+cy*f[1]+cz*f[2],focal,lod.radii?.[chunk]);
          for(let l=0;l<levels;l++)rangeCounts[l]=lod.offsets[l][chunk+1]-lod.offsets[l][chunk];
          const tag=instance*chunks+chunk,chosen=chooseLodLevel(pixels,multiplier,this.lodTags[tag],rangeCounts),level=fine&&chosen<=FINE_LOD_LEVEL?0:chosen;
          if(this.lodTags[tag]!==level)selectionChanged=true;
          this.lodTags[tag]=level;
          if(fine&&level===0){for(let i=fine.rootCellOffsets[chunk];i<fine.rootCellOffsets[chunk+1];i++)this.activeFineCells[fine.rootCells[i]]=1;continue;}
          if(fine)hasCoarse=true;
          const begin=lod.offsets[level][chunk],end=lod.offsets[level][chunk+1];
          chunksByLevel[level]++;levelCounts[level]+=end-begin;selected+=end-begin;
          const before=visible;appendRange(begin,end,classification,level===0?lod.sourceOrder:null);drawnByLevel[level]+=visible-before;
        }
        if(fine)for(let cell=0;cell<fineCells;cell++)if(!hasCoarse||this.activeFineCells[cell]) {
          const classification=classifyBox(fine.bounds,cell*6,planes);if(classification===-1){culled++;continue;}
          const cx=fine.centers[cell*3]-eye[0],cy=fine.centers[cell*3+1]-eye[1],cz=fine.centers[cell*3+2]-eye[2];
          const pixels=projectedCubePixels(cx*right[0]+cy*right[1]+cz*right[2],cx*up[0]+cy*up[1]+cz*up[2],cx*f[0]+cy*f[1]+cz*f[2],focal);
          rangeCounts.fill(0);for(let l=0;l<=FINE_LOD_LEVEL;l++)rangeCounts[l]=fine.offsets[l][cell+1]-fine.offsets[l][cell];
          const tag=instance*fineCells+cell,level=chooseLodLevel(pixels,multiplier,this.fineLodTags[tag],rangeCounts);
          if(this.fineLodTags[tag]!==level)selectionChanged=true;this.fineLodTags[tag]=level;
          const before=visible,eligible=appendRange(fine.offsets[level][cell],fine.offsets[level][cell+1],classification,fine.orders[level],hasCoarse);
          if(eligible){chunksByLevel[level]++;levelCounts[level]+=eligible;selected+=eligible;drawnByLevel[level]+=visible-before;}
        }
      }else for(let block=0;block<count;block+=this.cullBlockSize){
        const classification=classifyBox(this.cullBlocks,block/this.cullBlockSize*6,planes);
        if(classification===-1)continue;
        appendRange(block,Math.min(count,block+this.cullBlockSize),classification,null);
      }
      perCloud.push(visible-firstVisible);
    }
    if(selectionChanged)this.lodSelectionVersion=(this.lodSelectionVersion||0)+1;
    this.lodStats=lod&&multiplier>0?{multiplier,chunks:chunks*instances.length,chunksByLevel,splatsByLevel:levelCounts,drawnByLevel,selected,culled,sourceCount:count,residentCount:stride}:{multiplier:0,drawnByLevel:[visible],selected:visible,sourceCount:count,residentCount:stride};
    this.instanceStats={count:instances.length,visible:perCloud.filter(n=>n>0).length,perCloud,drawn:visible};this.visibleCount=visible;this.visibleCovarianceCount=covarianceVisible;
    const {keys,visibleIndices,sortedIndices}=this,eyeDepth=dot(frame.eye,f),offsetDepths=instances.map(p=>dot(p,f)),scale=65535/Math.max(1e-6,max-min);
    for(let i=0;i<visible;i++){
      const index=visibleIndices[i],instance=Math.floor(index/stride),j=(index-instance*stride)*8;
      const key=clamp(Math.floor((data[j]*f[0]+data[j+1]*f[1]+data[j+2]*f[2]-eyeDepth+offsetDepths[instance]-min)*scale),0,65535);
      keys[i]=key;counts[key]++;
    }
    let offset=0;
    for(let key=65535;key>=0;key--){const n=counts[key];counts[key]=offset;offset+=n;}
    for(let i=0;i<visible;i++)sortedIndices[visible-1-counts[keys[i]]++]=visibleIndices[i];
    const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,this.splatBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,sortedIndices.subarray(0,visible));
    this.sortDirty=false;this.sortMs=performance.now()-start;
  }

  resize() {
    const gl = this.gl;
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * this.settings.quality;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * ratio)), h = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    const [cw,ch]=cloudResolution(w,h,this.settings.cloudScale,this.settings.view);
    if (this.canvas.width === w && this.canvas.height === h && this.sceneWidth === cw && this.sceneHeight === ch) return;
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;this.sortDirty=true;}
    this.sceneWidth=cw;this.sceneHeight=ch;
    this.storm?.resize(w,h,cw,ch);
    if(this.storm) {
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.sceneFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,this.storm.sample.texture,0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
    }
    // Resize the already-attached depth storage before checking the color FBO.
    // Otherwise a second resize temporarily pairs new color with old depth size.
    gl.bindRenderbuffer(gl.RENDERBUFFER,this.opacityDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,cw,ch);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    // Store transmittance T, not opacity 1-T, in alpha. Half float retains
    // relative precision as T approaches zero and has native fast blending.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, cw, ch, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.opacityDepth);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Opacity depth buffer is not renderable.');
    // Share only depth with the color pass. Reading sceneTexture here cannot
    // feed back into a color attachment and needs no full-image copy.
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.opacityFBO);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.opacityDepth);
    gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Opacity mask buffer is not renderable.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.canvas.dispatchEvent(new CustomEvent('resolutionchange', { detail: [w, h] }));
  }

  cameraUniforms(p, frame, resolution=[this.canvas.width,this.canvas.height]) {
    p.uniform('uEye', frame.eye); p.uniform('uRight', frame.right); p.uniform('uUp', frame.up); p.uniform('uForward', frame.forward);
    p.uniform('uResolution',resolution);p.uniform('uShadingResolution',[this.canvas.width,this.canvas.height]); p.uniform('uAspect', this.canvas.width / this.canvas.height);
    p.uniform('uRasterPadding',this.rasterSubpixel);
    p.uniform('uLensShift',CAMERA_VIEW.lensShift);
    p.uniform('uTanFov',CAMERA_VIEW.tanHalfFov);
    const jitter=this.currentSample?.pixel||[0,0];
    p.uniform('uPixelJitter',[jitter[0]*resolution[0]/this.canvas.width,jitter[1]*resolution[1]/this.canvas.height]);
    p.uniform('uAbsorptionSample',this.currentSample?.absorption || 0);
    p.uniform('uSun', this.activeLight?.forward || sunDirection(this.settings.elevation, this.settings.azimuth));
    p.uniform('uSunElevation', this.activeLight?.elevation ?? this.settings.elevation);
    p.uniform('uNight',this.storm?1:0);
  }

  get lastSceneKey() { return this.accumulation.key; }
  set lastSceneKey(value) { this.accumulation.setKey(value); }

  imageKey(frame=this.cameraFrame(),includeLOD=true) {
    return JSON.stringify([this.sceneVersion,this.canvas.width,this.canvas.height,this.sceneWidth,this.sceneHeight,frame,
      this.instanceVersion||0,this.lightVersion,this.settings.density,this.settings.scattering,this.settings.view,this.settings.colorByLOD,this.settings.occlusion,this.settings.opacityBatches,this.settings.shadowCubic,this.settings.shadowReuse,includeLOD?(this.lodSelectionVersion||0):0,
      ...Object.keys(APPEARANCE_DEFAULTS).map(k=>this.settings[k])]);
  }

  get sampleTarget(){return this.storm?Math.min(this.settings.maxSamples,STORM.samples):this.settings.maxSamples;}

  // The stored mean precedes lens/exposure processing and retains all 128 samples.
  // Runtime scene/light version counters cannot identify an image across visits.
  completedFrameKey() {
    if(!this.completedFrames.enabled||!this.scene||this.scene.preview||this.storm||this.autoActive||this.effectiveLOD!==1||this.settings.orbit||this.settings.view!==0||this.settings.colorByLOD)return null;
    return completedViewKey({
      source:[this.scene.preset,this.scene.seed,this.scene.count,this.scene.detailBake?.method||'cpu'],
      camera:this.cameraFrame(),instances:this.instances,
      resolution:[this.canvas.width,this.canvas.height,this.sceneWidth,this.sceneHeight],
      precision:[this.capabilities.imagePrecision,this.capabilities.shadowPrecision],rasterSubpixel:this.rasterSubpixel,
      samples:this.sampleTarget,settings:this.settings,
    });
  }

  get finishedFrameActive() {
    return !!this.restoredFrameKey&&this.restoredFrameKey===this.completedFrameKey()&&this.accumulation.key===this.imageKey();
  }

  get readyToSave() {
    return !this.scene?.preview && this.pendingRenderMode==null &&
      (this.finishedFrameActive||(this.shadowReady&&!this.pendingLight)) &&
      this.accumulation.count>=this.sampleTarget && this.accumulation.key===this.imageKey();
  }

  get renderState() {
    return this.pendingRenderMode!=null?'switching':!this.scene?'initializing':this.readyToSave?'ready':this.pendingLight||!this.shadowReady?'lighting':'refining';
  }

  restoreCompletedFrame(key,frame,source) {
    const gl=this.gl,a=this.accumulation;
    if(frame.width!==this.canvas.width||frame.height!==this.canvas.height||frame.samples!==this.sampleTarget||frame.precision!==this.capabilities.imagePrecision)return false;
    gl.activeTexture(gl.TEXTURE0);
    const textures=[a.current.texture,...(a.half?[a.current.residual]:[])];
    for(let i=0;i<textures.length;i++){
      gl.bindTexture(gl.TEXTURE_2D,textures[i]);
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,frame.width,frame.height,gl.RGBA,gl.FLOAT,frame.planes[i]);
    }
    a.count=frame.samples;this.restoredFrameKey=key;
    this.completedFrames.restored(source);this.restoreSubmittedAt=performance.now();
    return true;
  }

  captureCompletedFrame() {
    const key=this.completedFrameKey();
    if(!key||this.frameReadback||this.frameReadbackFailed||this.finishedFrameActive||!this.readyToSave||this.completedFrames.hasStored(key))return;
    const gl=this.gl,width=this.canvas.width,height=this.canvas.height,planes=this.accumulation.half?2:1,planeBytes=width*height*16;
    if(planeBytes*planes>FRAME_MEMORY_LIMIT)return;
    const previous=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),buffer=gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);gl.bufferData(gl.PIXEL_PACK_BUFFER,planeBytes*planes,gl.STREAM_READ);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.accumulation.current.fbo);
    for(let i=0;i<planes;i++){
      gl.readBuffer(gl.COLOR_ATTACHMENT0+i);
      gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,i*planeBytes);
    }
    gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,previous);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    if(gl.getError()!==gl.NO_ERROR){gl.deleteBuffer(buffer);this.frameReadbackFailed=true;this.completedFrames.metrics.errors++;return;}
    this.frameReadback={key,width,height,samples:this.accumulation.count,precision:this.capabilities.imagePrecision,planes,planeBytes,buffer,fence:gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0)};
    gl.flush();
  }

  pollCompletedFrame() {
    const read=this.frameReadback;if(!read)return;
    const gl=this.gl,status=gl.clientWaitSync(read.fence,0,0);
    if(status===gl.TIMEOUT_EXPIRED)return;
    if(status!==gl.WAIT_FAILED){
      const data=new Float32Array(read.planeBytes*read.planes/4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER,read.buffer);gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,data);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
      const planes=Array.from({length:read.planes},(_,i)=>data.subarray(i*read.planeBytes/4,(i+1)*read.planeBytes/4));
      this.completedFrames.store(read.key,{width:read.width,height:read.height,samples:read.samples,precision:read.precision,planes});
    }
    gl.deleteSync(read.fence);gl.deleteBuffer(read.buffer);this.frameReadback=null;
  }

  reportProgress() {
    this.onStatus({state:this.renderState,
      progress:this.accumulation.count/this.sampleTarget,samples:this.accumulation.count,target:this.sampleTarget,count:this.scene?.count,visibleCount:this.visibleCount});
  }

  renderSample(frame,sample) {
    const gl=this.gl,w=this.sceneWidth,h=this.sceneHeight;
    this.currentSample=sample;
    if(this.scene&&this.shadowReady&&this.settings.view!==1) {
      gl.bindVertexArray(this.fullscreenVAO);
      this.rayTerms.render(w,h,p=>this.cameraUniforms(p,frame,[w,h]));
    }
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0,0,0,1);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.sceneFBO);gl.depthMask(true);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    let p;
    if (this.scene && this.shadowReady) {
      // Keep the original kernel for purely diagonal views. Only views that
      // actually mix representations pay for a per-splat covariance branch.
      this.splatProgramName=this.visibleCovarianceCount===0?'splat':this.visibleCovarianceCount===this.visibleCount?'splatCovariance':'splatMixed';
      p = this.programs[this.splatProgramName];
      gl.useProgram(p.id); gl.bindVertexArray(this.splatVAO);
      this.cameraUniforms(p, frame,[w,h]); this.lightUniforms(p, this.activeLight);
      p.uniform('uDensity', this.settings.density); p.uniform('uScattering', this.settings.scattering); p.uniform('uTop', this.scene.max[1]);
      for(const name of Object.keys(APPEARANCE_DEFAULTS))p.uniform(`u${name[0].toUpperCase()+name.slice(1)}`,this.scene.lighting?this.settings[name]:0);
      if(!this.scene.detail){p.uniform('uLocalShadowStrength',0);p.uniform('uFineShadingStrength',0);}
      p.integer('uView', this.settings.view);
      p.integer('uColorByLOD',this.settings.colorByLOD?1:0);
      if(this.settings.colorByLOD)p.integers('uLodStarts[0]',this.lodColorStarts);
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.splatDataTexture);p.integer('uSplatData',3);
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,this.splatAppearanceTexture);p.integer('uSplatAppearance',4);
      gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,this.splatDetailTexture);p.integer('uSplatDetail',5);
      gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,this.splatLightningTexture||this.splatAppearanceTexture);p.integer('uSplatLightning',6);
      gl.activeTexture(gl.TEXTURE10);gl.bindTexture(gl.TEXTURE_2D,this.splatCovarianceTexture);p.integer('uSplatCovariance',10);p.integer('uCovarianceStart',this.covarianceStart);
      p.integer('uSplatColumnBits',this.splatColumnBits);
      gl.activeTexture(gl.TEXTURE9);gl.bindTexture(gl.TEXTURE_2D,this.cloudOffsetsTexture);p.integer('uCloudOffsets',9);p.integer('uCloudStride',this.scene.lod?.count||this.scene.count);
      this.bindShadow(p);
      this.rayTerms.bind(p);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.sceneTexture);
      const occlusion=this.settings.occlusion && this.settings.view!==1;
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.DST_ALPHA,gl.ONE,gl.ZERO,gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.splatBuffer);
      const batch=occlusion?Math.max(2048,Math.ceil(this.visibleCount/(this.settings.opacityBatches||OPACITY_BATCHES))):Math.max(1,this.visibleCount);
      for(let start=0;start<this.visibleCount;start+=batch) {
        if(start>0) {
          gl.bindFramebuffer(gl.FRAMEBUFFER,this.opacityFBO);
          // Convert accumulated opacity to a hardware early-depth mask. Later
          // splats are rejected before their expensive fragment shader runs.
          const mask=this.programs.opacityMask;
          gl.useProgram(mask.id);gl.bindVertexArray(this.fullscreenVAO);mask.integer('uVisibility',1);
          gl.disable(gl.BLEND);gl.colorMask(false,false,false,false);gl.depthMask(true);gl.depthFunc(gl.ALWAYS);
          gl.drawArrays(gl.TRIANGLES,0,3);
          gl.bindFramebuffer(gl.FRAMEBUFFER,this.sceneFBO);
          gl.colorMask(true,true,true,true);gl.depthMask(false);gl.depthFunc(gl.LESS);gl.enable(gl.BLEND);
          gl.useProgram(p.id);gl.bindVertexArray(this.splatVAO);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER,this.splatBuffer);
        gl.vertexAttribIPointer(0,1,gl.UNSIGNED_INT,4,start*4);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,Math.min(batch,this.visibleCount-start));
      }
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.effects.image.fbo);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    p = this.programs.radiance;
    gl.useProgram(p.id); gl.bindVertexArray(this.fullscreenVAO);
    this.cameraUniforms(p,frame);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture); p.integer('uScene', 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render({advance=false}={}) {
    const gl=this.gl,start=performance.now(),previousShadow=this.shadowSampleKey;
    this.resize();
    const frame=this.cameraFrame(),w=this.canvas.width,h=this.canvas.height;
    if(this.scene && this.sortDirty)this.sort(frame);
    this.effects.resize(w,h);this.accumulation.resize(w,h);
    const changed=this.accumulation.setKey(this.imageKey(frame));
    if(changed)this.storm?.reset();
    let restored=false,cachePending=false;
    const completedKey=this.completedFrameKey();
    if(this.restoredFrameKey!==completedKey)this.restoredFrameKey=null;
    if(completedKey&&!this.finishedFrameActive&&this.accumulation.count<this.sampleTarget){
      const cached=this.completedFrames.lookup(completedKey);
      if(cached.frame)restored=this.restoreCompletedFrame(completedKey,cached.frame,cached.source);
      else cachePending=cached.pending;
    }
    let added=0;
    if(this.scene && !this.finishedFrameActive && !cachePending && (advance || changed || !this.accumulation.count)) {
      const budget=this.accumulation.remaining(this.autoActive?1:this.settings.samplesPerFrame,this.sampleTarget);
      for(let i=0;i<budget;i++) {
        const sampleIndex=this.accumulation.count;
        const reuse=this.settings.shadowReuse;
        // reuse=1 retains the original independent-field sequence for exact
        // reference comparisons and callers that request maximum light samples.
        const fieldIndex=reuse===1?sampleIndex:this.shadowHistory.select(`${this.sceneVersion}:${this.lightVersion}`,changed&&i===0,reuse);
        if(!this.buildShadow(fieldIndex))break;
        this.renderSample(frame,sampleSequence(sampleIndex));
        this.accumulation.add(this.effects.image);
        this.storm?.add(sampleIndex,(p,offset=[0,0,0])=>this.cameraUniforms(p,{...frame,eye:frame.eye.map((v,a)=>v-offset[a])}),this.settings.density,this.instances);added++;
        if(reuse!==1)this.shadowHistory.commit(reuse);
      }
    }
    // Post controls reuse the current average; they are outside the estimator.
    if(this.accumulation.count) {
      if(this.storm&&this.settings.view===0&&!this.settings.colorByLOD)this.storm.compose(this.accumulation.current,this.effects.image);
      else this.accumulation.present(this.effects.image);
    }
    else if(!this.scene)this.renderSample(frame,sampleSequence(0));
    gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.bindVertexArray(this.fullscreenVAO);
    // Match the reconstruction footprint to zoom, with a conservative cap for
    // near/inside views. This stays a constant-cost camera operation.
    const detailScale=Math.min(2.5,30/Math.max(1,this.camera.distance));
    this.effects.render(this.settings.view===0?this.settings:{...this.settings,glare:0,vignette:0,aberration:0},!!(this.scene?.detail&&this.scene?.lighting),detailScale);
    gl.bindVertexArray(null);
    if(added || restored || this.storm || this.autoActive) {
      clearTimeout(this.autoTimer);this.autoTiming=null;
      if(this.sampleFence)gl.deleteSync(this.sampleFence);
      this.sampleScene=this.scene;
      this.sampleFence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
      if(this.autoActive&&this.scene&&!document.hidden){
        this.autoTiming={fence:this.sampleFence,start,kind:previousShadow!==this.shadowSampleKey?'lighting':added?'volume':'post',level:this.autoPerformance.level};
        this.measureAutoFrame();
      }
    }
    this.lastFrameSamples=added;this.frameCount++;this.submitMs=performance.now()-start;this.dirty=false;
    if(this.storm&&this.readyToSave)this.storm.started=true;
    if(this.scene)this.reportProgress();
  }

  measureAutoFrame(){
    // Poll without blocking the main thread. RAF-only polling quantizes an
    // inexpensive GPU frame to a whole refresh interval and hides headroom.
    const timing=this.autoTiming;
    if(!timing||this.disposed||document.hidden||timing.fence!==this.sampleFence)return;
    const status=this.gl.clientWaitSync(timing.fence,0,0);
    if(status===this.gl.ALREADY_SIGNALED||status===this.gl.CONDITION_SATISFIED)timing.ms=performance.now()-timing.start;
    else if(status===this.gl.TIMEOUT_EXPIRED)this.autoTimer=setTimeout(()=>this.measureAutoFrame(),2);
  }

  recordAutoFrame(){
    const timing=this.autoTiming;this.autoTiming=null;clearTimeout(this.autoTimer);
    if(!timing)return;
    this.autoWorkKind=timing.kind;
    if(!this.autoActive||document.hidden||!this.needsSceneFrame())return;
    if(this.continueIdleRefinement())return;
    const now=performance.now();
    if(this.autoPerformance.observe(timing.ms??now-timing.start,now,{kind:timing.kind}))
      this.canvas.dispatchEvent(new CustomEvent('performancechange',{detail:this.autoPerformance.diagnostics()}));
  }

  updateAutoPerformance(now=performance.now()){
    const active=this.autoActive&&!document.hidden&&this.needsSceneFrame()&&!this.continueIdleRefinement();
    const timing=this.autoTiming,kind=timing?.kind??this.autoWorkKind,stats=active?this.frameRate?.read(now):null;
    const pendingMs=timing&&timing.ms===undefined?Math.max(0,now-timing.start):0;
    if(!this.autoPerformance?.advance(now,{active:active&&kind==='volume',fps:stats?.state==='active'?stats.recentFPS:null,pendingMs}))return;
    // Numeric scale updates preserve history until selected ranges change.
    this.sortDirty=true;this.dirty=true;
    this.canvas.dispatchEvent(new CustomEvent('performancechange',{detail:this.autoPerformance.diagnostics()}));
  }

  continueIdleRefinement(){
    if(!this.idleRefinementKey)return false;
    const moving=!this.animationPaused&&(this.settings.orbit||(this.storm?.started&&this.settings.lightning));
    if(!moving&&this.idleRefinementKey===this.imageKey(this.cameraFrame(),false))return true;
    this.idleRefinementKey=null;this.autoPerformance.resetMeasurements();return false;
  }

  updateIdlePerformance(now){
    // Restore the reference LOD once, before accumulating the final image.
    // The original decayed through several LODs, finishing 128 samples at each.
    const animated=!this.animationPaused&&(this.settings.orbit||(this.storm?.started&&this.settings.lightning));
    if(!this.motionRefinement.update(now,this.imageKey(this.cameraFrame(),false),animated))return;
    this.idleRefinementKey=null;this.autoPerformance.level=0;
    this.autoPerformance.resetMeasurements();
    this.sortDirty=true;this.dirty=true;
  }

  needsSceneFrame(){
    return !!this.scene&&!!(this.pendingRenderMode!=null||this.pendingFrameForFPS||this.dirty||(this.pendingLight&&!this.finishedFrameActive)||this.accumulation.count<this.sampleTarget||(this.settings.orbit&&this.shadowReady&&!this.animationPaused));
  }

  renderStats(now=performance.now()){
    return {...(this.frameRate?.read(now)||{state:'measuring',fps:null}),lod:{...lodSummary(this.lodStats),scale:this.scene?this.effectiveLOD:null}};
  }

  reportRenderStats(force=false){
    if(!this.frameRate)return;
    const now=performance.now();this.frameRate.setActive(!document.hidden&&this.needsSceneFrame(),now);
    const stats=this.renderStats(now);if(document.hidden)stats.state='paused';
    if(force||stats.lod.scale!==this.lastRenderStatsLOD||now-this.lastRenderStatsAt>=RENDER_STATS.refreshMs||stats.state!==this.lastRenderStatsState){
      this.lastRenderStatsAt=now;this.lastRenderStatsState=stats.state;this.lastRenderStatsLOD=stats.lod.scale;
      this.canvas.dispatchEvent(new CustomEvent('renderstats',{detail:stats}));
    }
  }

  tick(time) {
    if(this.disposed || this.contextLost)return;
    try {
      this.pollCompletedFrame();
      const dt=Math.max(0,Math.min(.05,(time-this.lastTime)/1000));this.lastTime=Math.max(this.lastTime,time);
      if(document.hidden){this.autoTiming=null;clearTimeout(this.autoTimer);this.frameRate?.reset();this.pendingFrameForFPS=false;this.updateIdlePerformance(time);this.animation=requestAnimationFrame(this.tick);return;}
      // The light clock advances even while a volume sample is in flight.
      // The next drawable frame uses the current pulse, without queuing old ones.
      if(!this.animationPaused&&this.storm?.started&&this.settings.lightning&&this.settings.view===0&&this.storm.advance(dt))this.dirty=true;
      this.frameRate?.setActive(this.needsSceneFrame(),performance.now());
      // Advance the quality clock every animation frame, including GPU waits.
      // The next drawable frame consumes the latest scale without extra queuing.
      this.updateIdlePerformance(performance.now());
      // Do not queue unlimited expensive samples behind the GPU. Inputs still
      // arrive, and the next submitted sample uses the latest scene state.
      if(this.sampleFence) {
        const result=this.gl.clientWaitSync(this.sampleFence,0,0);
        if(result===this.gl.WAIT_FAILED)throw new Error('Sample rendering was interrupted. Reload to restore it.');
        if(result===this.gl.TIMEOUT_EXPIRED){this.updateAutoPerformance();this.animation=requestAnimationFrame(this.tick);return;}
        if(this.pendingFrameForFPS){this.frameRate?.complete(performance.now());this.pendingFrameForFPS=false;}
        this.recordAutoFrame();this.gl.deleteSync(this.sampleFence);this.sampleFence=null;
        this.canvas.dispatchEvent(new CustomEvent('samplecomplete',{detail:{scene:this.sampleScene}}));
        if(this.restoreSubmittedAt!=null){
          this.completedFrames.metrics.restoreMs=performance.now()-this.restoreSubmittedAt;this.restoreSubmittedAt=null;
          this.canvas.dispatchEvent(new CustomEvent('framecachechange',{detail:this.completedFrames.diagnostics()}));
        }
        if(this.readyToSave){this.captureCompletedFrame();this.reportProgress();}
      }
      this.applyRenderingMode();
      if(this.settings.orbit && this.shadowReady && !this.animationPaused) {
        this.camera.yaw+=dt*.08;this.sortDirty=true;this.dirty=true;
      }
      this.updateAutoPerformance();
      if(this.dirty || (this.pendingLight&&!this.finishedFrameActive) || (this.scene && this.accumulation.count<this.sampleTarget)){
        this.render({advance:true});
        if(this.scene&&this.accumulation.count>0){
          if(this.sampleFence)this.pendingFrameForFPS=true;
          else this.frameRate?.complete(performance.now());
        }
      }
      this.animation=requestAnimationFrame(this.tick);
    } catch(error) {console.error(error);this.onStatus({error:error.message});}
    finally {this.reportRenderStats();}
  }

  installControls() { installCameraControls(this); }
  zoomBy(factor) { zoomCamera(this,factor); }

  async exportPNG() {
    this.render();
    if(!this.readyToSave)throw new Error('Wait for the image to finish refining before saving.');
    const blob = await new Promise(resolve => this.canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The browser could not create the image.');
    return blob;
  }

  diagnostics() {
    return { count: this.scene?.count || 0, visibleCount: this.visibleCount || 0, seed: this.scene?.seed, preset: this.scene?.preset, resolution: [this.canvas.width, this.canvas.height], shadowResolution: this.shadowSize,
      capabilities:this.capabilities,
      pendingRenderingMode:this.pendingRenderMode,
      completedCache:{active:this.finishedFrameActive,...this.completedFrames.diagnostics()},
      autoPerformance:{enabled:this.settings.autoPerformance,active:this.autoActive,idleRefining:!!this.idleRefinementKey,...this.autoPerformance.diagnostics()},
      renderStats:this.renderStats(),
      instances:this.instanceStats,cloudCount:this.instanceCount,lod:this.lodStats,cloudResolution:[this.sceneWidth,this.sceneHeight],
      state:this.renderState,frames:this.frameCount,
      accumulation:{samples:this.accumulation.count,target:this.sampleTarget,perFrame:this.settings.samplesPerFrame,lastFrameSamples:this.lastFrameSamples || 0,epoch:this.accumulation.epoch},
      storm:this.storm?{time:this.storm.time,amplitudes:this.storm.amplitudes,cachedSamples:this.storm.samples,running:this.settings.lightning}:null,
      light: {requestedId:this.lightVersion,activeId:this.activeLight?.id,phase:this.pendingLight?'waiting':'sampling',samples:this.shadowSamples,progress:this.pendingLight && this.activeLight?.id!==this.pendingLight.id ? 0 : this.shadowSamples/this.shadowSize[2],...this.lightMetrics},
      lastCpuSubmitMs: this.submitMs, lastCpuSortMs: this.sortMs, settings: { ...this.settings }, camera: { ...this.camera, target: [...this.camera.target] }, glError: this.gl.getError() };
  }

  dispose() {
    this.disposed = true;clearTimeout(this.autoTimer);this.autoTiming=null; cancelAnimationFrame(this.animation); this.abort.abort(); this.resizeObserver.disconnect();
    this.lightingWorker.terminate();this.completedFrames.dispose();
    if(this.frameReadback){this.gl.deleteSync(this.frameReadback.fence);this.gl.deleteBuffer(this.frameReadback.buffer);}
    this.effects.dispose();this.accumulation.dispose();
    this.rayTerms.dispose();
    this.storm?.dispose();
    const gl = this.gl;
    for (const p of Object.values(this.programs)) gl.deleteProgram(p.id);
    for (const vao of [this.fullscreenVAO, this.splatVAO, this.shadowVAO]) gl.deleteVertexArray(vao);
    for (const buffer of [this.splatBuffer,this.shadowBuffer]) gl.deleteBuffer(buffer);
    for (const texture of [...this.shadowTextures,this.sceneTexture,this.shadowScratch,this.splatDataTexture,this.splatAppearanceTexture,this.splatDetailTexture,this.splatCovarianceTexture,this.cloudOffsetsTexture]) gl.deleteTexture(texture);
    if(this.splatLightningTexture)gl.deleteTexture(this.splatLightningTexture);
    if(this.sampleFence)gl.deleteSync(this.sampleFence);
    gl.deleteFramebuffer(this.shadowFBO); gl.deleteFramebuffer(this.sceneFBO);gl.deleteFramebuffer(this.opacityFBO);
    gl.deleteFramebuffer(this.shadowScratchFBO);
    gl.deleteRenderbuffer(this.opacityDepth);
  }
}
