import {
  GLYPH_ATLAS_CELL_SIZE,
  GLYPH_ATLAS_COLUMNS,
  GLYPH_ATLAS_ROWS,
  GLYPH_SLOT_COUNT,
  LINE_COUNT,
  LIQUID_PARTICLE_COUNT,
  METABALL_SAMPLES,
  METABALL_SMOOTH_TAPS,
  SOLVER_LINK_COUNT,
} from './config';

/** Fullscreen quad와 각 GPU pass가 사용하는 GLSL 모음.
 *
 * CPU의 실행 순서는 script.ts의 renderFrame()에 있고, 이 파일은 각 pass가
 * 픽셀 하나를 어떻게 계산하는지만 담는다.
 */

export const fullScreenVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// 1. 글자별 spring texture를 읽어 이동·회전된 고해상도 글자 mask를 만든다.
export const deformedGlyphFragmentShader = `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uSource;
    uniform sampler2D uGlyphSprings;
    uniform sampler2D uGlyphMetadata;
    uniform vec2 uArtSize;
    uniform vec4 uLineLayouts[${LINE_COUNT}];
    uniform float uCharacterAdvance;
    uniform float uLineHalfHeight;
    uniform float uMaxGlyphHalfWidth;

    vec2 rotateVector(vec2 value, float angle) {
      float cosine = cos(angle);
      float sine = sin(angle);
      return vec2(
        value.x * cosine - value.y * sine,
        value.x * sine + value.y * cosine
      );
    }

    void main() {
      float deformedMask = 0.0;
      float outputX = vUv.x * uArtSize.x;

      for (int lineIndex = 0; lineIndex < ${LINE_COUNT}; lineIndex += 1) {
        vec4 lineLayout = uLineLayouts[lineIndex];
        float nearestCharacter = floor(
          (outputX - lineLayout.x) / uCharacterAdvance + 0.5
        );

        // A moving or rotating W can extend well beyond its nominal tracking
        // cell. Inspect the nearest cell and both neighbours, then crop each
        // candidate by its measured glyph width instead of a universal width.
        for (int neighbourOffset = -1; neighbourOffset <= 1; neighbourOffset += 1) {
          float characterPosition = nearestCharacter + float(neighbourOffset);
          float validCharacter = step(0.0, characterPosition)
            * step(characterPosition, lineLayout.z - 1.0);
          float safeCharacter = clamp(
            characterPosition,
            0.0,
            lineLayout.z - 1.0
          );
          float glyphSlot = lineLayout.w + safeCharacter;
          vec2 glyphLookup = vec2(
            (glyphSlot + 0.5) / ${GLYPH_SLOT_COUNT}.0,
            0.5
          );
          vec4 glyphMetadata = texture2D(uGlyphMetadata, glyphLookup);
          validCharacter *= step(0.5, glyphMetadata.g);

          vec4 springState = texture2D(uGlyphSprings, glyphLookup);
          vec2 originalCenter = vec2(
            (lineLayout.x + safeCharacter * uCharacterAdvance) / uArtSize.x,
            lineLayout.y
          );
          vec2 movedCenter = originalCenter
            - vec2(0.0, springState.r / uArtSize.y);
          vec2 outputDelta = (vUv - movedCenter) * uArtSize;
          vec2 sourceDelta = rotateVector(outputDelta, -springState.b);
          float atlasColumn = mod(glyphSlot, ${GLYPH_ATLAS_COLUMNS}.0);
          float atlasRow = floor(glyphSlot / ${GLYPH_ATLAS_COLUMNS}.0);
          vec2 atlasCenterUv = vec2(
            (atlasColumn + 0.5) / ${GLYPH_ATLAS_COLUMNS}.0,
            1.0 - (atlasRow + 0.5) / ${GLYPH_ATLAS_ROWS}.0
          );
          vec2 sourceUv = atlasCenterUv + sourceDelta / vec2(
            ${(GLYPH_ATLAS_COLUMNS * GLYPH_ATLAS_CELL_SIZE).toFixed(1)},
            ${(GLYPH_ATLAS_ROWS * GLYPH_ATLAS_CELL_SIZE).toFixed(1)}
          );
          float glyphHalfWidth = max(
            glyphMetadata.r * uMaxGlyphHalfWidth,
            uCharacterAdvance * 0.5
          );

          float horizontalGate = 1.0 - smoothstep(
            glyphHalfWidth - 0.75,
            glyphHalfWidth + 0.75,
            abs(sourceDelta.x)
          );
          float verticalGate = 1.0 - smoothstep(
            uLineHalfHeight - 0.75,
            uLineHalfHeight + 0.75,
            abs(sourceDelta.y)
          );
          float sourceMask = texture2D(
            uSource,
            clamp(sourceUv, vec2(0.0), vec2(1.0))
          ).a;
          deformedMask = max(
            deformedMask,
            sourceMask * validCharacter * horizontalGate * verticalGate
          );
        }
      }

      gl_FragColor = vec4(deformedMask);
    }
`;

