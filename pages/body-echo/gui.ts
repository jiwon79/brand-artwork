import GUI from 'lil-gui';
import { isDebugMode } from '../../common/debug';
import { DEFAULT_PULL_SPEED, DEFAULT_WAVE_SPEED, defaultTiming, settings } from './config';

export type TuningGui = {
  toggle: () => void;
};

export function createTuningGui(): TuningGui {
  if (!isDebugMode()) return { toggle: () => {} };

  const gui = new GUI({ title: 'Body Echo' });
  const tuning = {
    pullSpeed: DEFAULT_PULL_SPEED,
    waveSpeed: DEFAULT_WAVE_SPEED,
  };

  const pullFolder = gui.addFolder('Pull');
  pullFolder.add(settings, 'contactRopePull', 8, 200, 1).name('Amount');
  pullFolder.add(settings, 'contactRopeReach', 16, 320, 1).name('Reach');
  pullFolder.add(settings, 'contactPullEasing', -1, 1, 0.05).name('Easing');
  pullFolder
    .add(tuning, 'pullSpeed', 0.4, 2.5, 0.05)
    .name('Speed')
    .onChange((speed: number) => {
      settings.contactGatherDuration = defaultTiming.gatherDuration / speed;
      settings.contactDensityDuration = defaultTiming.densityDuration / speed;
    });

  const releaseFolder = gui.addFolder('Release');
  releaseFolder
    .add(tuning, 'waveSpeed', 0.25, 3, 0.05)
    .name('Wave speed')
    .onChange((speed: number) => {
      settings.contactWaveDuration = defaultTiming.waveDuration / speed;
    });
  releaseFolder.add(settings, 'contactWaveBrightness', 0, 1, 0.01).name('Wave brightness');
  releaseFolder.add(settings, 'contactWaveBandWidth', 4, 160, 1).name('Wave width');
  releaseFolder.add(settings, 'contactReleaseSpeed', 0.05, 3, 0.05).name('Particle speed');
  releaseFolder.add(settings, 'contactForce', 4, 80, 1).name('Particle spread');
  releaseFolder
    .add(settings, 'contactParticleFadeDuration', 0.1, 5, 0.05)
    .name('Particle fade time');
  releaseFolder.add(settings, 'contactParticleSize', 0.2, 2.5, 0.05).name('Particle size');
  releaseFolder.add(settings, 'rgbOffset', 0, 10, 0.1).name('Chromatic amount');
  releaseFolder.add(settings, 'rgbOffsetStep', -10, 10, 0.1).name('Chromatic step');
  gui.close();

  let visible = true;

  return {
    toggle: () => {
      visible = !visible;
      if (visible) gui.show();
      else gui.hide();
    },
  };
}
