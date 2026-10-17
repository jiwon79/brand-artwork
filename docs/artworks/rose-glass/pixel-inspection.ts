import { foregroundGlassShape, glassBodyWidthAt } from '../../../pages/rose-glass/deformation';
import { reliefSample } from './relief-demo';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The foreground shader's undeformed measurements, in reference artwork units. */
export function inspectPixel(u: number, v: number, absorptionWidth = 1) {
  const { exponent: n, height, shear } = foregroundGlassShape;
  const { field, normal } = reliefSample(u, v);
  const gx = n * Math.sign(u) * Math.abs(u) ** (n - 1);
  const gy = n * Math.sign(v) * Math.abs(v) ** (n - 1);
  const width = glassBodyWidthAt(2, v);
  const t = Math.max(0, Math.min(1, (v + .1) / .4));
  const widthSlope = -foregroundGlassShape.width * (.11 + .0325 * 6 * t * (1 - t) / .4);
  const gradientX = gx / width;
  const gradientY = gy / height + gx * (-shear - u * widthSlope / height) / width;
  const distance = (1 - field) / Math.max(Math.hypot(gradientX, gradientY), .0001);
  const leftSide = 1 - smooth(-.92, -.22, u), rightSide = smooth(.22, .92, u);
  const base = smooth(.25, .96, v), shoulder = Math.exp(-(((v + .12) / .9) ** 2));
  const opticalWidth = (14 + 45 * leftSide * shoulder + 55 * rightSide + 20 * base) * absorptionWidth;
  const density = .22 + .45 * leftSide * shoulder + .45 * rightSide + .18 * base;
  const inside = Math.max(distance, 0);
  const opticalDepth = density * (.78 * Math.exp(-((inside / opticalWidth) ** 1.45)) + .22 * Math.exp(-((inside / (opticalWidth * 1.8)) ** 2)));
  return { field, distance, normal, opticalWidth,
    patch: Math.exp(-2 * (((u - .3) / 1.4) ** 2 + ((v + .51) / 1.1) ** 2)),
    band: Math.exp(-(((v + .075 - u * .27) / .19) ** 2)) * (.62 + .38 * smooth(-.8, .6, u)),
    left: Math.max(0, -normal.x) ** 2, right: Math.max(0, normal.x) ** 2,
    transmission: [.44, .48, .46].map(extinction => Math.exp(-extinction * opticalDepth)),
  };
}

/** Insert diagnostics into the actual shader; the artwork's source stays unchanged. */
export function inspectionShader(source: string, kind: 'shading' | 'edge') {
  const marker = kind === 'shading' ? '  if (!uShading)' : '  vec3 litSurface =';
  if (!source.includes(marker)) throw new Error('설명용 셰이더 삽입 위치를 찾을 수 없습니다.');
  const diagnostics = kind === 'shading' ? `
  if (uDocMode == 1) return mix(under,vec3(bell(q,vec2(.30,-.51),vec2(1.40,1.10))),mask);
  if (uDocMode == 2) {
    float b = q.y+.075-q.x*.27;
    float band = exp(-pow(b/.19,2.0))*(.62+.38*smoothstep(-.8,.6,q.x));
    return mix(under,vec3(band),mask);
  }
  if (uDocMode == 3) return mix(under,vec3(left+right),mask);
  if (uDocMode == 4) return mix(under,color,mask);
  if (uDocMode == 5) return mix(under,vec3(.945,.559,.550),mask);
` : `
  if (uDocMode == 1) return mix(under,vec3(clamp(inside/120.0,0.0,1.0)),mask);
  if (uDocMode == 2) return mix(under,transmission,mask);
`;
  return source.replace('uniform bool uShading;', 'uniform bool uShading;\nuniform int uDocMode;').replace(marker, diagnostics + marker);
}