// 2. 현재 글자 픽셀과 물 packet을 activation/text/color/falloff 채널로 묶는다.
export const interactionFieldFragmentShader = `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uText;
    uniform vec2 uArtSize;
    uniform vec2 uDripOrigins[${LIQUID_PARTICLE_COUNT}];
    uniform float uDripAges[${LIQUID_PARTICLE_COUNT}];
    uniform float uDripMasses[${LIQUID_PARTICLE_COUNT}];
    uniform float uDripEnergies[${LIQUID_PARTICLE_COUNT}];
    uniform float uDripGrowth[${LIQUID_PARTICLE_COUNT}];
    uniform float uDripSeeds[${LIQUID_PARTICLE_COUNT}];
    uniform float uDripParticleBlend;
    uniform float uDripStretch;
    uniform float uDripTurbulence;
    uniform float uDripFlutter;
    uniform float uDripStrength;
    uniform float uDripPinchTime;
    uniform float uDripStreamWidth;
    uniform float uDripAttack;
    uniform vec2 uLightRadius;
    uniform float uLightRadiusYBelow;
    uniform float uLightFalloff;
    uniform float uLightTaperAbove;
    uniform float uLightTaperBelow;
    uniform float uLightTaperStart;
    uniform float uLightTaperEnd;
    uniform float uTime;

    float liquidParticleFalloff(
      vec2 outputUv,
      float particleAge,
      vec2 particleOrigin,
      float particleMass,
      float particleEnergy,
      float particleGrowth,
      float particleSeed
    ) {
      if (particleMass <= 0.0 || particleEnergy <= 0.0) return 0.0;

      vec2 falloffDelta = (outputUv - particleOrigin) * uArtSize;
      float localX = falloffDelta.x;
      float formation = smoothstep(
        uDripPinchTime * 0.12,
        max(uDripPinchTime, 0.16),
        particleAge
      );
      float flutter = clamp(uDripFlutter, 0.0, 1.5);
      float seedPhase = particleSeed * 6.28318530718;
      float lateralWarp = (
        sin(falloffDelta.y * 0.028 + seedPhase + uTime * 0.18)
        - sin(seedPhase + uTime * 0.18)
      ) * 3.2 * uDripTurbulence * formation;
      falloffDelta.x -= lateralWarp;

      // Source packets fill continuously from zero mass. Keeping a non-zero
      // radius floor would still pop a small Falloff into existence.
      float massScale = sqrt(max(particleMass, 0.0));
      float verticalStretch = 1.0 + min(
        particleAge * uDripStretch * 0.38,
        0.78
      );
      float verticalRadius = falloffDelta.y < 0.0
        ? uLightRadiusYBelow
        : uLightRadius.y;
      verticalRadius *= verticalStretch * massScale;
      float verticalRatio = abs(falloffDelta.y) / max(verticalRadius, 0.001);
      float taperFloor = falloffDelta.y < 0.0
        ? uLightTaperBelow
        : uLightTaperAbove;
      float horizontalTaper = mix(
        1.0,
        taperFloor,
        smoothstep(uLightTaperStart, uLightTaperEnd, verticalRatio)
      );

      float travelingNeck = 0.89 + 0.11 * flutter
        * sin(particleAge * 2.1 - uTime * 0.7 + seedPhase + localX * 0.015);
      float streamWidth = mix(
        1.0,
        uDripStreamWidth * travelingNeck,
        formation
      );
      vec2 effectiveRadius = vec2(
        uLightRadius.x * horizontalTaper * streamWidth * massScale,
        verticalRadius
      );
      float normalizedDistance = length(
        falloffDelta / max(effectiveRadius, vec2(0.001))
      );
      float flowedLight = 1.0 - smoothstep(
        uLightFalloff,
        1.0,
        normalizedDistance
      );
      flowedLight *= smoothstep(1.04, 0.84, normalizedDistance);
      float birthEnergy = 1.0 - exp(
        -particleAge / max(uDripAttack, 0.001)
      );
      float birthFade = mix(
        1.0,
        birthEnergy * birthEnergy,
        clamp(particleGrowth, 0.0, 1.0)
      );
      float flowMaturity = smoothstep(
        uDripPinchTime - 0.16,
        uDripPinchTime + 0.72,
        particleAge
      );
      float densityOscillation = max(
        1.0
          + flutter
          * sin(falloffDelta.y * 0.071 + localX * 0.043 + seedPhase - uTime * 0.7),
        0.0
      );
      float densityPulse = 1.0 - flowMaturity * uDripTurbulence * 0.08
        * densityOscillation;
      return flowedLight
        * birthFade
        * densityPulse
        * max(particleEnergy, 0.0);
    }

    void main() {
      float strongestLight = 0.0;
      float secondLight = 0.0;
      for (int sampleIndex = 0; sampleIndex < ${LIQUID_PARTICLE_COUNT}; sampleIndex += 1) {
        float particleLight = liquidParticleFalloff(
          vUv,
          uDripAges[sampleIndex],
          uDripOrigins[sampleIndex],
          uDripMasses[sampleIndex],
          uDripEnergies[sampleIndex],
          uDripGrowth[sampleIndex],
          uDripSeeds[sampleIndex]
        );
        if (particleLight > strongestLight) {
          secondLight = strongestLight;
          strongestLight = particleLight;
        } else {
          secondLight = max(secondLight, particleLight);
        }
      }
      // This smooth union is monotonic across neighboring liquid particles:
      // overlap can gently add volume, but can never lower either contributor.
      float unionWidth = max(uDripParticleBlend, 0.001);
      float unionAmount = max(
        unionWidth - abs(strongestLight - secondLight),
        0.0
      ) / unionWidth;
      float streamLight = strongestLight
        + unionAmount * unionAmount * unionWidth * 0.25;

      float textMask = texture2D(uText, vUv).a;
      float surfaceActivation = textMask
        * pow(max(streamLight, 0.0), 1.22)
        * uDripStrength;

      gl_FragColor = vec4(
        surfaceActivation,
        textMask,
        0.0,
        streamLight
      );
    }
`;

