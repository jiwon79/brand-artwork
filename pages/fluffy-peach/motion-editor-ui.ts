import { loopFrame, variantGesture } from './motion-loop';
import {
  defaultTracks, deleteKeyframe, EDITOR_STORAGE_KEY, MOTION_FPS, motionPeriod,
  moveKeyframe, parseMotionPreset, sampleTrack, setKeyframe, trackIds, trackSpecs,
  type MotionPreset, type MotionTracks, type TrackId,
} from './motion-editor';
import { variants, type VariantId } from './variants';

type EditorOptions = {
  frameCount: number;
  referenceWidths: readonly number[];
  contourFrames: readonly (readonly number[])[];
  shape: VariantId;
  initialSeconds: number;
  readCurrentSeconds: () => number;
  onClose: (seconds: number) => void;
  onChange: () => void;
};

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Motion editor element missing: ${selector}`);
  return found;
}

function timecode(frame: number) {
  const whole = Math.round(frame);
  const seconds = Math.floor(whole / MOTION_FPS);
  return `00:${String(seconds).padStart(2, '0')}:${String(whole % MOTION_FPS).padStart(2, '0')}`;
}

function valueLabel(id: TrackId, value: number) {
  return `${id === 'response' ? value.toFixed(2) : Math.round(value)}${trackSpecs[id].unit}`;
}

export class MotionEditor {
  readonly period: number;
  active = false;
  playing = false;
  comparing = false;
  meshView = false;
  frame = 0;
  selectedContourIndex = 0;
  private speed = 1;
  private zoom = 1;
  private shape: VariantId;
  private tracks: MotionTracks;
  private selectedTrack: TrackId = 'response';
  private selectedFrame = 0;
  private readonly options: EditorOptions;
  private readonly panel = element<HTMLElement>('#motion-editor');
  private readonly toggle = element<HTMLButtonElement>('#editor-toggle');
  private readonly content = element<HTMLElement>('#editor-content');
  private readonly scroll = element<HTMLElement>('#editor-scroll');
  private readonly ruler = element<HTMLElement>('#editor-ruler');
  private readonly source = element<HTMLElement>('#editor-source');
  private readonly contours = element<HTMLElement>('#editor-contours');
  private readonly contourCanvas = element<HTMLCanvasElement>('#editor-contour-canvas');
  private readonly contourSelection = element<HTMLElement>('#editor-contour-selection');
  private readonly contourIndexInput = element<HTMLInputElement>('#editor-contour-index');
  private readonly contourOutput = element<HTMLOutputElement>('#editor-contour-value');
  private readonly contourMeasurement = element<HTMLElement>('#contour-measurement');
  private readonly playhead = element<HTMLElement>('#editor-playhead');
  private readonly timeOutput = element<HTMLOutputElement>('#editor-timecode');
  private readonly sourceOutput = element<HTMLElement>('#editor-source-frame');
  private readonly sourceWidthOutput = element<HTMLOutputElement>('#editor-source-width');
  private readonly shapeOutput = element<HTMLElement>('#editor-shape');
  private readonly trackInput = element<HTMLSelectElement>('#editor-track');
  private readonly frameInput = element<HTMLInputElement>('#editor-keyframe-time');
  private readonly valueInput = element<HTMLInputElement>('#editor-keyframe-value');
  private readonly playButton = element<HTMLButtonElement>('[data-action="play"]');
  private readonly compareButton = element<HTMLButtonElement>('[data-action="compare"]');
  private readonly meshButton = element<HTMLButtonElement>('[data-action="mesh-view"]');
  private readonly deleteButton = element<HTMLButtonElement>('[data-action="delete-keyframe"]');
  private readonly fileInput = element<HTMLInputElement>('#editor-file');
  private readonly help = element<HTMLElement>('.editor-help');
  private readonly defaultHelp = this.help.textContent ?? '';

  constructor(options: EditorOptions) {
    this.options = options;
    this.period = motionPeriod(options.frameCount);
    this.shape = options.shape;
    this.tracks = this.load(options.shape);
    this.frame = Math.min(this.period, Math.max(0, options.initialSeconds * MOTION_FPS));
    this.active = new URLSearchParams(location.search).get('editor') === '1';
    this.setOpenAppearance();
    this.bindEvents();
    this.drawTimeline();
    this.updateInspector();
    this.updateDisplay(loopFrame(this.frame / MOTION_FPS, options.frameCount));
    new ResizeObserver(() => this.layoutTimeline()).observe(this.scroll);
  }

  private load(shape: VariantId) {
    try {
      const saved = localStorage.getItem(`${EDITOR_STORAGE_KEY}.${shape}`);
      return parseMotionPreset(saved ? JSON.parse(saved) : null, shape, this.period) ?? defaultTracks(this.period);
    } catch {
      return defaultTracks(this.period);
    }
  }

  private save() {
    const preset: MotionPreset = { version: 1, shape: this.shape, period: this.period, tracks: this.tracks };
    try { localStorage.setItem(`${EDITOR_STORAGE_KEY}.${this.shape}`, JSON.stringify(preset)); }
    catch { this.help.textContent = '브라우저 저장 공간을 사용할 수 없습니다. JSON으로 저장해 주세요.'; }
    this.options.onChange();
  }

  private setOpenAppearance() {
    this.panel.hidden = !this.active;
    document.body.classList.toggle('editor-open', this.active);
    document.body.classList.toggle('mesh-view', this.active && this.meshView);
    this.contourMeasurement.hidden = !(this.active && this.meshView);
    this.toggle.setAttribute('aria-expanded', String(this.active));
    this.toggle.textContent = this.active ? '편집 닫기' : '모션 편집';
    this.shapeOutput.textContent = variants.find((variant) => variant.id === this.shape)?.label ?? this.shape;
  }

  private toggleOpen() {
    if (!this.active) {
      this.frame = (this.options.readCurrentSeconds() * MOTION_FPS) % this.period;
      this.active = true;
      this.playing = false;
    } else {
      this.active = false;
      this.playing = false;
      this.options.onClose(this.frame / MOTION_FPS);
    }
    const url = new URL(location.href);
    if (this.active) url.searchParams.set('editor', '1');
    else url.searchParams.delete('editor');
    history.replaceState(null, '', url);
    this.setOpenAppearance();
    this.layoutTimeline();
    this.updateDisplay(loopFrame(this.frame / MOTION_FPS, this.options.frameCount));
    this.options.onChange();
  }

  setShape(shape: VariantId) {
    this.shape = shape;
    this.tracks = this.load(shape);
    this.selectedTrack = 'response';
    this.selectedFrame = 0;
    this.setOpenAppearance();
    this.drawKeys();
    this.updateInspector();
    this.options.onChange();
  }

  advance(deltaSeconds: number) {
    if (this.active && this.playing) {
      this.frame = (this.frame + deltaSeconds * MOTION_FPS * this.speed) % this.period;
    }
  }

  sample(id: TrackId) {
    return this.active && !this.comparing
      ? sampleTrack(this.tracks[id], this.frame, this.period)
      : trackSpecs[id].initial;
  }

  get showingMesh() {
    return this.active && this.meshView;
  }

  updateDisplay(sourceFrame: number) {
    if (!this.active) return;
    this.playhead.style.left = `${this.frame / this.period * 100}%`;
    this.timeOutput.value = timecode(this.frame);
    this.sourceOutput.textContent = `원본 ${String(Math.floor(sourceFrame) + 1).padStart(3, '0')}`;
    this.sourceWidthOutput.value = `${Math.round(variantGesture(sourceFrame, this.options.referenceWidths) * 100)}%`;
    const contourValue = this.sampleContour(sourceFrame, this.selectedContourIndex);
    const contourLabel = `#${String(this.selectedContourIndex + 1).padStart(2, '0')} · ${contourValue.toFixed(1)}px`;
    this.contourOutput.value = contourLabel;
    this.contourMeasurement.querySelector('span')!.textContent = contourLabel;
    this.contourSelection.style.top = `${this.selectedContourIndex / 64 * 100}%`;
    for (const id of trackIds) {
      const output = element<HTMLOutputElement>(`[data-label="${id}"] output`);
      output.value = valueLabel(id, this.sample(id));
    }
    this.playButton.textContent = this.playing ? 'Ⅱ' : '▶';
    this.playButton.setAttribute('aria-label', this.playing ? '일시정지' : '재생');
  }

  private sampleContour(sourceFrame: number, index: number) {
    const first = Math.floor(sourceFrame);
    const second = Math.min(first + 1, this.options.contourFrames.length - 1);
    const fraction = sourceFrame - first;
    return this.options.contourFrames[first][index] * (1 - fraction)
      + this.options.contourFrames[second][index] * fraction;
  }

  private selectContour(index: number) {
    if (!Number.isFinite(index)) {
      this.contourIndexInput.value = String(this.selectedContourIndex + 1);
      return;
    }
    this.selectedContourIndex = Math.min(63, Math.max(0, Math.round(index)));
    this.contourIndexInput.value = String(this.selectedContourIndex + 1);
    this.updateDisplay(loopFrame(this.frame / MOTION_FPS, this.options.frameCount));
    this.options.onChange();
  }

  private seek(frame: number, pause = true) {
    this.frame = Math.min(this.period, Math.max(0, frame));
    if (pause) this.playing = false;
    this.updateDisplay(loopFrame(this.frame / MOTION_FPS, this.options.frameCount));
    this.options.onChange();
  }

  private frameAt(clientX: number) {
    const bounds = this.content.getBoundingClientRect();
    return Math.round((clientX - bounds.left) / bounds.width * this.period);
  }

  private layoutTimeline() {
    const width = Math.max(this.scroll.clientWidth, Math.round(640 * this.zoom));
    this.content.style.width = `${width}px`;
    this.content.style.setProperty('--second-width', `${width * MOTION_FPS / this.period}px`);
  }

  private drawTimeline() {
    this.layoutTimeline();
    this.ruler.replaceChildren();
    for (let second = 0; second <= Math.floor(this.period / MOTION_FPS); second++) {
      const mark = document.createElement('span');
      mark.style.left = `${second * MOTION_FPS / this.period * 100}%`;
      mark.textContent = `${second}s`;
      this.ruler.append(mark);
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1000 34');
    svg.setAttribute('preserveAspectRatio', 'none');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    const points: string[] = [];
    for (let tick = 0; tick <= this.period; tick++) {
      const sourceFrame = loopFrame(tick / MOTION_FPS, this.options.frameCount);
      const intensity = variantGesture(sourceFrame, this.options.referenceWidths);
      points.push(`${(tick / this.period * 1000).toFixed(2)},${(28 - intensity * 22).toFixed(2)}`);
    }
    path.setAttribute('points', points.join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#93d7cb');
    path.setAttribute('stroke-width', '2');
    svg.append(path);
    this.source.replaceChildren(svg);
    this.drawContours();
    this.drawKeys();
  }

  private drawContours() {
    const canvas = this.contourCanvas;
    canvas.width = this.period + 1;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(canvas.width, canvas.height);
    const values = this.options.contourFrames.flat();
    const minimum = Math.min(...values), maximum = Math.max(...values);
    for (let x = 0; x < canvas.width; x++) {
      const sourceFrame = loopFrame(x / MOTION_FPS, this.options.frameCount);
      for (let y = 0; y < 64; y++) {
        const value = (this.sampleContour(sourceFrame, y) - minimum) / (maximum - minimum);
        const color = Math.max(0, Math.min(1, value));
        const offset = (y * canvas.width + x) * 4;
        image.data[offset] = Math.round(28 + 235 * color);
        image.data[offset + 1] = Math.round(99 + 89 * color);
        image.data[offset + 2] = Math.round(123 + 37 * color);
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }

  private drawKeys() {
    for (const id of trackIds) {
      const lane = element<HTMLElement>(`[data-lane="${id}"]`);
      lane.classList.toggle('selected', id === this.selectedTrack);
      lane.replaceChildren();
      for (const key of this.tracks[id]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'editor-keyframe';
        button.classList.toggle('selected', id === this.selectedTrack && key.frame === this.selectedFrame);
        button.style.left = key.frame === 0 ? '7px'
          : key.frame === this.period ? 'calc(100% - 7px)'
            : `${key.frame / this.period * 100}%`;
        button.setAttribute('aria-label', `${trackSpecs[id].label} ${timecode(key.frame)} ${valueLabel(id, key.value)}`);
        button.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
          this.selectedTrack = id;
          this.selectedFrame = key.frame;
          this.updateInspector();
          for (const selected of this.content.querySelectorAll('.editor-keyframe.selected')) selected.classList.remove('selected');
          for (const row of this.content.querySelectorAll('.editor-lane')) row.classList.toggle('selected', row === lane);
          button.classList.add('selected');
          button.setPointerCapture(event.pointerId);
          let movedFrame = key.frame;
          button.addEventListener('pointermove', (move) => {
            if (!button.hasPointerCapture(move.pointerId) || key.frame === 0 || key.frame === this.period) return;
            movedFrame = Math.min(this.period - 1, Math.max(1, this.frameAt(move.clientX)));
            button.style.left = `${movedFrame / this.period * 100}%`;
            this.seek(movedFrame);
          });
          button.addEventListener('pointerup', () => {
            if (movedFrame !== key.frame) {
              this.selectedFrame = moveKeyframe(this.tracks, id, key.frame, movedFrame, this.period);
              this.save();
            }
            this.drawKeys();
            this.updateInspector();
          }, { once: true });
        });
        button.addEventListener('click', (event) => {
          if (event.detail !== 0) return;
          this.selectedTrack = id;
          this.selectedFrame = key.frame;
          this.seek(key.frame);
          this.drawKeys();
          this.updateInspector();
        });
        lane.append(button);
      }
    }
  }

  private updateInspector() {
    const key = this.tracks[this.selectedTrack].find((item) => item.frame === this.selectedFrame);
    if (!key) return;
    this.trackInput.value = this.selectedTrack;
    this.frameInput.value = String(key.frame);
    this.frameInput.max = String(this.period - 1);
    this.frameInput.disabled = key.frame === 0 || key.frame === this.period;
    const spec = trackSpecs[this.selectedTrack];
    this.valueInput.min = String(spec.min);
    this.valueInput.max = String(spec.max);
    this.valueInput.step = String(spec.step);
    this.valueInput.value = String(key.value);
    this.deleteButton.disabled = this.frameInput.disabled;
  }

  private bindEvents() {
    this.toggle.addEventListener('click', () => this.toggleOpen());
    this.playButton.addEventListener('click', () => {
      this.playing = !this.playing;
      this.updateDisplay(loopFrame(this.frame / MOTION_FPS, this.options.frameCount));
      this.options.onChange();
    });
    for (const [action, direction] of [['previous-frame', -1], ['next-frame', 1]] as const) {
      element<HTMLButtonElement>(`[data-action="${action}"]`).addEventListener('click', () => this.seek(this.frame + direction));
    }
    this.compareButton.addEventListener('click', () => {
      this.comparing = !this.comparing;
      this.compareButton.setAttribute('aria-pressed', String(this.comparing));
      this.compareButton.textContent = this.comparing ? '편집본 보기' : '원본 비교';
      this.options.onChange();
    });
    this.meshButton.addEventListener('click', () => {
      this.meshView = !this.meshView;
      this.meshButton.setAttribute('aria-pressed', String(this.meshView));
      this.meshButton.textContent = this.meshView ? '결과 보기' : '메시 보기';
      this.setOpenAppearance();
      this.options.onChange();
    });
    element<HTMLSelectElement>('#editor-speed').addEventListener('change', (event) => {
      this.speed = Number((event.target as HTMLSelectElement).value);
    });
    element<HTMLInputElement>('#editor-zoom').addEventListener('input', (event) => {
      this.zoom = Number((event.target as HTMLInputElement).value);
      this.layoutTimeline();
    });
    let scrubbing: number | null = null;
    this.content.addEventListener('pointerdown', (event) => {
      if ((event.target as HTMLElement).closest('.editor-keyframe')) return;
      if ((event.target as HTMLElement).closest('#editor-contours')) {
        const bounds = this.contours.getBoundingClientRect();
        this.selectContour(Math.floor((event.clientY - bounds.top) / bounds.height * 64));
      }
      const lane = (event.target as HTMLElement).closest<HTMLElement>('[data-lane]');
      if (lane?.dataset.lane) {
        this.selectedTrack = lane.dataset.lane as TrackId;
        this.selectedFrame = this.tracks[this.selectedTrack][0].frame;
        this.drawKeys();
        this.updateInspector();
      }
      if (event.pointerType === 'touch' && lane) return;
      scrubbing = event.pointerId;
      this.content.setPointerCapture(event.pointerId);
      this.seek(this.frameAt(event.clientX));
    });
    this.content.addEventListener('pointermove', (event) => {
      if (scrubbing === event.pointerId) {
        if (this.contours.contains(document.elementFromPoint(event.clientX, event.clientY))) {
          const bounds = this.contours.getBoundingClientRect();
          this.selectContour(Math.floor((event.clientY - bounds.top) / bounds.height * 64));
        }
        this.seek(this.frameAt(event.clientX));
      }
    });
    const stopScrub = () => { scrubbing = null; };
    this.content.addEventListener('pointerup', stopScrub);
    this.content.addEventListener('pointercancel', stopScrub);
    this.contourIndexInput.addEventListener('change', () => this.selectContour(Number(this.contourIndexInput.value) - 1));
    this.trackInput.addEventListener('change', () => {
      this.selectedTrack = this.trackInput.value as TrackId;
      this.selectedFrame = 0;
      this.drawKeys();
      this.updateInspector();
    });
    this.frameInput.addEventListener('change', () => {
      const next = Number(this.frameInput.value);
      if (!Number.isFinite(next)) return this.updateInspector();
      this.selectedFrame = moveKeyframe(this.tracks, this.selectedTrack, this.selectedFrame, next, this.period);
      this.seek(this.selectedFrame);
      this.drawKeys();
      this.updateInspector();
      this.save();
    });
    this.valueInput.addEventListener('input', () => {
      if (this.valueInput.value.trim() === '') return;
      const value = Number(this.valueInput.value);
      if (!Number.isFinite(value)) return;
      setKeyframe(this.tracks, this.selectedTrack, this.selectedFrame, value, this.period);
      this.drawKeys();
      this.save();
    });
    element<HTMLButtonElement>('[data-action="add-keyframe"]').addEventListener('click', () => {
      const frame = Math.min(this.period - 1, Math.max(1, Math.round(this.frame)));
      setKeyframe(this.tracks, this.selectedTrack, frame,
        sampleTrack(this.tracks[this.selectedTrack], frame, this.period), this.period);
      this.selectedFrame = frame;
      this.drawKeys();
      this.updateInspector();
      this.save();
    });
    this.deleteButton.addEventListener('click', () => {
      deleteKeyframe(this.tracks, this.selectedTrack, this.selectedFrame, this.period);
      this.selectedFrame = 0;
      this.drawKeys();
      this.updateInspector();
      this.save();
    });
    element<HTMLButtonElement>('[data-action="reset"]').addEventListener('click', () => {
      this.tracks = defaultTracks(this.period);
      this.selectedTrack = 'response';
      this.selectedFrame = 0;
      this.help.textContent = this.defaultHelp;
      this.drawKeys();
      this.updateInspector();
      this.save();
    });
    element<HTMLButtonElement>('[data-action="export"]').addEventListener('click', () => {
      const preset: MotionPreset = { version: 1, shape: this.shape, period: this.period, tracks: this.tracks };
      const url = URL.createObjectURL(new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `fluffy-peach-${this.shape}-motion.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    element<HTMLButtonElement>('[data-action="import"]').addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', async () => {
      const file = this.fileInput.files?.[0];
      if (!file) return;
      try {
        const imported = parseMotionPreset(JSON.parse(await file.text()), this.shape, this.period);
        if (!imported) throw new Error('invalid preset');
        this.tracks = imported;
        this.selectedTrack = 'response';
        this.selectedFrame = 0;
        this.help.textContent = `${file.name}의 키프레임을 불러왔습니다.`;
        this.drawKeys();
        this.updateInspector();
        this.save();
      } catch {
        this.help.textContent = '현재 형태와 길이가 일치하는 모션 JSON 파일을 선택해 주세요.';
      }
      this.fileInput.value = '';
    });
    this.panel.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === 'Space') {
        event.preventDefault();
        this.playButton.click();
      } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault();
        this.seek(this.frame + (event.code === 'ArrowRight' ? 1 : -1));
      }
    });
  }
}
