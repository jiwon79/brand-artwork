export const reelStages = [
  '00 clear',
  '01 source',
  '02 source strokes',
  '03 refraction',
  '04 chromatic',
  '05 inner shade',
  '06 glass milk',
  '07 top wash',
  '08 rim',
  '09 hard / CA rim',
  '10 specular',
  '11 final',
] as const;

export type ReelStage = typeof reelStages[number];
export type ReelStep = ReelStage | 'custom';
export type DebugView = 'final' | 'contact field' | 'surface normals' | 'spec mask';

type LayerToggleKey =
  | 'showSourceLayer'
  | 'showCircleStrokeLayer'
  | 'showRefractionLayer'
  | 'showChromaticLayer'
  | 'showInnerShadeLayer'
  | 'showGlassMilkLayer'
  | 'showTopWashLayer'
  | 'showRimLayer'
  | 'showHardRimLayer'
  | 'showCaRimLayer'
  | 'showSpecLayer'
  | 'showOuterStrokeLayer'
  | 'showShadowLayer';

export const presentationControls = {
  reelStep: '11 final' as ReelStep,
  debugView: 'final' as DebugView,
  showContactDebug: false,
  showSourceLayer: true,
  showCircleStrokeLayer: true,
  showRefractionLayer: true,
  showChromaticLayer: true,
  showInnerShadeLayer: true,
  showGlassMilkLayer: true,
  showTopWashLayer: true,
  showRimLayer: true,
  showHardRimLayer: true,
  showCaRimLayer: true,
  showSpecLayer: true,
  showOuterStrokeLayer: true,
  showShadowLayer: true,
};

export type PresentationControls = typeof presentationControls;

const layerGroups: Array<{
  title: string;
  layers: Array<{ key: LayerToggleKey; label: string }>;
}> = [
  {
    title: 'Source',
    layers: [
      { key: 'showSourceLayer', label: 'source' },
      { key: 'showCircleStrokeLayer', label: 'circle strokes' },
    ],
  },
  {
    title: 'Glass',
    layers: [
      { key: 'showRefractionLayer', label: 'refraction' },
      { key: 'showChromaticLayer', label: 'chromatic' },
      { key: 'showInnerShadeLayer', label: 'inner shade' },
      { key: 'showGlassMilkLayer', label: 'glass milk' },
    ],
  },
  {
    title: 'Light',
    layers: [
      { key: 'showTopWashLayer', label: 'top wash' },
      { key: 'showRimLayer', label: 'rim' },
      { key: 'showHardRimLayer', label: 'hard rim' },
      { key: 'showCaRimLayer', label: 'CA rim' },
      { key: 'showSpecLayer', label: 'specular' },
    ],
  },
  {
    title: 'Finish',
    layers: [
      { key: 'showOuterStrokeLayer', label: 'outer stroke' },
      { key: 'showShadowLayer', label: 'shadow' },
    ],
  },
];

function applyReelStage(stage: ReelStage): void {
  const visibleThrough = Number.parseInt(stage.slice(0, 2), 10);
  presentationControls.reelStep = stage;
  presentationControls.debugView = 'final';
  presentationControls.showContactDebug = false;
  presentationControls.showSourceLayer = visibleThrough >= 1;
  presentationControls.showCircleStrokeLayer = visibleThrough >= 2;
  presentationControls.showRefractionLayer = visibleThrough >= 3;
  presentationControls.showChromaticLayer = visibleThrough >= 4;
  presentationControls.showInnerShadeLayer = visibleThrough >= 5;
  presentationControls.showGlassMilkLayer = visibleThrough >= 6;
  presentationControls.showTopWashLayer = visibleThrough >= 7;
  presentationControls.showRimLayer = visibleThrough >= 8;
  presentationControls.showHardRimLayer = visibleThrough >= 9;
  presentationControls.showCaRimLayer = visibleThrough >= 9;
  presentationControls.showSpecLayer = visibleThrough >= 10;
  presentationControls.showOuterStrokeLayer = visibleThrough >= 11;
  presentationControls.showShadowLayer = visibleThrough >= 11;
}

function createStepButton(label: string, symbol: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'reel-step-button';
  button.setAttribute('aria-label', label);
  button.textContent = symbol;

  return button;
}