// 3. seed가 글자 획 안에서 끊기지 않도록 한 픽셀씩 이웃으로 확장한다.
export const strokeSpreadFragmentShader = `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uInput;
    uniform vec2 uTexel;

    void main() {
      vec4 center = texture2D(uInput, vUv);
      float textMask = center.g;
      if (textMask < 0.02) {
        gl_FragColor = vec4(0.0, textMask, 0.0, 1.0);
        return;
      }

      vec2 stepOffset = uTexel * 2.0;
      float spread = center.r;
      spread = max(spread, texture2D(uInput, vUv + vec2(stepOffset.x, 0.0)).r * 0.96);
      spread = max(spread, texture2D(uInput, vUv - vec2(stepOffset.x, 0.0)).r * 0.96);
      spread = max(spread, texture2D(uInput, vUv + vec2(0.0, stepOffset.y)).r * 0.96);
      spread = max(spread, texture2D(uInput, vUv - vec2(0.0, stepOffset.y)).r * 0.96);
      spread = max(spread, texture2D(uInput, vUv + stepOffset).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv - stepOffset).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + vec2(stepOffset.x, -stepOffset.y)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + vec2(-stepOffset.x, stepOffset.y)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(2.0, 1.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(2.0, -1.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(-2.0, 1.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(-2.0, -1.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(1.0, 2.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(-1.0, 2.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(1.0, -2.0)).r * 0.955);
      spread = max(spread, texture2D(uInput, vUv + uTexel * vec2(-1.0, -2.0)).r * 0.955);

      gl_FragColor = vec4(spread, textMask, 0.0, 1.0);
    }
`;

// 4-a. 활성 픽셀은 자기 UV를 seed 좌표로 저장한다.
export const nearestSeedFragmentShader = `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uActivation;
    uniform float uSeedThreshold;

    void main() {
      vec2 field = texture2D(uActivation, vUv).rg;
      float valid = step(uSeedThreshold, field.r) * step(0.18, field.g);
      gl_FragColor = valid > 0.5
        ? vec4(vUv, field.r, 1.0)
        : vec4(0.0);
    }
`;

// 4-b. 큰 간격부터 작은 간격까지 가까운 seed 좌표를 전달한다.
export const jumpFloodFragmentShader = `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uNearest;
    uniform vec2 uFieldSize;
    uniform float uJump;

    void main() {
      vec4 best = texture2D(uNearest, vUv);
      float bestDistance = best.a > 0.5
        ? dot((best.xy - vUv) * uFieldSize, (best.xy - vUv) * uFieldSize)
        : 1.0e20;

      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 sampleUv = vUv + vec2(float(x), float(y)) * uJump / uFieldSize;
          if (sampleUv.x >= 0.0 && sampleUv.x <= 1.0 && sampleUv.y >= 0.0 && sampleUv.y <= 1.0) {
            vec4 candidate = texture2D(uNearest, sampleUv);
            vec2 delta = (candidate.xy - vUv) * uFieldSize;
            float candidateDistance = dot(delta, delta);
            if (candidate.a > 0.5 && candidateDistance < bestDistance) {
              best = candidate;
              bestDistance = candidateDistance;
            }
          }
        }
      }

      gl_FragColor = best;
    }
`;

// 5-a. interaction field에서 metaball 입력으로 쓸 글자 픽셀만 고른다.
export const surfaceSourceFragmentShader = `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uActivation;
    uniform float uInputThreshold;
    uniform float uInputSoftness;

    void main() {
      vec2 activation = texture2D(uActivation, vUv).rg;
      float detected = smoothstep(
        uInputThreshold,
        uInputThreshold + uInputSoftness,
        activation.r
      );
      // The touch-drip stage is already zero outside the text mask.
      float sourceAlpha = activation.r * detected;
      gl_FragColor = vec4(sourceAlpha, activation.g, 0.0, 1.0);
    }
`;

