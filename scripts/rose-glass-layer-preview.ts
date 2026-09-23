const canvas = document.querySelector<HTMLCanvasElement>('#art')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: false });
if (!gl) throw new Error('WebGL2 unavailable');

const vertex = `#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); gl_Position=vec4(p*2.-1.,0.,1.); }`;
const fragment = `#version 300 es
precision highp float;
uniform sampler2D uBase,uUpper,uLower,uForeground;
uniform vec2 uSize;
out vec4 frag;
void main(){
  vec2 uv=vec2(gl_FragCoord.x/uSize.x,1.-gl_FragCoord.y/uSize.y);
  vec3 color=texture(uBase,uv).rgb;
  color+=2.*texture(uUpper,uv).rgb-1.;
  color+=2.*texture(uLower,uv).rgb-1.;
  color+=2.*texture(uForeground,uv).rgb-1.;
  frag=vec4(clamp(color,0.,1.),1.);
}`;
function shader(type: number, source: string): WebGLShader {
  const next = gl!.createShader(type)!;
  gl!.shaderSource(next, source);
  gl!.compileShader(next);
  if (!gl!.getShaderParameter(next, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(next) ?? 'Shader compile error');
  return next;
}
const program = gl.createProgram()!;
gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Link error');
const files = ['rose-glass-plate-base.png','rose-glass-delta-upper.png','rose-glass-delta-lower.png','rose-glass-delta-foreground.png'];
const uniforms = ['uBase','uUpper','uLower','uForeground'];
Promise.all(files.map(async (file, index) => {
  const image = new Image();
  image.src = `/kits/rose-glass/assets/${file}`;
  await image.decode();
  const texture = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + index);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
  return index;
})).then(() => {
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());
  uniforms.forEach((name, index) => gl.uniform1i(gl.getUniformLocation(program, name), index));
  gl.uniform2f(gl.getUniformLocation(program, 'uSize'), canvas.width, canvas.height);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const error = gl.getError();
  status.value = error === gl.NO_ERROR ? 'WebGL decoder ready' : `WebGL error ${error}`;
  save.disabled = error !== gl.NO_ERROR;
}).catch(cause => { status.value = String(cause); });
save.addEventListener('click', () => canvas.toBlob(blob => {
  if (!blob) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'rose-glass-decoded-1080x1920.png';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}, 'image/png'));
