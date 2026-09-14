import GUI from 'lil-gui';
import { fragmentSource, vertexSource } from './shader';

const canvas = document.querySelector<HTMLCanvasElement>('#artwork')!;
const error = document.querySelector<HTMLParagraphElement>('#error')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const settings = {
  grain: 1,
  warmth: 0,
  specular: 1.1,
  rim: 1.25,
  saturation: 1.1,
  response: 1,
  reset,
};
let gl: WebGL2RenderingContext;
let program: WebGLProgram;
let vao: WebGLVertexArrayObject;
let uniforms: Record<string, WebGLUniformLocation | null>;
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

function initialize() {
  const context = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
  if (!context) throw new Error('WebGL 2 unavailable');
  gl = context;
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const nextProgram = gl.createProgram();
  if (!nextProgram) throw new Error('Cannot allocate program');
  program = nextProgram;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Link failed');
  vao = gl.createVertexArray()!;
  uniforms = Object.fromEntries(['uResolution', 'uView', 'uOffset', 'uLight', 'uPress', 'uGrain', 'uWarmth', 'uSpecular', 'uRim', 'uSaturation']
    .map(name => [name, gl.getUniformLocation(program, name)]));
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
  gl.uniform1f(uniforms.uSaturation,settings.saturation);
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
function start() {
  try { initialize(); }
  catch (cause) { contextLost = true; error.hidden = false; console.error(cause); }
}
start();
new ResizeObserver(() => { if (!contextLost) resize(); }).observe(canvas);
if (new URLSearchParams(location.search).has('debug')) {
  const gui = new GUI({ title: 'Rose Glass' });
  gui.add(settings,'grain',0,2,.01).name('Surface grain').onChange(wake);
  gui.add(settings,'warmth',-1,1,.01).name('Warmth').onChange(wake);
  gui.add(settings,'specular',0,2,.01).name('White reflection').onChange(wake);
  gui.add(settings,'rim',0,2,.01).name('Optical rim').onChange(wake);
  gui.add(settings,'saturation',.8,1.4,.01).name('Saturation').onChange(wake);
  gui.add(settings,'response',.1,1.5,.01).name('Drag response');
  gui.add(settings,'reset').name('Reset composition');
}