// 5-b. 출력 픽셀 주변의 활성 픽셀 192개를 누적해 연속 field를 만든다.
export const surfaceBlurFragmentShader = `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uInput;
    uniform vec2 uArtSize;
    uniform float uBlurRadius;
    uniform float uFalloffPower;
    uniform float uSourceGain;
    uniform float uFieldGain;

    void main() {
      const float goldenAngle = 2.39996323;
      float sourceAlpha = texture2D(uInput, vUv).r;
      float weightedField = sourceAlpha;
      float totalWeight = 1.0;

      for (int index = 0; index < ${METABALL_SAMPLES}; index++) {
        float sampleRatio = (float(index) + 0.5) / float(${METABALL_SAMPLES});
        float radiusRatio = sqrt(sampleRatio);
        float angle = float(index) * goldenAngle;
        float sampleRadius = radiusRatio * uBlurRadius;
        vec2 offsetPixels = vec2(cos(angle), sin(angle)) * sampleRadius;
        vec2 sampleUv = vUv + offsetPixels / uArtSize;
        float radialWeight = pow(max(1.0 - radiusRatio, 0.0), uFalloffPower);
        weightedField += texture2D(uInput, sampleUv).r * radialWeight;
        totalWeight += radialWeight;
      }

      float metaballField = sourceAlpha * uSourceGain
        + weightedField / max(totalWeight, 0.001) * uFieldGain;
      gl_FragColor = vec4(metaballField, 0.0, 0.0, 1.0);
    }
`;

// 5-c. 누적 field를 가로·세로로 한 번씩 부드럽게 만든다.
export const surfaceSmoothFragmentShader = `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uInput;
    uniform vec2 uDirection;
    uniform float uSigma;

    void main() {
      float sigmaSquared = max(uSigma * uSigma, 0.001);
      float totalWeight = 0.0;
      float smoothedField = 0.0;

      for (int index = -${METABALL_SMOOTH_TAPS}; index <= ${METABALL_SMOOTH_TAPS}; index++) {
        float distancePixels = float(index);
        float weight = exp(-0.5 * distancePixels * distancePixels / sigmaSquared);
        smoothedField += texture2D(
          uInput,
          vUv + uDirection * distancePixels
        ).r * weight;
        totalWeight += weight;
      }

      gl_FragColor = vec4(smoothedField / max(totalWeight, 0.001), 0.0, 0.0, 1.0);
    }
`;

