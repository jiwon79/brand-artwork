import GUI from 'lil-gui';
import { fragmentSource, resolveSource, vertexSource } from './shader';

const canvas = document.querySelector<HTMLCanvasElement>('#artwork')!;
const error = document.querySelector<HTMLParagraphElement>('#error')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const settings = {
  grain: 1.25,
  warmth: 0,
  specular: 1.1,
  rim: 1.25,
  absorption: 1,
  diffusion: 1,
  saturation: 1.1,
  response: 1,
  reset,
};
let gl: WebGL2RenderingContext;
let program: WebGLProgram;
let resolveProgram: WebGLProgram;
let sceneTexture: WebGLTexture;
let sceneFramebuffer: WebGLFramebuffer;
let vao: WebGLVertexArrayObject;
let uniforms: Record<string, WebGLUniformLocation | null>;
let resolveUniforms: Record<string, WebGLUniformLocation | null>;
let width = 1, height = 1;
let x = 0, y = 0, vx = 0, vy = 0, targetX = 0, targetY = 0;
let lightX = 0, lightY = 0, targetLightX = 0, targetLightY = 0;
let pressure = 0, pointer: number | null = null, startX = 0, startY = 0;
let frame = 0, previous = 0, contextLost = false;

function compile(type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Cannot allocate shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message ?? 'Shader compile failed');
  }
  return shader;
}

function createProgram(source: string) {
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, source);
  const nextProgram = gl.createProgram();
  if (!nextProgram) throw new Error('Cannot allocate program');
  gl.attachShader(nextProgram, vertex);
  gl.attachShader(nextProgram, fragment);
  gl.linkProgram(nextProgram);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(nextProgram);
    gl.deleteProgram(nextProgram);
    throw new Error(message ?? 'Link failed');
  }
  return nextProgram;
}

function initialize() {
  const context = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
  if (!context) throw new Error('WebGL 2 unavailable');
  gl = context;
  program = createProgram(fragmentSource);
  resolveProgram = createProgram(resolveSource);
  const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) throw new Error('Cannot allocate scene buffer');
  sceneTexture = texture;
  sceneFramebuffer = framebuffer;
  gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  vao = gl.createVertexArray()!;
  uniforms = Object.fromEntries(['uResolution', 'uView', 'uOffset', 'uLight', 'uPress', 'uGrain', 'uWarmth', 'uSpecular', 'uRim', 'uAbsorption', 'uSaturation']
    .map(name => [name, gl.getUniformLocation(program, name)]));
  resolveUniforms = Object.fromEntries(['uScene', 'uResolution', 'uReferenceScale', 'uDiffusion']
    .map(name => [name, gl.getUniformLocation(resolveProgram, name)]));
  error.hidden = true;
  contextLost = false;
  resize();
}

function resize() {
  const bounds = canvas.getBoundingClientRect();
  width = Math.max(1, bounds.width);
  height = Math.max(1, bounds.height);
  const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(3_000_000/(width*height)));
  canvas.width = Math.round(width*dpr);
  canvas.height = Math.round(height*dpr);
  gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,canvas.width,canvas.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFramebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,sceneTexture,0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Incomplete scene buffer');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  wake();
}

function reset() {
  targetX = targetY = targetLightX = targetLightY = 0;
  if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
  pointer = null;
  canvas.dataset.interaction = 'returning';
  wake();
}

function wake() {
  if (!frame && !contextLost && !document.hidden) frame = requestAnimationFrame(render);
}

