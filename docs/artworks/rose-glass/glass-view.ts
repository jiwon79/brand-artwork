import { fragmentSource, resolveSource, vertexSource } from '../../../pages/rose-glass/shader';
import { GlassBodyMotion } from '../../../pages/rose-glass/interaction';
import { maxDeformationFields, type Point } from '../../../pages/rose-glass/deformation';

export function scenePoint(x: number, y: number, width: number, height: number): Point {
  const scale = Math.min(width / 590, height / 1280);
  return { x: (x - width / 2) / scale + 295, y: (y - height / 2) / scale + 640 };
}

/** A small host for the artwork's actual material and resolve shaders. */
export class GlassView {
  readonly canvas = document.createElement('canvas');
  private readonly gl: WebGL2RenderingContext;
  private readonly material: WebGLProgram;
  private readonly resolve: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly framebuffer: WebGLFramebuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private readonly fields = new Float32Array(maxDeformationFields * 4);
  private readonly meta = new Float32Array(maxDeformationFields * 2);
  stage = 6;
  debugMode = 0;
  debugEffects = 7;
  previewZoom = 1;
  absorptionWidth = 1;
  light = 0.65;
  overlap = false;

  constructor(host: HTMLElement, label: string, materialSource = fragmentSource) {
    this.canvas.setAttribute('role', 'img'); this.canvas.setAttribute('aria-label', label);
    const gl = this.canvas.getContext('webgl2', { alpha: false, depth: false, antialias: false });
    if (!gl) throw new Error('WebGL 2를 사용할 수 없습니다.');
    this.gl = gl;
    this.material = this.program(materialSource);
    this.resolve = this.program(resolveSource);
    this.texture = gl.createTexture()!; this.framebuffer = gl.createFramebuffer()!; this.vao = gl.createVertexArray()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, key, gl.LINEAR);
    for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, key, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    host.append(this.canvas);
  }

  private program(source: string) {
    const gl = this.gl, program = gl.createProgram()!;
    for (const [type, code] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, source]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, code); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? '셰이더 오류');
      gl.attachShader(program, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? '렌더러 오류');
    return program;
  }

  draw(motion: GlassBodyMotion) {
    const gl = this.gl, width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(devicePixelRatio, 1.5);
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('재질 버퍼를 만들 수 없습니다.');
    }
    const location = (program: WebGLProgram, key: string) => {
      const cacheKey = `${program === this.material ? 'm' : 'r'}:${key}`;
      if (!this.uniforms.has(cacheKey)) this.uniforms.set(cacheKey, gl.getUniformLocation(program, key));
      return this.uniforms.get(cacheKey)!;
    };
    const float = (key: string, value: number) => gl.uniform1f(location(this.material, key), value);
    const flag = (key: string, value: boolean) => gl.uniform1i(location(this.material, key), Number(value));
    gl.bindVertexArray(this.vao); gl.viewport(0, 0, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.useProgram(this.material);
    gl.uniform2f(location(this.material, 'uResolution'), w, h);
    gl.uniform2f(location(this.material, 'uView'), width, height);
    gl.uniform2fv(location(this.material, 'uOffsets[0]'), [0, 0, 0, 0, motion.x, motion.y]);
    gl.uniform1fv(location(this.material, 'uRotations[0]'), [0, 0, motion.angle]);
    const fields = motion.deformationFields;
    fields.forEach((field, i) => {
      this.fields.set([field.center.x, field.center.y, field.displacement.x, field.displacement.y], i * 4);
      const radius = 210 + 0.25 * Math.hypot(field.displacement.x, field.displacement.y);
      this.meta.set([field.indentation, 1 / (radius * radius)], i * 2);
    });
    gl.uniform2iv(location(this.material, 'uDeformationRanges[0]'), [0, 0, 0, 0, 0, fields.length]);
    gl.uniform4fv(location(this.material, 'uDeformationFields[0]'), this.fields);
    gl.uniform2fv(location(this.material, 'uDeformationMeta[0]'), this.meta);
    gl.uniform2f(location(this.material, 'uLight'), 50 + this.light * 600, 360);
    gl.uniform1i(location(this.material, 'uDocMode'), this.debugMode);
    gl.uniform1i(location(this.material, 'uDocEffects'), this.debugEffects);
    float('uDocZoom', this.previewZoom);
    flag('uUpperGlass', this.overlap); flag('uLowerGlass', this.overlap); flag('uForegroundGlass', true);
    flag('uShading', this.stage >= 2); flag('uShadows', this.stage >= 2);
    flag('uEdgeOptics', this.stage >= 3); flag('uLighting', this.stage >= 4);
    float('uGrain', this.stage >= 5 ? 1.25 : 0);
    for (const [key, value] of Object.entries({ uWarmth: 0, uSpecular: 1.1, uRim: 1.25, uLightIntensity: 1.85,
      uForegroundAbsorption: 1, uRearAbsorption: 1, uAbsorptionWidth: this.absorptionWidth, uSaturation: 1.1,
      uRearBlur: 1, uEdgeRoll: 1, uShadowStrength: 1, uShadowSpread: 1 })) float(key, value);
    gl.uniform1i(location(this.material, 'uColorway'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(this.resolve);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(location(this.resolve, 'uMaterialTexture'), 0);
    gl.uniform2f(location(this.resolve, 'uResolution'), w, h);
    gl.uniform2f(location(this.resolve, 'uOutputResolution'), w, h);
    gl.uniform1f(location(this.resolve, 'uReferenceScale'), Math.min(width / 590, height / 1280) * w / width);
    gl.uniform1f(location(this.resolve, 'uDiffusion'), this.stage >= 6 ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
