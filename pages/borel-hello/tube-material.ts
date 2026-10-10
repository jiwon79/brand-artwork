import { Color, ShaderMaterial } from 'three';

/** A camera-relative studio surface: broad panel reflections over a cool
 * volume, with a soft Fresnel rim. Shared by solid and rainbow tubes/caps/dots.
 * The reflection field is analytic; no Spline runtime or texture is embedded. */
export class TubeMaterial extends ShaderMaterial {
  readonly color: Color;

  constructor(vertexColors = false) {
    const color = new Color(0xffffff);
    super({
      vertexColors,
      uniforms: { baseColor: { value: color } },
      vertexShader: `
        varying vec3 surfaceNormal;
        varying vec3 surfaceColor;
        uniform vec3 baseColor;
        void main() {
          surfaceNormal = normalize(normalMatrix * normal);
          surfaceColor = baseColor;
          #ifdef USE_COLOR
            surfaceColor *= color;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 surfaceNormal;
        varying vec3 surfaceColor;
        vec3 overlay(vec3 base, vec3 layer) {
          return mix(2.0 * base * layer, 1.0 - 2.0 * (1.0 - base) * (1.0 - layer), step(vec3(0.5), base));
        }
        float panel(vec2 p, vec2 center, vec2 size, float softness) {
          vec2 d = abs(p - center) - size;
          return 1.0 - smoothstep(-softness, softness, max(d.x, d.y));
        }
        void main() {
          vec3 n = normalize(surfaceNormal);
          vec2 uv = n.xy * 0.495 + 0.5;
          float facing = clamp(n.z, 0.0, 1.0);
          // Work in display color for the layered illustration-style finish.
          vec3 base = sRGBTransferOETF(vec4(surfaceColor, 1.0)).rgb;
          float pearl = clamp(-0.1 + 0.35 * pow(max(1.0 - facing, 0.001), -0.17), 0.0, 1.0);
          base = mix(base, vec3(1.0), pearl * 0.2);
          float volume = clamp(0.48 + n.y * 0.36 - n.x * 0.24, 0.0, 1.0);
          vec3 cool = mix(vec3(0.07, 0.12, 0.42), vec3(0.58, 0.91, 1.0), volume);
          base = mix(base, overlay(base, cool), 0.4);
          float edge = 0.1 + pow(1.0 - facing, 2.0);
          base = mix(base, overlay(base, vec3(0.307)), clamp(edge, 0.0, 1.0) * 0.46);
          float key = panel(uv, vec2(0.28, 0.69), vec2(0.065, 0.15), 0.065);
          float fill = exp(-dot((uv - vec2(0.72, 0.67)) / vec2(0.26, 0.34), (uv - vec2(0.72, 0.67)) / vec2(0.26, 0.34)));
          float bounce = exp(-dot((uv - vec2(0.42, 0.16)) / vec2(0.36, 0.16), (uv - vec2(0.42, 0.16)) / vec2(0.36, 0.16)));
          vec3 reflection = vec3(clamp(0.08 + key * 0.92 + fill * 0.36 + bounce * 0.18, 0.0, 1.0));
          base = mix(base, overlay(base, reflection), 0.29);
          float peak = max(base.r, max(base.g, base.b));
          base = clamp(mix(vec3(peak), base, 1.28), 0.0, 1.0);
          // A broad soft highlight retains hue, without bloom or sharp clearcoat.
          base = mix(base, vec3(1.0), key * 0.3);
          gl_FragColor = vec4(mix(pow((base + 0.055) / 1.055, vec3(2.4)), base / 12.92, vec3(lessThanEqual(base, vec3(0.04045)))), 1.0);
          #include <colorspace_fragment>
        }
      `,
      toneMapped: false,
    });
    this.color = color;
  }
}
