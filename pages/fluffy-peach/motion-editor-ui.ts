import { DEFAULT_PLAYBACK_SPEED, MOTION_FPS } from './motion-editor';
import { variants, type VariantId } from './variants';
import { BoneEditorUI } from './bone-editor-ui';
import { boneDefinitionsFor, type BonePose } from './bone-rig';
import { BONE_LOOP_FRAMES, boneMotionDescriptions } from './bone-motion';
import type { BoneTracks } from './bone-animation';

type EditorOptions = {
  clips: Record<VariantId, BoneTracks>;
  legacyFrames: readonly (readonly BonePose[])[];
  shape: VariantId;
  initialSeconds: number;
  readCurrentSeconds: () => number;
  onClose: (seconds: number) => void;
  onChange: () => void;
};
const element = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
function timecode(frame: number) {
  const whole = Math.round(frame);
  return `00:${String(Math.floor(whole / MOTION_FPS)).padStart(2, '0')}:${String(whole % MOTION_FPS).padStart(2, '0')}`;
}

export class MotionEditor {
  readonly period = BONE_LOOP_FRAMES;
  active = false;
  playing = false;
  comparing = false;
  meshView = false;
  frame = 0;
  private speed = DEFAULT_PLAYBACK_SPEED;
  private zoom = 1;
  private shape: VariantId;
  private readonly panel = element<HTMLElement>('#motion-editor');
  private readonly toggle = element<HTMLButtonElement>('#editor-toggle');
  private readonly content = element<HTMLElement>('#editor-content');
  private readonly scroll = element<HTMLElement>('#editor-scroll');
  private readonly ruler = element<HTMLElement>('#editor-ruler');
  private readonly boneMeasurement = element<HTMLElement>('#bone-measurement');
  private readonly playhead = element<HTMLElement>('#editor-playhead');
  private readonly timeOutput = element<HTMLOutputElement>('#editor-timecode');
  private readonly frameOutput = element<HTMLElement>('#editor-source-frame');
  private readonly shapeOutput = element<HTMLElement>('#editor-shape');
  private readonly playButton = element<HTMLButtonElement>('[data-action="play"]');
  private readonly compareButton = element<HTMLButtonElement>('[data-action="compare"]');
  private readonly meshButton = element<HTMLButtonElement>('[data-action="mesh-view"]');
  private readonly boneEditor: BoneEditorUI;

  constructor(private readonly options: EditorOptions) {
    this.shape = options.shape;
    this.frame = Math.max(0, options.initialSeconds * MOTION_FPS) % this.period;
    this.active = new URLSearchParams(location.search).get('editor') === '1';
    this.boneEditor = new BoneEditorUI({
      clips: options.clips, legacyFrames: options.legacyFrames, shape: options.shape, period: this.period,
      readFrame: () => this.frame, seek: (frame) => this.seek(frame), changed: options.onChange,
    });
    const url = new URL(location.href);
    url.searchParams.delete('rig');
    history.replaceState(null, '', url);
    this.setOpenAppearance();
    this.bindEvents();
    this.layoutTimeline();
    for (let second = 0; second <= Math.floor(this.period / MOTION_FPS); second++) {
      const mark = document.createElement('span');
      mark.style.left = `${second * MOTION_FPS / this.period * 100}%`;
      mark.textContent = `${second}s`;
      this.ruler.append(mark);
    }
    this.updateDisplay();
    new ResizeObserver(() => this.layoutTimeline()).observe(this.scroll);
  }

  private setOpenAppearance() {
    this.panel.hidden = !this.active;
    document.body.classList.toggle('editor-open', this.active);
    document.body.classList.toggle('mesh-view', this.showingMesh);
    document.body.classList.toggle('bone-editor', this.active);
    this.boneMeasurement.hidden = !this.showingMesh;
    this.toggle.setAttribute('aria-expanded', String(this.active));
    this.toggle.textContent = this.active ? '편집 닫기' : '모션 편집';
    this.shapeOutput.textContent = variants.find((variant) => variant.id === this.shape)!.label;
    element('#editor-motion-description').textContent = boneMotionDescriptions[this.shape];
  }

  private toggleOpen() {
    if (!this.active) this.frame = (this.options.readCurrentSeconds() * MOTION_FPS) % this.period;
    this.active = !this.active;
    this.playing = false;
    if (!this.active) this.options.onClose(this.frame / MOTION_FPS);
    const url = new URL(location.href);
    if (this.active) url.searchParams.set('editor', '1'); else url.searchParams.delete('editor');
    history.replaceState(null, '', url);
    this.setOpenAppearance(); this.layoutTimeline(); this.updateDisplay(); this.options.onChange();
  }

