import GUI from 'lil-gui';
import type { ShaderMaterial } from 'three';
import type { ColorTextParameters } from '../config';

type ParameterGuiOptions = {
  state: ColorTextParameters;
  surfaceSourceMaterial: ShaderMaterial;
  surfaceBlurMaterial: ShaderMaterial;
  surfaceSmoothMaterial: ShaderMaterial;
  colorBlurMaterial: ShaderMaterial;
  nearestSeedMaterial: ShaderMaterial;
  finalMaterial: ShaderMaterial;
  rebakeColorAtlas: () => void;
};

/**
 * 제작 중 수치를 조절하는 lil-gui 전용 모듈.
 * 작품의 실행 흐름과 무관하므로 script.ts의 렌더 파이프라인에서 분리한다.
 */
export function bindParameterGui(options: ParameterGuiOptions): void {
  const {
    state,
    surfaceSourceMaterial,
    surfaceBlurMaterial,
    surfaceSmoothMaterial,
    colorBlurMaterial,
    nearestSeedMaterial,
    finalMaterial,
    rebakeColorAtlas,
  } = options;
  const gui = new GUI({ title: 'Color Text controls', width: 320 });

  const interactionFolder = gui.addFolder('터치 드립');
  interactionFolder.add(state, 'dripGravity', 20, 150, 1).name('드립 중력');
  interactionFolder.add(state, 'dripStretch', 0, 1.2, 0.01).name('영역 세로 신장');
  interactionFolder.add(state, 'dripTurbulence', 0, 1.5, 0.01).name('흐름 속도 차이');
  interactionFolder.add(state, 'dripFlutter', 0, 1.5, 0.01).name('하단 잔물결 양');
  interactionFolder.add(state, 'dripStrength', 0, 1.4, 0.01).name('Metaball 입력량');
  interactionFolder.add(state, 'dripPinchTime', 0.4, 3, 0.05).name('흐름 형성 시간');
  interactionFolder.add(state, 'dripStreamWidth', 0.18, 1, 0.01).name('흐르는 영역 폭');
  interactionFolder.add(state, 'dripAttack', 0.05, 0.6, 0.01).name('터치 시작 시간');
  interactionFolder.add(state, 'dripInitialSpeed', 0, 80, 1).name('초기 낙하 속도');
  interactionFolder.add(state, 'dripViscosity', 0, 2.5, 0.05).name('점성 감쇠');
  interactionFolder.add(state, 'dripCohesion', 0, 3, 0.05).name('입자 응집력');
  interactionFolder.add(state, 'dripCohesionRange', 24, 180, 1).name('응집 거리');
  interactionFolder.add(state, 'dripParticleBlend', 0.005, 0.25, 0.005)
    .name('입자 표면 결합');
  interactionFolder.add(state, 'dripFollowEase', 3, 30, 0.5).name('source 추종 속도');
  interactionFolder.add(state, 'dripEmissionInterval', 0.04, 0.35, 0.01)
    .name('source 교대 시간');

  const textMotionFolder = gui.addFolder('텍스트 밀림');
  textMotionFolder.add(state, 'textPushDistance', 0, 24, 0.5).name('최대 하강 거리');
  textMotionFolder.add(state, 'textSpringStiffness', 10, 120, 1).name('스프링 강성');
  textMotionFolder.add(state, 'textSpringDamping', 2, 30, 0.5).name('스프링 감쇠');
  textMotionFolder.add(state, 'textContactPadding', 0, 12, 0.5).name('접촉 감지 여유');
  textMotionFolder.add(state, 'textMaxRotation', 0, 20, 0.5).name('최대 회전 각도');
  textMotionFolder.add(state, 'textRotationStiffness', 10, 120, 1)
    .name('회전 스프링 강성');
  textMotionFolder.add(state, 'textRotationDamping', 2, 30, 0.5)
    .name('회전 스프링 감쇠');

  const lightFolder = gui.addFolder('광원 / Falloff');
  lightFolder.add(state, 'radiusX', 40, 260, 1).name('가로 반경');
  lightFolder.add(state, 'radiusY', 40, 260, 1).name('위쪽 반경');
  lightFolder.add(state, 'radiusYBelow', 40, 320, 1).name('아래쪽 반경');
  lightFolder.add(state, 'lightFalloff', 0.02, 0.95, 0.01).name('Falloff 시작');
  lightFolder.add(state, 'taperAbove', 0.15, 1, 0.01).name('위쪽 폭 비율');
  lightFolder.add(state, 'taperBelow', 0.15, 1, 0.01).name('아래쪽 폭 비율');
  lightFolder.add(state, 'taperStart', 0, 0.8, 0.01).name('폭 축소 시작');
  lightFolder.add(state, 'taperEnd', 0.2, 1, 0.01).name('폭 축소 끝');

  const surfaceFolder = gui.addFolder('액체 실루엣');
  surfaceFolder.add(state, 'metaballInputThreshold', 0, 0.12, 0.0025)
    .name('입력 임계값')
    .onChange((value: number) => {
      surfaceSourceMaterial.uniforms.uInputThreshold.value = value;
    });
  surfaceFolder.add(state, 'metaballInputSoftness', 0.005, 0.12, 0.0025)
    .name('입력 부드러움')
    .onChange((value: number) => {
      surfaceSourceMaterial.uniforms.uInputSoftness.value = value;
    });
  surfaceFolder.add(state, 'metaballBlurRadius', 4, 60, 0.5)
    .name('주변 조사 반경')
    .onChange((value: number) => {
      surfaceBlurMaterial.uniforms.uBlurRadius.value = value;
    });
  surfaceFolder.add(state, 'metaballFalloffPower', 0.5, 8, 0.1)
    .name('거리 감쇠 지수')
    .onChange((value: number) => {
      surfaceBlurMaterial.uniforms.uFalloffPower.value = value;
    });
  surfaceFolder.add(state, 'metaballSourceGain', 0, 2, 0.02)
    .name('중심 픽셀 비율')
    .onChange((value: number) => {
      surfaceBlurMaterial.uniforms.uSourceGain.value = value;
    });
  surfaceFolder.add(state, 'metaballFieldGain', 0.5, 4, 0.05)
    .name('주변 field 비율')
    .onChange((value: number) => {
      surfaceBlurMaterial.uniforms.uFieldGain.value = value;
    });
  surfaceFolder.add(state, 'metaballSmoothing', 0.5, 4, 0.1)
    .name('Field smoothing')
    .onChange((value: number) => {
      surfaceSmoothMaterial.uniforms.uSigma.value = value;
    });
  surfaceFolder.add(state, 'surfaceThreshold', 0.01, 0.3, 0.0025)
    .name('실루엣 임계값')
    .onChange((value: number) => {
      finalMaterial.uniforms.uSurfaceThreshold.value = value;
    });
  surfaceFolder.add(state, 'surfaceSoftness', 0.002, 0.08, 0.002)
    .name('경계 부드러움')
    .onChange((value: number) => {
      finalMaterial.uniforms.uSurfaceSoftness.value = value;
    });

  const colorFolder = gui.addFolder('색상');
  const rebake = (): void => rebakeColorAtlas();
  colorFolder.add(state, 'colorCenterRadiusX', 3, 20, 0.5)
    .name('기준 타원 가로 반경')
    .onChange(rebake);
  colorFolder.add(state, 'colorCenterRadiusY', 6, 28, 0.5)
    .name('기준 타원 세로 반경')
    .onChange(rebake);
  colorFolder.add(state, 'colorCenterVariation', 0, 1, 0.01)
    .name('글자별 크기 차이')
    .onChange(rebake);
  colorFolder.add(state, 'colorGlyphInfluence', 0, 0.6, 0.01).name('글자 픽셀 변형');
  colorFolder.add(state, 'colorEllipseInfluence', 0, 1, 0.01)
    .name('타원 중심 혼합')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorEllipseInfluence.value = value;
    });
  colorFolder.add(state, 'colorGlyphShapeStrength', 0, 1, 0.01)
    .name('글자형 중심 강도')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorGlyphShapeStrength.value = value;
    });
  colorFolder.add(state, 'colorGlyphShapeRadius', 1, 10, 0.1)
    .name('글자형 중심 두께')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorGlyphShapeRadius.value = value;
    });
  colorFolder.add(state, 'colorGlyphShapeEdge', 0.1, 3, 0.05)
    .name('글자형 경계 부드러움')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorGlyphShapeEdge.value = value;
    });
  colorFolder.add(state, 'colorBlurSigma', 0.5, 16, 0.1).name('중심 타원 가로 blur');
  colorFolder.add(state, 'colorBlurAspect', 0.2, 3, 0.01).name('중심 타원 세로 비율');
  colorFolder.add(state, 'colorBlurStep', 0.5, 2, 0.05)
    .name('색 blur 간격')
    .onChange((value: number) => {
      colorBlurMaterial.uniforms.uStep.value = value;
    });
  colorFolder.add(state, 'colorFloor', 0, 0.3, 0.005)
    .name('색 에너지 시작')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorFloor.value = value;
    });
  colorFolder.add(state, 'colorRange', 0.1, 1, 0.01)
    .name('색 에너지 범위')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorRange.value = value;
    });
  colorFolder.add(state, 'hueBands', 0.1, 0.8, 0.01)
    .name('고온 색상 간격')
    .onChange((value: number) => {
      finalMaterial.uniforms.uHueBands.value = value;
    });
  colorFolder.add(state, 'colorSaturation', 0, 1.2, 0.01)
    .name('전체 채도')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorSaturation.value = value;
    });
  colorFolder.add(state, 'colorBrightness', 0.7, 1.05, 0.01)
    .name('전체 밝기')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorBrightness.value = value;
    });
  colorFolder.add(state, 'colorPastelMix', 0, 0.35, 0.01)
    .name('파스텔 혼합')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorPastelMix.value = value;
    });
  colorFolder.add(state, 'colorCycle', 2, 20, 0.1)
    .name('색 순환 시간')
    .onChange((value: number) => {
      finalMaterial.uniforms.uColorCycle.value = value;
    });

  const advancedFolder = gui.addFolder('고급 설정');
  advancedFolder.add(state, 'seedThreshold', 0.01, 0.30, 0.005)
    .name('Seed 임계값')
    .onChange((value: number) => {
      nearestSeedMaterial.uniforms.uSeedThreshold.value = value;
      finalMaterial.uniforms.uSeedThreshold.value = value;
    });
  advancedFolder.add(state, 'coreRadius', 0.1, 8, 0.1)
    .name('Core 반경')
    .onChange((value: number) => {
      finalMaterial.uniforms.uCoreRadius.value = value;
    });
  advancedFolder.add(state, 'coreRadiusMin', 0.1, 5, 0.1)
    .name('Core 최소 반경')
    .onChange((value: number) => {
      finalMaterial.uniforms.uCoreRadiusMin.value = value;
    });
  advancedFolder.add(state, 'coreRadiusExponent', 0.1, 1.5, 0.05)
    .name('Core 강도 지수')
    .onChange((value: number) => {
      finalMaterial.uniforms.uCoreRadiusExponent.value = value;
    });
  advancedFolder.add(state, 'coreMix', 0, 1, 0.01)
    .name('Core 혼합')
    .onChange((value: number) => {
      finalMaterial.uniforms.uCoreMix.value = value;
    });

  lightFolder.close();
  textMotionFolder.close();
  surfaceFolder.close();
  colorFolder.close();
  advancedFolder.close();
  gui.hide();

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key.toLowerCase() === 'g') {
      gui.show(gui.domElement.style.display === 'none');
    }
  });
}