// 6. 액체와 닿은 글자별 하강·회전 spring의 다음 상태를 계산한다.
export const glyphSpringFragmentShader = `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uPrevious;
    uniform sampler2D uSurfaceField;
    uniform sampler2D uText;
    uniform vec4 uGlyphCells[${GLYPH_SLOT_COUNT}];
    uniform vec2 uArtSize;
    uniform float uDelta;
    uniform float uSurfaceThreshold;
    uniform float uSurfaceSoftness;
    uniform float uMaxDistance;
    uniform float uStiffness;
    uniform float uDamping;
    uniform float uMaxRotation;
    uniform float uRotationStiffness;
    uniform float uRotationDamping;
    uniform float uQaMode;

    float contactAt(vec2 uv) {
      vec2 safeUv = clamp(uv, vec2(0.0), vec2(1.0));
      float surfaceField = texture2D(
        uSurfaceField,
        safeUv
      ).r;
      float textMask = texture2D(uText, safeUv).a;
      float visibleSurface = smoothstep(
        uSurfaceThreshold,
        uSurfaceThreshold + max(uSurfaceSoftness, 0.002),
        surfaceField
      );
      float visibleInk = smoothstep(0.08, 0.32, textMask);
      return visibleSurface * visibleInk;
    }

    vec2 rotateVector(vec2 value, float angle) {
      float cosine = cos(angle);
      float sine = sin(angle);
      return vec2(
        value.x * cosine - value.y * sine,
        value.x * sine + value.y * cosine
      );
    }

    void main() {
      float slotIndex = floor(vUv.x * ${GLYPH_SLOT_COUNT}.0);
      vec4 cell = vec4(0.0);
      for (int index = 0; index < ${GLYPH_SLOT_COUNT}; index += 1) {
        float selected = 1.0 - step(
          0.5,
          abs(slotIndex - float(index))
        );
        cell += uGlyphCells[index] * selected;
      }

      vec4 previous = texture2D(uPrevious, vUv);
      float offset = previous.r;
      float velocity = previous.g;
      float angle = previous.b;
      float angularVelocity = previous.a;
      float glyphPresent = step(0.00001, cell.z);
      vec2 halfSize = cell.zw;
      vec2 center = cell.xy - vec2(0.0, offset / uArtSize.y);
      float contact = 0.0;
      float leftContact = 0.0;
      float rightContact = 0.0;

      for (int gridY = 0; gridY < 9; gridY += 1) {
        for (int gridX = 0; gridX < 9; gridX += 1) {
          vec2 gridPosition = vec2(
            float(gridX) / 8.0 * 2.0 - 1.0,
            float(gridY) / 8.0 * 2.0 - 1.0
          ) * 0.92;
          vec2 localSample = gridPosition * halfSize;
          vec2 sampleUv = center + rotateVector(localSample, angle);
          float sampleContact = contactAt(sampleUv) * glyphPresent;
          contact = max(contact, sampleContact);
          if (gridX < 4) {
            leftContact = max(leftContact, sampleContact);
          }
          if (gridX > 4) {
            rightContact = max(rightContact, sampleContact);
          }
        }
      }

      float sideContact = max(leftContact, rightContact);
      float pressureDifference = clamp(
        (leftContact - rightContact) / max(sideContact, 0.001),
        -1.0,
        1.0
      );
      float targetAngle = pressureDifference * sideContact * uMaxRotation;

      if (uQaMode > 0.5) {
        offset = contact * uMaxDistance;
        velocity = 0.0;
        angle = targetAngle;
        angularVelocity = 0.0;
      } else {
        float timeStep = min(max(uDelta, 0.0), 1.0 / 30.0);
        float targetOffset = contact * uMaxDistance;
        float acceleration = (targetOffset - offset) * uStiffness
          - velocity * uDamping;
        velocity += acceleration * timeStep;
        offset += velocity * timeStep;
        float angularAcceleration = (targetAngle - angle) * uRotationStiffness
          - angularVelocity * uRotationDamping;
        angularVelocity += angularAcceleration * timeStep;
        angle += angularVelocity * timeStep;

        float minimumOffset = -uMaxDistance * 0.14;
        float maximumOffset = uMaxDistance * 1.16;
        if (offset < minimumOffset) {
          offset = minimumOffset;
          velocity = max(velocity, 0.0);
        }
        if (offset > maximumOffset) {
          offset = maximumOffset;
          velocity = min(velocity, 0.0);
        }
        float maximumAngle = uMaxRotation * 1.18;
        if (angle < -maximumAngle) {
          angle = -maximumAngle;
          angularVelocity = max(angularVelocity, 0.0);
        }
        if (angle > maximumAngle) {
          angle = maximumAngle;
          angularVelocity = min(angularVelocity, 0.0);
        }
      }

      gl_FragColor = vec4(offset, velocity, angle, angularVelocity);
    }
`;