function render(now: number) {
  frame = 0;
  const dt = Math.min((now-previous)/1000 || 1/60, 1/30);
  previous = now;
  const ease = 1-Math.exp(-dt*9);
  if (reducedMotion.matches) {
    x = targetX; y = targetY; vx = vy = 0;
  } else {
    vx += ((targetX-x)*120-vx*17)*dt;
    vy += ((targetY-y)*120-vy*17)*dt;
    x += vx*dt; y += vy*dt;
  }
  lightX += (targetLightX-lightX)*ease;
  lightY += (targetLightY-lightY)*ease;
  pressure += ((pointer !== null ? 1 : 0)-pressure)*ease;
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER,sceneFramebuffer);
  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.uniform2f(uniforms.uResolution,canvas.width,canvas.height);
  gl.uniform2f(uniforms.uView,width,height);
  gl.uniform2f(uniforms.uOffset,x,y);
  gl.uniform2f(uniforms.uLight,lightX,lightY);
  gl.uniform1f(uniforms.uPress,pressure);
  gl.uniform1f(uniforms.uGrain,settings.grain);
  gl.uniform1f(uniforms.uWarmth,settings.warmth);
  gl.uniform1f(uniforms.uSpecular,settings.specular);
  gl.uniform1f(uniforms.uRim,settings.rim);
  gl.uniform1f(uniforms.uAbsorption,settings.absorption);
  gl.uniform1f(uniforms.uSaturation,settings.saturation);
  gl.drawArrays(gl.TRIANGLES,0,3);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  gl.useProgram(resolveProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D,sceneTexture);
  gl.uniform1i(resolveUniforms.uScene,0);
  gl.uniform2f(resolveUniforms.uResolution,canvas.width,canvas.height);
  gl.uniform1f(resolveUniforms.uReferenceScale,Math.min(width/590,height/1280)*canvas.width/width);
  gl.uniform1f(resolveUniforms.uDiffusion,settings.diffusion);
  gl.drawArrays(gl.TRIANGLES,0,3);
  const active = Math.abs(targetX-x)+Math.abs(targetY-y)+Math.abs(vx)+Math.abs(vy)
    +Math.abs(targetLightX-lightX)+Math.abs(targetLightY-lightY)
    +Math.abs((pointer !== null ? 1 : 0)-pressure) > .001;
  canvas.dataset.interaction = pointer !== null ? 'dragging' : active ? 'returning' : 'idle';
  if (active) wake();
}

canvas.addEventListener('pointerdown', event => {
  if (pointer !== null || event.button !== 0) return;
  pointer = event.pointerId;
  startX = event.clientX; startY = event.clientY;
  canvas.setPointerCapture(pointer);
  wake();
});
canvas.addEventListener('pointermove', event => {
  const bounds = canvas.getBoundingClientRect();
  targetLightX = (event.clientX-bounds.left)/width-.5;
  targetLightY = (event.clientY-bounds.top)/height-.5;
  if (pointer === event.pointerId) {
    const scale = Math.min(width/590,height/1280);
    targetX = Math.tanh((event.clientX-startX)/scale/180)*85*settings.response;
    targetY = Math.tanh((event.clientY-startY)/scale/220)*100*settings.response;
  }
  wake();
});
for (const name of ['pointerup','pointercancel','lostpointercapture'] as const) {
  canvas.addEventListener(name, event => { if (event.pointerId === pointer) reset(); });
}
canvas.addEventListener('pointerleave', () => { if (pointer === null) reset(); });
canvas.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); reset(); return; }
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-15,0], ArrowRight: [15,0], ArrowUp: [0,-15], ArrowDown: [0,15],
  };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  targetX = Math.max(-85, Math.min(85,targetX+direction[0]));
  targetY = Math.max(-100, Math.min(100,targetY+direction[1]));
  wake();
});
window.addEventListener('blur', reset);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(frame); frame = 0; reset(); }
  else { previous = performance.now(); wake(); }
});
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault(); contextLost = true;
  cancelAnimationFrame(frame); frame = 0;
  error.hidden = false;
});
canvas.addEventListener('webglcontextrestored', start);
function showError(cause: unknown) {
  contextLost = true;
  cancelAnimationFrame(frame); frame = 0;
  error.hidden = false;
  console.error(cause);
}
function start() {
  try { initialize(); }
  catch (cause) { showError(cause); }
}
start();
new ResizeObserver(() => {
  if (contextLost) return;
  try { resize(); }
  catch (cause) { showError(cause); }
}).observe(canvas);
if (new URLSearchParams(location.search).has('debug')) {
  const gui = new GUI({ title: 'Rose Glass' });
  gui.add(settings,'grain',0,2,.01).name('Surface grain').onChange(wake);
  gui.add(settings,'warmth',-1,1,.01).name('Warmth').onChange(wake);
  gui.add(settings,'specular',0,2,.01).name('White reflection').onChange(wake);
  gui.add(settings,'rim',0,2,.01).name('Optical rim').onChange(wake);
  gui.add(settings,'absorption',0,2,.01).name('Edge absorption').onChange(wake);
  gui.add(settings,'diffusion',0,2,.01).name('Edge diffusion').onChange(wake);
  gui.add(settings,'saturation',.8,1.4,.01).name('Saturation').onChange(wake);
  gui.add(settings,'response',.1,1.5,.01).name('Drag response');
  gui.add(settings,'reset').name('Reset composition');
}
