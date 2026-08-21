import { channelX, channelY, settings } from './config';
import { clamp, hash, smoothstep } from './math';
import { BodyEchoRuntime } from './runtime';
import type { FigurePoint } from './types';

/** Draws release particles from their scheduled SVG/raster origin. */
export class ParticleRenderer {
  constructor(
    private readonly runtime: BodyEchoRuntime,
    private readonly ctx: CanvasRenderingContext2D,
  ) {}

  draw(
    point: FigurePoint,
    pointIndex: number,
    echoIndex: number,
    channelIndex: number,
    spawnTime: number,
    age: number,
    baseSize: number,
    lineMode: boolean,
  ): void {
    const { runtime, ctx } = this;
    const particleAge = runtime.isNameDropWave() ? age * settings.contactReleaseSpeed : age;
    const timelineOrigin = runtime.isNameDropWave() && runtime.releasedAt > 0
      ? runtime.releasedAt - runtime.contactReleaseTime()
      : runtime.triggeredAt;
    const originTime = timelineOrigin + spawnTime;
    const baseOrigin = lineMode
      ? runtime.linePointPosition(point, echoIndex, originTime)
      : runtime.solidPointPosition(point, echoIndex, originTime);
    const origin = runtime.isNameDropWave()
      ? lineMode
        ? runtime.gatheredLinePosition(
          point,
          pointIndex,
          echoIndex,
          originTime,
          runtime.contactReleaseTime(),
          baseOrigin,
        )
        : runtime.gatheredPosition(baseOrigin, echoIndex, runtime.contactReleaseTime())
      : baseOrigin;
    const channelSeed = hash(point.x, point.y, channelIndex + echoIndex * 3);
    const channelOffset = settings.rgbOffset * runtime.view.fit;
    let x: number;
    let y: number;

    if (runtime.isNameDropWave()) {
      const contactX = runtime.view.offsetX + runtime.contactOrigin.x * runtime.view.fit;
      const contactY = runtime.view.offsetY + runtime.contactOrigin.y * runtime.view.fit;
      let directionX = origin.x - contactX;
      let directionY = origin.y - contactY;
      const distance = Math.hypot(directionX, directionY);
      if (distance < 0.001) {
        const angle = point.seed * Math.PI * 2;
        directionX = Math.cos(angle);
        directionY = Math.sin(angle);
      } else {
        directionX /= distance;
        directionY /= distance;
      }

      const tangentX = -directionY;
      const tangentY = directionX;
      if (runtime.isPreviousContactRelease()) {
        const radialSpeed = settings.contactForce * (0.64 + channelSeed * 0.72)
          * runtime.view.fit;
        const tangentSpeed = (point.seed2 - 0.5) * settings.contactSpread * runtime.view.fit;
        const initialBloom = (1 - Math.exp(-particleAge * 13)) * radialSpeed * 0.13;
        const outwardTravel = radialSpeed * particleAge * 0.48;
        const acceleration = particleAge * particleAge * (3.2 + point.seed * 3.4)
          * runtime.view.fit;
        const turbulence = Math.sin(
          particleAge * (4.1 + point.seed * 4.6) + point.seed2 * 19,
        ) * settings.turbulence * particleAge * runtime.view.fit;
        x = origin.x + channelX[channelIndex] * channelOffset
          + directionX * (initialBloom + outwardTravel + acceleration)
          + tangentX * (tangentSpeed * particleAge + turbulence * 0.18);
        y = origin.y + channelY[channelIndex] * channelOffset
          + directionY * (initialBloom + outwardTravel + acceleration)
          + tangentY * (tangentSpeed * particleAge + turbulence * 0.18);
      } else {
        const diffusionLife = Math.max(0.05, settings.contactDiffusionDuration);
        const diffusion = smoothstep(particleAge / diffusionLife);
        const release = smoothstep((particleAge - 0.08) / (diffusionLife * 0.82));
        const maximumTravel = settings.contactForce * (0.68 + channelSeed * 0.46)
          * runtime.view.fit;
        const sidewaysTravel = (point.seed2 - 0.5) * settings.contactSpread
          * Math.sin(diffusion * Math.PI) * runtime.view.fit;
        const turbulence = Math.sin(
          diffusion * (5.2 + point.seed * 2.8) + point.seed2 * 19,
        ) * settings.turbulence * Math.sin(diffusion * Math.PI) * runtime.view.fit;
        x = origin.x + channelX[channelIndex] * channelOffset
          + directionX * maximumTravel * release
          + tangentX * (sidewaysTravel + turbulence * 0.22);
        y = origin.y + channelY[channelIndex] * channelOffset
          + directionY * maximumTravel * release
          + tangentY * (sidewaysTravel + turbulence * 0.22);
      }
    } else {
      const speed = settings.drift * (0.58 + channelSeed * 0.82) * runtime.view.fit;
      const verticalSpeed = (point.seed2 - 0.5) * settings.spread * runtime.view.fit;
      const noise = Math.sin(particleAge * (3.2 + point.seed * 4.8) + point.seed2 * 18)
        * settings.turbulence * particleAge * runtime.view.fit;
      x = origin.x + channelX[channelIndex] * channelOffset
        + speed * particleAge + particleAge * particleAge * 1.65 * runtime.view.fit;
      y = origin.y + channelY[channelIndex] * channelOffset + verticalSpeed * particleAge + noise;
    }

    const densityParticle = runtime.isNameDropWave() && !runtime.isPreviousContactRelease();
    const life = densityParticle
      ? settings.contactParticleFadeDuration * (0.82 + point.seed * 0.32)
      : settings.particleLife * (0.72 + point.seed * 0.48);
    const fadeAge = densityParticle ? age : particleAge;
    const fadeProgress = clamp(1 - fadeAge / life, 0, 1);
    const alpha = Math.pow(fadeProgress, densityParticle ? 1.65 : 1.3)
      * (densityParticle ? 0.44 + point.seed * 0.46 : 0.48 + point.seed * 0.52);
    const size = baseSize * (0.7 + channelSeed * 0.85) * settings.particleSize
      * (runtime.isNameDropWave() ? settings.contactParticleSize : 1);
    const minimumSize = runtime.isNameDropWave() ? 0.3 : 0.65;
    if (
      alpha <= 0.01 || x < -8 || x > runtime.view.width + 8
      || y < -8 || y > runtime.view.height + 8
    ) return;

    ctx.globalAlpha = alpha;
    if (densityParticle) {
      const pixelSize = Math.max(minimumSize, size * 1.05);
      ctx.fillRect(x - pixelSize * 0.5, y - pixelSize * 0.5, pixelSize, pixelSize);
    } else {
      ctx.fillRect(
        x,
        y,
        Math.max(minimumSize, size),
        Math.max(minimumSize, size * (0.72 + point.seed2 * 0.55)),
      );
    }
  }
}