// 9. surface, nearest seed, palette를 합쳐 최종 작품 색을 만든다.
export const finalFragmentShader = `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uText;
    uniform sampler2D uNearest;
    uniform sampler2D uSurfaceField;
    uniform vec2 uResolution;
    uniform vec2 uPosterOffset;
    uniform vec2 uPosterSize;
    uniform vec2 uArtSize;
    uniform float uSurfaceThreshold;
    uniform float uSurfaceSoftness;
    uniform float uSeedThreshold;
    uniform float uHueBands;
    uniform float uColorSaturation;
    uniform float uColorBrightness;
    uniform float uColorPastelMix;
    uniform float uColorGlyphShapeStrength;
    uniform float uColorGlyphShapeRadius;
    uniform float uColorGlyphShapeEdge;
    uniform float uTime;
    uniform float uColorCycle;
    uniform float uLabelMode;

    vec3 hsvToRgb(vec3 hsv) {
      vec3 rgb = clamp(abs(mod(hsv.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      rgb = rgb * rgb * (3.0 - 2.0 * rgb);
      return hsv.z * mix(vec3(1.0), rgb, hsv.y);
    }

    float interleavedGradientNoise(vec2 pixel) {
      return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      vec2 fragment = vUv * uResolution;
      vec2 artUv = (fragment - uPosterOffset) / uPosterSize;
      vec3 background = vec3(0.9843, 0.9843, 0.9804);

      if (
        artUv.x <= 0.001 || artUv.x >= 0.999
        || artUv.y <= 0.001 || artUv.y >= 0.999
      ) {
        gl_FragColor = vec4(background, 1.0);
        return;
      }

      vec4 nearest = texture2D(uNearest, artUv);
      float surfaceField = texture2D(uSurfaceField, artUv).r;
      float surfaceEdge = max(uSurfaceSoftness, fwidth(surfaceField) * 1.2);
      float coverage = smoothstep(
        uSurfaceThreshold - surfaceEdge,
        uSurfaceThreshold + surfaceEdge,
        surfaceField
      );
      float distanceToStroke = 16.0;
      float activeStrokeStrength = 0.0;

      if (nearest.a > 0.5) {
        distanceToStroke = length((artUv - nearest.xy) * uArtSize);
        activeStrokeStrength = smoothstep(
          uSeedThreshold,
          uSeedThreshold + 0.10,
          nearest.z
        );
      }

      float textMask = texture2D(uText, artUv).a;

      if (uLabelMode > 0.5) {
        // Match the first visibly chromatic pixel, not only the 50% alpha core.
        float effectLabel = step(0.001, coverage);
        float textLabel = step(0.22, textMask) * (1.0 - effectLabel);
        vec3 semanticLabel = mix(vec3(1.0), vec3(0.5), textLabel);
        semanticLabel = mix(semanticLabel, vec3(0.0), effectLabel);
        gl_FragColor = vec4(semanticLabel, 1.0);
        return;
      }

      float visibleText = textMask * 0.92 * (1.0 - coverage);
      vec3 base = mix(background, vec3(0.155, 0.153, 0.148), visibleText);

      float cycle = max(uColorCycle, 0.1);
      float palettePhase = fract(0.84 + uTime / cycle);
      float glyphRadius = max(uColorGlyphShapeRadius, 0.1);
      float glyphEdge = min(
        max(uColorGlyphShapeEdge, 0.05),
        glyphRadius * 0.9
      );
      float glyphShapeEnergy = (
        1.0 - smoothstep(
          glyphRadius - glyphEdge,
          glyphRadius + glyphEdge,
          distanceToStroke
        )
      ) * activeStrokeStrength;
      float contourEnergy = glyphShapeEnergy * uColorGlyphShapeStrength;
      float saturation = clamp(uColorSaturation, 0.0, 1.4);
      float brightness = clamp(uColorBrightness, 0.5, 1.1);
      vec3 edgeRose = hsvToRgb(vec3(
        fract(palettePhase + 0.095),
        0.80 * saturation,
        0.76 * brightness
      ));
      vec3 bodyRose = hsvToRgb(vec3(
        fract(palettePhase + 0.105),
        0.62 * saturation,
        0.96 * brightness
      ));
      vec3 pinkMist = hsvToRgb(vec3(
        fract(palettePhase + 0.115),
        0.22 * saturation,
        min(1.0, brightness)
      ));
      vec3 hotColor = hsvToRgb(vec3(
        fract(palettePhase + uHueBands),
        0.86 * saturation,
        min(1.0, brightness)
      ));
      float bodyBlend = smoothstep(0.0, 0.48, contourEnergy);
      float mistBlend = smoothstep(0.16, 0.78, contourEnergy);
      float hotBlend = smoothstep(0.48, 0.98, contourEnergy);
      vec3 goo = mix(edgeRose, bodyRose, bodyBlend);
      goo = mix(goo, pinkMist, mistBlend);
      goo = mix(goo, hotColor, hotBlend);
      float pastelAmount = clamp(uColorPastelMix, 0.0, 0.5)
        * mix(0.65, 1.0, hotBlend);
      goo = mix(goo, vec3(1.0, 0.955, 0.935), pastelAmount);

      vec3 result = mix(base, goo, coverage);
      float dither = (interleavedGradientNoise(fragment) - 0.5) / 255.0;
      result += vec3(dither * coverage * 0.3);

      gl_FragColor = vec4(result, 1.0);
    }
`;

