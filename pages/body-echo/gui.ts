import GUI from 'lil-gui';
import { DEFAULT_WAVE_SPEED, defaultTiming, settings } from './config';

export type TuningGui = {
  toggle: () => void;
};

export function createTuningGui(): TuningGui {
  const gui = new GUI({ title: 'Body Echo' });
  const tuning = {
    pullSpeed: 1,
    waveSpeed: DEFAULT_WAVE_SPEED,
  };

  const pullFolder = gui.addFolder('Pull');
  pullFolder.add(settings, 'contactRopePull', 8, 100, 1).name('Amount');
  pullFolder.add(settings, 'contactRopeReach', 16, 160, 1).name('Reach');
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
  releaseFolder.add(settings, 'contactReleaseSpeed', 0.05, 3, 0.05).name('Particle speed');
  releaseFolder.add(settings, 'contactForce', 4, 80, 1).name('Particle spread');
  releaseFolder
    .add(settings, 'contactParticleFadeDuration', 0.1, 5, 0.05)
    .name('Particle fade time');
  releaseFolder.add(settings, 'contactParticleSize', 0.2, 2.5, 0.05).name('Particle size');
  releaseFolder.add(settings, 'rgbOffset', 0, 10, 0.1).name('Chromatic amount');
  gui.close();

  let visible = new URLSearchParams(window.location.search).get('debug') === '1';
  if (!visible) gui.hide();

  return {
    toggle: () => {
      visible = !visible;
      if (visible) gui.show();
      else gui.hide();
    },
  };
}