  setShape(shape: VariantId) {
    this.shape = shape;
    this.boneEditor.setShape(shape);
    this.setOpenAppearance(); this.updateDisplay(); this.options.onChange();
  }
  advance(deltaSeconds: number) {
    if (this.active && this.playing) this.frame = (this.frame + deltaSeconds * MOTION_FPS * this.speed) % this.period;
  }
  get showingMesh() { return this.active && this.meshView; }
  get selectedBoneIndex() { return this.boneEditor.selectedBone; }
  get showBoneReference() { return this.boneEditor.showReference; }
  selectBone(index: number) { this.boneEditor.selectBone(index); }
  sampleBonePose(frame: number) { return this.boneEditor.sample(frame, this.active && this.comparing); }

  updateDisplay() {
    if (!this.active) return;
    this.boneEditor.update(this.frame);
    this.boneMeasurement.textContent = `${this.comparing ? '기본 모션 · ' : ''}관절 ${this.selectedBoneIndex} · ${boneDefinitionsFor(this.shape)[this.selectedBoneIndex].name} / 13개`;
    this.playhead.style.left = `${this.frame / this.period * 100}%`;
    this.timeOutput.value = timecode(this.frame);
    this.frameOutput.textContent = `${Math.round(this.frame)} / ${this.period}f`;
    this.playButton.textContent = this.playing ? 'Ⅱ' : '▶';
    this.playButton.setAttribute('aria-label', this.playing ? '일시정지' : '재생');
  }
  private seek(frame: number) {
    this.frame = Math.max(0, Math.min(this.period, frame));
    this.playing = false; this.updateDisplay(); this.options.onChange();
  }
  private layoutTimeline() {
    const width = Math.max(this.scroll.clientWidth, Math.round(640 * this.zoom));
    this.content.style.width = `${width}px`;
    this.content.style.setProperty('--second-width', `${width * MOTION_FPS / this.period}px`);
  }
  private bindEvents() {
    this.toggle.addEventListener('click', () => this.toggleOpen());
    this.playButton.addEventListener('click', () => {
      this.playing = !this.playing; this.updateDisplay(); this.options.onChange();
    });
    for (const [action, direction] of [['previous-frame', -1], ['next-frame', 1]] as const) {
      element(`[data-action="${action}"]`).addEventListener('click', () => this.seek(this.frame + direction));
    }
    this.compareButton.addEventListener('click', () => {
      this.comparing = !this.comparing;
      this.compareButton.setAttribute('aria-pressed', String(this.comparing));
      this.compareButton.textContent = this.comparing ? '편집본 보기' : '기본 모션 비교';
      this.options.onChange();
    });
    this.meshButton.addEventListener('click', () => {
      this.meshView = !this.meshView;
      this.meshButton.setAttribute('aria-pressed', String(this.meshView));
      this.meshButton.textContent = this.meshView ? '결과 보기' : '메시 보기';
      this.setOpenAppearance(); this.options.onChange();
    });
    element<HTMLSelectElement>('#editor-speed').addEventListener('change', (event) => {
      this.speed = Number((event.target as HTMLSelectElement).value);
    });
    element<HTMLInputElement>('#editor-zoom').addEventListener('input', (event) => {
      this.zoom = Number((event.target as HTMLInputElement).value); this.layoutTimeline();
    });
    this.ruler.addEventListener('pointerdown', (event) => {
      this.ruler.setPointerCapture(event.pointerId);
      const seek = (x: number) => {
        const bounds = this.content.getBoundingClientRect();
        this.seek(Math.round((x - bounds.left) / bounds.width * this.period));
      };
      seek(event.clientX);
      const move = (next: PointerEvent) => seek(next.clientX);
      const stop = () => {
        this.ruler.removeEventListener('pointermove', move);
        this.ruler.removeEventListener('pointerup', stop);
        this.ruler.removeEventListener('pointercancel', stop);
      };
      this.ruler.addEventListener('pointermove', move);
      this.ruler.addEventListener('pointerup', stop);
      this.ruler.addEventListener('pointercancel', stop);
    });
    this.panel.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === 'Space') { event.preventDefault(); this.playButton.click(); }
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault(); this.seek(this.frame + (event.code === 'ArrowRight' ? 1 : -1));
      }
    });
  }
}