export function setupReelPresentation(): void {
  const root = document.getElementById('reel-presentation');
  if (!root) throw new Error('Reel presentation root is missing.');

  const panel = document.createElement('section');
  panel.id = 'reel-layer-panel';
  panel.className = 'reel-layer-panel';
  panel.setAttribute('aria-label', 'Rendering layer controls');
  panel.hidden = true;

  const panelTitle = document.createElement('h2');
  panelTitle.textContent = 'Rendering layers';
  panel.append(panelTitle);

  const diagnostics = document.createElement('fieldset');
  const diagnosticsTitle = document.createElement('legend');
  diagnosticsTitle.textContent = 'Diagnostics';
  diagnostics.append(diagnosticsTitle);

  const debugLabel = document.createElement('label');
  debugLabel.className = 'reel-setting-row';
  const debugText = document.createElement('span');
  debugText.textContent = 'debug view';
  const debugSelect = document.createElement('select');
  debugSelect.setAttribute('aria-label', 'Debug view');
  const debugViews: DebugView[] = ['final', 'contact field', 'surface normals', 'spec mask'];
  for (const view of debugViews) {
    const option = document.createElement('option');
    option.value = view;
    option.textContent = view;
    debugSelect.append(option);
  }
  debugLabel.append(debugText, debugSelect);
  diagnostics.append(debugLabel);

  const contactLabel = document.createElement('label');
  contactLabel.className = 'reel-toggle-row';
  const contactText = document.createElement('span');
  contactText.textContent = 'show contacts';
  const contactInput = document.createElement('input');
  contactInput.type = 'checkbox';
  contactInput.setAttribute('aria-label', 'Show contacts');
  contactLabel.append(contactText, contactInput);
  diagnostics.append(contactLabel);
  panel.append(diagnostics);

  const layerInputs: Array<{ key: LayerToggleKey; input: HTMLInputElement }> = [];
  for (const group of layerGroups) {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = group.title;
    fieldset.append(legend);

    for (const layer of group.layers) {
      const label = document.createElement('label');
      label.className = 'reel-toggle-row';
      const text = document.createElement('span');
      text.textContent = layer.label;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('aria-label', layer.label);
      input.addEventListener('change', () => {
        presentationControls[layer.key] = input.checked;
        presentationControls.reelStep = 'custom';
        syncControls();
      });
      label.append(text, input);
      fieldset.append(label);
      layerInputs.push({ key: layer.key, input });
    }

    panel.append(fieldset);
  }

  const toolbar = document.createElement('nav');
  toolbar.className = 'reel-toolbar';
  toolbar.setAttribute('aria-label', 'Rendering build steps');
  const previousButton = createStepButton('Previous rendering step', '\u2039');
  const nextButton = createStepButton('Next rendering step', '\u203a');
  const stepSelect = document.createElement('select');
  stepSelect.className = 'reel-step-select';
  stepSelect.setAttribute('aria-label', 'Build step');
  for (const stage of reelStages) {
    const option = document.createElement('option');
    option.value = stage;
    option.textContent = stage;
    stepSelect.append(option);
  }
  const customOption = document.createElement('option');
  customOption.value = 'custom';
  customOption.textContent = 'custom';
  customOption.disabled = true;
  stepSelect.append(customOption);

  const panelButton = document.createElement('button');
  panelButton.type = 'button';
  panelButton.className = 'reel-layers-button';
  panelButton.textContent = 'layers';
  panelButton.setAttribute('aria-controls', panel.id);
  panelButton.setAttribute('aria-expanded', 'false');
  toolbar.append(previousButton, stepSelect, nextButton, panelButton);
  root.append(panel, toolbar);

  function syncControls(): void {
    stepSelect.value = presentationControls.reelStep;
    debugSelect.value = presentationControls.debugView;
    contactInput.checked = presentationControls.showContactDebug;
    for (const layer of layerInputs) {
      layer.input.checked = presentationControls[layer.key];
    }

    const stageIndex = reelStages.indexOf(
      presentationControls.reelStep as ReelStage,
    );
    previousButton.disabled = stageIndex === 0;
    nextButton.disabled = stageIndex === reelStages.length - 1;
  }

  function moveStep(offset: -1 | 1): void {
    const current = reelStages.indexOf(presentationControls.reelStep as ReelStage);
    const fallback = offset < 0 ? reelStages.length - 1 : 0;
    const target = current < 0
      ? fallback
      : Math.max(0, Math.min(reelStages.length - 1, current + offset));
    applyReelStage(reelStages[target]);
    syncControls();
  }

  previousButton.addEventListener('click', () => moveStep(-1));
  nextButton.addEventListener('click', () => moveStep(1));
  stepSelect.addEventListener('change', () => {
    applyReelStage(stepSelect.value as ReelStage);
    syncControls();
  });
  debugSelect.addEventListener('change', () => {
    presentationControls.debugView = debugSelect.value as DebugView;
  });
  contactInput.addEventListener('change', () => {
    presentationControls.showContactDebug = contactInput.checked;
  });
  panelButton.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    panelButton.setAttribute('aria-expanded', String(!panel.hidden));
    panelButton.classList.toggle('is-active', !panel.hidden);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    panel.hidden = true;
    panelButton.setAttribute('aria-expanded', 'false');
    panelButton.classList.remove('is-active');
    panelButton.focus();
  });

  syncControls();
}
