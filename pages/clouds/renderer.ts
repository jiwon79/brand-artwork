import * as shaders from './shaders';
import { DEFAULT_SUN, VOLUME_SIZE, SHADOW_SIZE, normalize } from './volume';
import { feedbackScale, outputSize, renderPlan, SETTLE_DELAY, type RenderPhase } from './performance';
type Program = { id: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> };
type Target = { texture: WebGLTexture; fbo: WebGLFramebuffer };
type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
export type CloudStats = { phase: RenderPhase; samples: number; target: number; width: number; height: number; fps: number; gpuMs: number | null; shadowBuilds: number; draws: number; settleMs: number; };
export class CloudRenderer {
  readonly gl: WebGL2RenderingContext;
  private readonly programs: Record<'cloud' | 'shadow' | 'average' | 'present', Program>;
  private readonly float: boolean;
  private readonly vao: WebGLVertexArrayObject;
  private densityTexture: WebGLTexture | null = null;
  private shadowTexture: WebGLTexture | null = null;
  private shadowScratch: WebGLTexture | null = null;
  private readonly shadowFbo: WebGLFramebuffer;
  private targets: Target[] = [];
  private width = 0;
  private height = 0;
  private sample = 0;
  private history = 0;
  private lastInput = -Infinity;
  private camera = { yaw: 0.23, pitch: 0.10, distance: 30, target: [0, 3.1, 0] };
  private homeCamera = { ...this.camera, target: [...this.camera.target] };
  private requestedSun = normalize(DEFAULT_SUN);
  private shadowSun = this.requestedSun.slice();
  private shadowLayer = -1;
  private shadowBuilds = 0;
  private shadowDirty = false;
  private lastShadowPreview = -Infinity;
  private movingScale = 0.6;
  private orbiting = false;
  private stopped = false;
  private frameId = 0;
  private settleTimer = 0;
  private lastFrame = 0;
  private frameTimes: number[] = [];
  private draws = 0;
  private gpuMs: number | null = null;
  private readonly timer: TimerExtension | null;
  private queries: WebGLQuery[] = [];
  private timingFrames = 0;
  private flashUntil = 0;
  private nextFlash = 0;
  private wasFlashing = false;
  private phase: RenderPhase = 'settling';
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private lastSunKey = '';
  private observer: ResizeObserver;
  private readonly abort = new AbortController();
  settings = { density: 1.55, exposure: 0, glare: 0.32, night: false, lightning: true, detail: 'balanced' as 'balanced' | 'high' };
  onStats: (stats: CloudStats) => void = () => {};
  onError: (message: string) => void = () => {};

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    if (!gl) throw new Error('이 브라우저에서는 WebGL 2를 사용할 수 없습니다. 그래픽 가속을 켜고 다시 열어주세요.');
    this.gl = gl;
    this.float = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
    this.programs = { cloud: this.program(shaders.cloudFragment), shadow: this.program(shaders.shadowFragment), average: this.program(shaders.accumulateFragment), present: this.program(shaders.presentFragment) };
    this.shadowFbo = gl.createFramebuffer()!;
    this.observer = new ResizeObserver(() => this.invalidate()); this.observer.observe(canvas);
    this.listen();
  }
  private program(fragment: string): Program {
    const gl = this.gl, program = gl.createProgram()!;
    for (const [type, source] of [[gl.VERTEX_SHADER, shaders.vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`Cloud shader: ${error}`); }
      gl.attachShader(program, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Cloud program: ${gl.getProgramInfoLog(program)}`);
    return { id: program, uniforms: new Map() };
  }
  private location(p: Program, name: string) {
    if (!p.uniforms.has(name)) p.uniforms.set(name, this.gl.getUniformLocation(p.id, name));
    return p.uniforms.get(name)!;
  }
  private f(p: Program, name: string, value: number) { this.gl.uniform1f(this.location(p, name), value); }
  private i(p: Program, name: string, value: number) { this.gl.uniform1i(this.location(p, name), value); }
  private v(p: Program, name: string, value: readonly number[]) {
    if (value.length === 2) this.gl.uniform2fv(this.location(p, name), value);
    else this.gl.uniform3fv(this.location(p, name), value);
  }
  private volumeTexture(size: readonly number[], bytes: Uint8Array | null = null) {
    const gl = this.gl, texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, texture); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, size[0], size[1], size[2], 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
    for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axis, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }
  setVolume(density: Uint8Array, shadow?: Uint8Array) {
    const gl = this.gl;
    for (const texture of [this.densityTexture, this.shadowTexture, this.shadowScratch]) if (texture) gl.deleteTexture(texture);
    this.densityTexture = this.volumeTexture(VOLUME_SIZE, density);
    this.shadowTexture = this.volumeTexture(SHADOW_SIZE, shadow ?? new Uint8Array(SHADOW_SIZE[0] * SHADOW_SIZE[1] * SHADOW_SIZE[2]).fill(255));
    this.shadowScratch = null; this.shadowLayer = -1;
    this.shadowSun = normalize(DEFAULT_SUN);
    this.shadowDirty = !shadow || this.sunKey(this.shadowSun) !== this.sunKey(this.requestedSun);
    if (this.shadowDirty) this.previewShadow();
    this.invalidate();
  }
  private sunKey(sun: readonly number[]) { return sun.map(n => n.toFixed(5)).join(','); }
  setSun(elevation: number, azimuth: number) {
    const e = elevation * Math.PI / 180, a = azimuth * Math.PI / 180;
    this.requestedSun = [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
    this.shadowDirty = this.sunKey(this.requestedSun) !== this.sunKey(this.shadowSun);
    if (this.shadowLayer >= 0 && this.lastSunKey !== this.sunKey(this.requestedSun)) this.shadowLayer = -1;
    this.interact();
  }
  setOrbit(value: boolean) { this.orbiting = value; this.lastFrame = 0; this.interact(); }
  update(values: Partial<CloudRenderer['settings']>) {
    Object.assign(this.settings, values);
    if (values.density !== undefined) this.interact();
    else if (values.detail !== undefined || values.night !== undefined) this.invalidate();
    else this.schedule();
  }
  flash() { this.flashUntil = performance.now() + 450; this.schedule(); }
  resetCamera(tower?: boolean, bank?: boolean) {
    if (tower !== undefined || bank !== undefined) this.homeCamera = { yaw: 0.23, pitch: bank ? 0.32 : 0.10, distance: bank ? 42 : tower ? 39 : 30, target: [0, tower ? 5.6 : bank ? 1.5 : 3.1, 0] };
    this.camera = { ...this.homeCamera, target: [...this.homeCamera.target] };
    this.interact();
  }
  zoom(delta: number) { this.camera.distance = Math.min(65, Math.max(15, this.camera.distance * Math.exp(delta))); this.interact(); }
  private interact() {
    this.lastInput = performance.now(); this.sample = 0; this.phase = 'moving'; this.schedule();
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.schedule(), SETTLE_DELAY + 5);
  }
  private invalidate() { this.sample = 0; this.schedule(); }
  private schedule() {
    if (this.stopped || document.hidden || this.frameId) return;
    this.frameId = requestAnimationFrame(now => this.frame(now));
  }
  private target(width: number, height: number) {
    const gl = this.gl, texture = gl.createTexture()!, fbo = gl.createFramebuffer()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.float ? gl.RGBA16F : gl.RGBA8, width, height, 0, gl.RGBA, this.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Cloud render target is unavailable.');
    return { texture, fbo };
  }
  private resize(scale: number) {
    const rect = this.canvas.getBoundingClientRect(), [ow, oh] = outputSize(rect.width, rect.height, devicePixelRatio || 1);
    if (this.canvas.width !== ow) this.canvas.width = ow; if (this.canvas.height !== oh) this.canvas.height = oh;
    const width = Math.max(1, Math.round(ow * scale)), height = Math.max(1, Math.round(oh * scale));
    if (width === this.width && height === this.height && this.targets.length) return;
    for (const t of this.targets) { this.gl.deleteTexture(t.texture); this.gl.deleteFramebuffer(t.fbo); }
    this.width = width; this.height = height; this.targets = Array.from({ length: 3 }, () => this.target(width, height)); this.sample = 0; this.history = 0;
  }
  private bind(p: Program, name: string, unit: number, texture: WebGLTexture, volume = false) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(volume ? gl.TEXTURE_3D : gl.TEXTURE_2D, texture); this.i(p, name, unit);
  }
  private shadowSlices(texture: WebGLTexture, size: readonly number[], begin: number, count: number, sun: readonly number[]) {
    if (!this.densityTexture) return;
    const gl = this.gl, p = this.programs.shadow; gl.useProgram(p.id); gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, size[0], size[1]); this.bind(p, 'uDensity', 0, this.densityTexture, true); this.v(p, 'uSun', sun); this.v(p, 'uSize', size);
    for (let z = begin; z < Math.min(size[2], begin + count); z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texture, 0, z); this.f(p, 'uLayer', z); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  private previewShadow() {
    if (!this.densityTexture) return;
    const size = SHADOW_SIZE.map(n => n / 4), texture = this.volumeTexture(size);
    this.shadowSlices(texture, size, 0, size[2], this.requestedSun);
    if (this.shadowTexture) this.gl.deleteTexture(this.shadowTexture);
    this.shadowTexture = texture; this.shadowSun = this.requestedSun.slice(); this.shadowBuilds++;
    this.lastShadowPreview = performance.now(); this.shadowDirty = true; this.shadowLayer = -1; this.sample = 0;
  }
  private refineShadow() {
    if (!this.shadowDirty || !this.densityTexture) return false;
    if (this.shadowLayer < 0) {
      if (this.shadowScratch) this.gl.deleteTexture(this.shadowScratch);
      this.shadowScratch = this.volumeTexture(SHADOW_SIZE); this.shadowLayer = 0; this.lastSunKey = this.sunKey(this.requestedSun);
    }
    this.shadowSlices(this.shadowScratch!, SHADOW_SIZE, this.shadowLayer, 4, this.requestedSun); this.shadowLayer += 4;
    if (this.shadowLayer >= SHADOW_SIZE[2]) {
      if (this.shadowTexture) this.gl.deleteTexture(this.shadowTexture);
      this.shadowTexture = this.shadowScratch; this.shadowScratch = null; this.shadowLayer = -1;
      this.shadowSun = this.requestedSun.slice(); this.shadowDirty = false; this.shadowBuilds++; this.sample = 0;
      return false;
    }
    return true;
  }
  private cameraUniforms(p: Program) {
    const { yaw, pitch, distance, target } = this.camera;
    const offset = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const forward = offset.map(v => -v), right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const up = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch)];
    this.v(p, 'uEye', offset.map((v, a) => target[a] + v * distance)); this.v(p, 'uForward', forward); this.v(p, 'uRight', right); this.v(p, 'uUp', up);
  }
  private pollTiming(moving: boolean) {
    const gl = this.gl, ext = this.timer;
    if (!ext) return;
    while (this.queries.length && gl.getQueryParameter(this.queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = this.queries.shift()!;
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        this.gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        if (moving && ++this.timingFrames % 12 === 0) this.movingScale = feedbackScale(this.movingScale, this.gpuMs!);
      }
      gl.deleteQuery(query);
    }
  }
  private frame(now: number) {
    this.frameId = 0;
    if (this.stopped || document.hidden || !this.densityTexture) return;
    try {
      const dt = this.lastFrame ? Math.min(50, now - this.lastFrame) : 0; this.lastFrame = now;
      if (this.orbiting) { this.camera.yaw += dt * 0.00008; this.lastInput = now; this.sample = 0; }
      const moving = now - this.lastInput < SETTLE_DELAY || this.orbiting;
      const plan = renderPlan(moving, this.settings.detail);
      if (this.phase === 'moving' && !moving) this.sample = 0;
      this.phase = moving ? 'moving' : 'settling';
      this.pollTiming(moving); this.resize(moving ? this.movingScale : plan.scale);
      const gl = this.gl; gl.bindVertexArray(this.vao); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      const query = this.timer && this.queries.length < 4 ? gl.createQuery() : null;
      if (query) gl.beginQuery(this.timer!.TIME_ELAPSED_EXT, query);
      const sunChanged = this.sunKey(this.requestedSun) !== this.sunKey(this.shadowSun);
      if (sunChanged && (!moving || now - this.lastShadowPreview > 75)) this.previewShadow();
      const shadowPending = !moving && this.refineShadow();
      if (this.settings.night && this.settings.lightning && !matchMedia('(prefers-reduced-motion: reduce)').matches && now > this.nextFlash) { this.flashUntil = now + 450; this.nextFlash = now + 3500 + Math.random() * 4000; }
      const flashing = this.settings.night && now < this.flashUntil;
      if (flashing || flashing !== this.wasFlashing) this.sample = 0;
      this.wasFlashing = flashing;
      if (this.sample < plan.samples) {
        const p = this.programs.cloud; gl.useProgram(p.id); gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[0].fbo); gl.viewport(0, 0, this.width, this.height);
        this.bind(p, 'uDensity', 0, this.densityTexture, true); this.bind(p, 'uShadow', 1, this.shadowTexture!, true);
        this.cameraUniforms(p); this.v(p, 'uSize', [this.width, this.height]); this.v(p, 'uSun', this.requestedSun);
        const jitter = (index: number, base: number) => { let value = 0, f = 1 / base; while (index > 0) { value += index % base * f; index = Math.floor(index / base); f /= base; } return value - 0.5; };
        this.v(p, 'uJitter', [jitter(this.sample + 1, 2), jitter(this.sample + 1, 3)]);
        this.f(p, 'uAspect', this.canvas.width / this.canvas.height); this.f(p, 'uTanFov', Math.max(0.38, 0.4 / (this.canvas.width / this.canvas.height))); this.f(p, 'uLensShift', this.canvas.clientWidth > 760 ? 0.24 : 0); this.f(p, 'uAmount', this.settings.density); this.f(p, 'uNight', this.settings.night ? 1 : 0);
        this.f(p, 'uFlash', flashing ? Math.max(0, Math.sin((450 - (this.flashUntil - now)) * 0.04)) * (this.flashUntil - now) / 450 : 0);
        this.f(p, 'uStepJitter', moving ? 0.15 : 1); this.i(p, 'uSteps', plan.steps); this.i(p, 'uSample', this.sample); gl.drawArrays(gl.TRIANGLES, 0, 3);
        const average = this.programs.average, next = 1 - this.history; gl.useProgram(average.id); gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[next + 1].fbo);
        this.bind(average, 'uCurrent', 0, this.targets[0].texture); this.bind(average, 'uPrevious', 1, this.targets[this.history + 1].texture); this.f(average, 'uCount', this.sample);
        gl.drawArrays(gl.TRIANGLES, 0, 3); this.history = next; this.sample++; this.draws++;
        this.frameTimes.push(now); this.frameTimes = this.frameTimes.filter(t => now - t < 1000);
      }
      const present = this.programs.present; gl.useProgram(present.id); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.bind(present, 'uImage', 0, this.targets[this.history + 1].texture); this.v(present, 'uSize', [this.canvas.width, this.canvas.height]); this.v(present, 'uImageSize', [this.width, this.height]);
      this.f(present, 'uExposure', this.settings.exposure); this.f(present, 'uGlare', this.settings.glare); gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (query) { gl.endQuery(this.timer!.TIME_ELAPSED_EXT); this.queries.push(query); }
      if (!moving && !shadowPending && this.sample >= plan.samples && !flashing) this.phase = 'ready';
      const times = this.frameTimes;
      const fps = times.length > 1 ? Math.round((times.length - 1) * 1000 / Math.max(1, times[times.length - 1] - times[0])) : 0;
      this.onStats({ phase: this.phase, samples: this.sample, target: plan.samples, width: this.width, height: this.height, fps, gpuMs: this.gpuMs, shadowBuilds: this.shadowBuilds, draws: this.draws, settleMs: Number.isFinite(this.lastInput) ? now - this.lastInput : 0 });
      if (moving || this.sample < plan.samples || shadowPending || flashing) this.schedule();
      else if (this.settings.night && this.settings.lightning && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        clearTimeout(this.settleTimer); this.settleTimer = window.setTimeout(() => this.schedule(), Math.max(0, this.nextFlash - now));
      }
    } catch (error) { this.stopped = true; this.onError(error instanceof Error ? error.message : String(error)); }
  }
  private listen() {
    const signal = this.abort.signal, canvas = this.canvas;
    canvas.addEventListener('pointerdown', event => { canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId); this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); this.pinch = 0; this.interact(); }, { signal });
    canvas.addEventListener('pointermove', event => {
      const previous = this.pointers.get(event.pointerId); if (!previous) return;
      const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch && distance > 0) this.zoom(Math.log(this.pinch / distance)); this.pinch = distance;
      } else if (event.shiftKey) {
        this.camera.target[0] -= dx * this.camera.distance * 0.001; this.camera.target[1] += dy * this.camera.distance * 0.001;
      } else {
        this.camera.yaw -= dx * 0.005; this.camera.pitch = Math.min(1.2, Math.max(-0.45, this.camera.pitch + dy * 0.004));
      }
      this.interact();
    }, { signal });
    const release = (event: PointerEvent) => { this.pointers.delete(event.pointerId); this.pinch = 0; this.interact(); };
    canvas.addEventListener('pointerup', release, { signal }); canvas.addEventListener('pointercancel', release, { signal });
    canvas.addEventListener('wheel', event => { event.preventDefault(); this.zoom(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1) * 0.001); }, { passive: false, signal });
    canvas.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'r', 'R'].includes(event.key)) return;
      event.preventDefault();
      if (event.key.startsWith('Arrow')) { this.camera.yaw += event.key === 'ArrowLeft' ? -0.08 : event.key === 'ArrowRight' ? 0.08 : 0; this.camera.pitch = Math.min(1.2, Math.max(-0.45, this.camera.pitch + (event.key === 'ArrowUp' ? 0.06 : event.key === 'ArrowDown' ? -0.06 : 0))); this.interact(); }
      else if (event.key.toLowerCase() === 'r') this.resetCamera(); else this.zoom(event.key === '-' ? 0.08 : -0.08);
    }, { signal });
    document.addEventListener('visibilitychange', () => { this.lastFrame = 0; if (document.hidden) { cancelAnimationFrame(this.frameId); this.frameId = 0; clearTimeout(this.settleTimer); } else this.invalidate(); }, { signal });
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.stopped = true; cancelAnimationFrame(this.frameId); this.onError('그래픽 연결이 중단되었습니다. 다시 불러오기를 눌러주세요.'); }, { signal });
  }
  dispose() {
    this.stopped = true; cancelAnimationFrame(this.frameId); clearTimeout(this.settleTimer); this.abort.abort(); this.observer.disconnect();
    const gl = this.gl;
    for (const t of this.targets) { gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.fbo); }
    for (const t of [this.densityTexture, this.shadowTexture, this.shadowScratch]) if (t) gl.deleteTexture(t);
    for (const p of Object.values(this.programs)) gl.deleteProgram(p.id);
    for (const query of this.queries) gl.deleteQuery(query);
    gl.deleteFramebuffer(this.shadowFbo); gl.deleteVertexArray(this.vao);
  }
}