// Process View: 같은 중간 texture를 solver/contact/contour 방식으로 보여준다.
export const debugFragmentShader = `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uText;
    uniform sampler2D uInteraction;
    uniform sampler2D uSurfaceSource;
    uniform sampler2D uSurfaceField;
    uniform vec2 uResolution;
    uniform vec2 uPosterOffset;
    uniform vec2 uPosterSize;
    uniform float uSurfaceThreshold;
    uniform float uSurfaceSoftness;
    uniform float uMode;
    uniform vec2 uArtSize;
    uniform vec4 uSolverParticles[${LIQUID_PARTICLE_COUNT}];
    uniform vec2 uSolverVelocityEnds[${LIQUID_PARTICLE_COUNT}];
    uniform vec4 uSolverLinks[${SOLVER_LINK_COUNT}];
    uniform float uSolverLinkStrengths[${SOLVER_LINK_COUNT}];
    uniform vec2 uSourceOrigin;
    uniform float uSourceActive;
    uniform vec2 uSolverRadius;
    uniform float uSolverRadiusBelow;
    uniform float uSolverStretch;
    uniform float uSolverPinchTime;
    uniform float uSolverStreamWidth;

    float segmentDistance(vec2 point, vec2 start, vec2 end) {
      vec2 segment = end - start;
      float lengthSquared = max(dot(segment, segment), 0.0001);
      float progress = clamp(dot(point - start, segment) / lengthSquared, 0.0, 1.0);
      return length(point - (start + segment * progress));
    }

    float lineMask(float distanceToLine, float thickness) {
      float antialias = max(fwidth(distanceToLine) * 0.9, 0.28);
      return 1.0 - smoothstep(
        max(thickness - antialias, 0.0),
        thickness + antialias,
        distanceToLine
      );
    }

    float isoLine(float value, float level, float width) {
      float antialias = max(fwidth(value) * 0.9, width * 0.18);
      return 1.0 - smoothstep(
        max(width - antialias, 0.0),
        width + antialias,
        abs(value - level)
      );
    }

    float smoothCoverage(float value, float threshold) {
      float antialias = max(fwidth(value) * 0.8, 0.012);
      return smoothstep(
        threshold - antialias,
        threshold + antialias,
        value
      );
    }

    float repeatingIsoLine(float value, float bands) {
      float scaledValue = value * bands;
      float distanceToBand = abs(fract(scaledValue) - 0.5);
      float antialias = max(fwidth(scaledValue) * 0.72, 0.007);
      return 1.0 - smoothstep(
        antialias,
        antialias * 2.05,
        distanceToBand
      );
    }

    void main() {
      vec2 fragment = vUv * uResolution;
      vec2 artUv = (fragment - uPosterOffset) / uPosterSize;
      vec3 background = vec3(0.9843, 0.9843, 0.9804);

      if (
        artUv.x <= 0.001 || artUv.x >= 0.999
        || artUv.y <= 0.001 || artUv.y >= 0.999
      ) {
        gl_FragColor = vec4(background, 1.0);
        return;
      }

      vec4 interaction = texture2D(uInteraction, artUv);
      float textMask = texture2D(uText, artUv).a;
      float rawFalloff = interaction.a;
      float activePixels = interaction.r;
      float detectedPixels = texture2D(uSurfaceSource, artUv).r;
      float surfaceField = texture2D(uSurfaceField, artUv).r;
      vec3 charcoal = vec3(0.15, 0.145, 0.14);
      vec3 cobalt = vec3(0.10, 0.25, 0.62);
      vec3 cyan = vec3(0.30, 0.76, 0.91);
      vec3 result = background;

      if (uMode < 0.5) {
        float influence = smoothstep(0.002, 0.12, rawFalloff);
        vec3 cool = vec3(0.22, 0.55, 0.92);
        vec3 warm = vec3(0.90, 0.48, 0.88);
        vec3 influenceColor = mix(cool, warm, smoothstep(0.18, 0.9, rawFalloff));
        result = mix(result, charcoal, textMask * 0.13);
        result = mix(
          result,
          influenceColor,
          influence * (0.24 + rawFalloff * 0.62)
        );
        float contour = repeatingIsoLine(rawFalloff, 4.0);
        result = mix(result, vec3(0.08, 0.13, 0.34), contour * influence * 0.78);
      } else if (uMode < 1.5) {
        // CONTACT: the exact text pixels accepted by the touch Falloff.
        float activation = smoothstep(0.001, 0.28, activePixels);
        float acceptedCoverage = smoothstep(0.01, 0.12, detectedPixels);
        float contactEnergy = pow(max(rawFalloff, 0.0), 1.22);
        float highResolutionInk = smoothCoverage(textMask, 0.20);
        float contactGate = smoothCoverage(contactEnergy, 0.022);
        float contactCoverage = highResolutionInk * contactGate;
        float acceptedEnergy = max(activation, acceptedCoverage);
        vec3 contactColor = mix(
          vec3(0.16, 0.40, 0.68),
          vec3(0.32, 0.72, 0.86),
          smoothstep(0.06, 0.78, acceptedEnergy)
        );
        result = mix(result, charcoal, textMask * 0.14);
        result = mix(
          result,
          contactColor,
          contactCoverage * (0.86 + acceptedEnergy * 0.12)
        );

        float falloffInfluence = smoothstep(0.002, 0.12, rawFalloff);
        float falloffContour = repeatingIsoLine(rawFalloff, 4.0);
        result = mix(
          result,
          vec3(0.24, 0.43, 0.68),
          falloffContour * falloffInfluence * 0.28
        );
      } else if (uMode < 2.5) {
        // SOLVER: source, packet envelopes, cohesion graph, and velocities.
        vec2 artPixel = artUv * uArtSize;
        float rawVolume = smoothstep(0.003, 0.24, rawFalloff);
        result = mix(result, charcoal, textMask * 0.055);
        result = mix(result, vec3(0.80, 0.91, 0.98), rawVolume * 0.16);

        float linkHalo = 0.0;
        float linkInk = 0.0;
        for (int linkIndex = 0; linkIndex < ${SOLVER_LINK_COUNT}; linkIndex += 1) {
          vec4 link = uSolverLinks[linkIndex];
          float strength = uSolverLinkStrengths[linkIndex];
          vec2 linkStart = link.xy * uArtSize;
          vec2 linkEnd = link.zw * uArtSize;
          float linkDistance = segmentDistance(artPixel, linkStart, linkEnd);
          linkHalo = max(linkHalo, lineMask(linkDistance, 1.55) * strength);
          linkInk = max(linkInk, lineMask(linkDistance, 0.68) * strength);
        }
        result = mix(result, vec3(0.58, 0.83, 0.90), linkHalo * 0.17);
        result = mix(result, vec3(0.15, 0.50, 0.62), linkInk * 0.58);

        float packetFill = 0.0;
        float packetHalo = 0.0;
        float packetRing = 0.0;
        float centerInk = 0.0;
        float velocityInk = 0.0;
        float velocityHead = 0.0;
        for (int particleIndex = 0; particleIndex < ${LIQUID_PARTICLE_COUNT}; particleIndex += 1) {
          vec4 particle = uSolverParticles[particleIndex];
          float particleMass = particle.z;
          if (particleMass <= 0.0001) continue;

          vec2 particleOrigin = particle.xy;
          float particleAge = particle.w;
          vec2 delta = (artUv - particleOrigin) * uArtSize;
          float massScale = sqrt(max(particleMass, 0.0));
          float maturity = smoothstep(
            uSolverPinchTime * 0.12,
            max(uSolverPinchTime, 0.16),
            particleAge
          );
          float verticalStretch = 1.0 + min(
            particleAge * uSolverStretch * 0.38,
            0.78
          );
          float horizontalRadius = uSolverRadius.x
            * mix(1.0, uSolverStreamWidth, maturity)
            * massScale
            * 0.34;
          float verticalRadius = (delta.y < 0.0
            ? uSolverRadiusBelow
            : uSolverRadius.y)
            * verticalStretch
            * massScale
            * 0.34;
          float packetDistance = length(
            delta / max(vec2(horizontalRadius, verticalRadius), vec2(0.001))
          );
          float packetAntialias = max(fwidth(packetDistance) * 0.82, 0.0035);
          float packetWidth = max(fwidth(packetDistance) * 1.38, 0.007);
          packetFill = max(
            packetFill,
            (1.0 - smoothstep(
              1.0 - packetAntialias,
              1.0 + packetAntialias,
              packetDistance
            )) * 0.20
          );
          packetHalo = max(
            packetHalo,
            1.0 - smoothstep(
              packetWidth * 2.2,
              packetWidth * 2.2 + packetAntialias * 1.4,
              abs(packetDistance - 1.0)
            )
          );
          packetRing = max(
            packetRing,
            1.0 - smoothstep(
              max(packetWidth - packetAntialias, 0.0),
              packetWidth + packetAntialias,
              abs(packetDistance - 1.0)
            )
          );

          vec2 center = particleOrigin * uArtSize;
          centerInk = max(centerInk, 1.0 - smoothstep(2.2, 3.8, length(artPixel - center)));
          vec2 velocityEnd = uSolverVelocityEnds[particleIndex] * uArtSize;
          velocityInk = max(
            velocityInk,
            lineMask(segmentDistance(artPixel, center, velocityEnd), 0.82)
          );
          velocityHead = max(
            velocityHead,
            1.0 - smoothstep(2.0, 3.5, length(artPixel - velocityEnd))
          );
        }
        result = mix(result, vec3(0.73, 0.88, 0.94), packetFill);
        result = mix(result, vec3(0.66, 0.80, 0.91), packetHalo * 0.13);
        result = mix(result, vec3(0.15, 0.33, 0.58), packetRing * 0.58);
        result = mix(result, vec3(0.10, 0.48, 0.43), velocityInk * 0.70);
        result = mix(result, vec3(0.06, 0.34, 0.32), velocityHead * 0.88);
        result = mix(result, vec3(0.07, 0.16, 0.29), centerInk * 0.92);

        vec2 sourceDelta = (artUv - uSourceOrigin) * uArtSize;
        float sourceDistance = length(sourceDelta);
        float sourceRing = isoLine(sourceDistance, 7.0, 1.0)
          + isoLine(sourceDistance, 12.0, 1.0);
        float sourceCross = lineMask(abs(sourceDelta.x), 0.65)
          * (1.0 - smoothstep(8.0, 14.0, abs(sourceDelta.y)));
        sourceCross += lineMask(abs(sourceDelta.y), 0.65)
          * (1.0 - smoothstep(8.0, 14.0, abs(sourceDelta.x)));
        result = mix(
          result,
          vec3(0.03, 0.09, 0.24),
          clamp(sourceRing + sourceCross, 0.0, 1.0) * uSourceActive
        );
      } else {
        // CONTOUR: final geometry without color, one step before FINAL.
        float fieldWidth = max(fwidth(surfaceField) * 1.4, uSurfaceSoftness * 0.24);
        float thresholdContour = isoLine(
          surfaceField,
          uSurfaceThreshold,
          max(fieldWidth, uSurfaceSoftness * 0.55)
        );
        float contourHalo = isoLine(
          surfaceField,
          uSurfaceThreshold,
          max(fieldWidth * 2.8, uSurfaceSoftness * 1.15)
        );
        result = mix(result, charcoal, textMask * 0.88);
        result = mix(result, vec3(0.56, 0.72, 0.86), contourHalo * 0.24);
        result = mix(result, vec3(0.04, 0.10, 0.27), thresholdContour * 0.96);
      }

      gl_FragColor = vec4(result, 1.0);
    }
  `;
