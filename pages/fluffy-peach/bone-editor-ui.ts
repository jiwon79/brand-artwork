import { boneDefinitions } from './bone-rig';
import {
  boneChannels, boneChannelSpecs, fittedBoneTracks, parseBoneTracks, sampleBoneTracks, setBoneKey,
  type BoneChannel, type BoneTracks,
} from './bone-animation';
import { sampleTrack } from './motion-editor';
import type { BonePose } from './bone-rig';

const STORAGE_KEY = 'fluffy-peach.bone-editor.v2';
const find = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const svgNode = (name: string) => document.createElementNS('http://www.w3.org/2000/svg', name);

type Options = {
  frames: readonly (readonly BonePose[])[];
  period: number;
  readFrame: () => number;
  seek: (frame: number) => void;
  changed: () => void;
};

export class BoneEditorUI {
  selectedBone = 1;
  showReference = true;
  private selectedChannel: BoneChannel = 'dx';
  private readonly defaults: BoneTracks;
  private tracks: BoneTracks;
  private notice = '';
  private statusFrame = -1;
  private readonly selector = find<HTMLSelectElement>('#editor-bone-select');
  private readonly status = find<HTMLOutputElement>('#editor-bone-status');
  private readonly deleteButton = find<HTMLButtonElement>('[data-bone-action="delete"]');

  constructor(private readonly options: Options) {
    this.defaults = fittedBoneTracks(options.frames);
    this.tracks = structuredClone(this.defaults);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      this.tracks = parseBoneTracks(saved ? JSON.parse(saved) : null, options.period) ?? this.tracks;
    } catch { /* A fresh fitted clip remains usable when storage is unavailable. */ }
    this.selector.replaceChildren(...boneDefinitions.map((bone, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${String(index).padStart(2, '0')} · ${bone.name}`;
      return option;
    }));
    this.selector.addEventListener('change', () => this.selectBone(Number(this.selector.value)));
    for (const channel of boneChannels) {
      const input = find<HTMLInputElement>(`#editor-bone-${channel}`);
      const spec = boneChannelSpecs[channel];
      input.min = String(spec.min); input.max = String(spec.max);
      input.addEventListener('input', () => {
        if (input.value.trim() === '' || !Number.isFinite(Number(input.value))) return;
        this.notice = '';
        this.selectedChannel = channel;
        const frame = Math.round(options.readFrame());
        options.seek(frame);
        setBoneKey(this.tracks, this.selectedBone, channel, frame, Number(input.value), options.period);
        this.draw(); this.save(); this.update(frame);
      });
      input.addEventListener('blur', () => this.update(options.readFrame()));
      const lane = find<HTMLElement>(`[data-bone-lane="${channel}"]`);
      lane.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        if ((event.target as HTMLElement).closest('.bone-key')) return;
        this.selectedChannel = channel;
        lane.setPointerCapture(event.pointerId);
        const seek = (x: number) => options.seek(this.frameAt(lane, x));
        seek(event.clientX);
        const move = (next: PointerEvent) => seek(next.clientX);
        const stop = () => {
          lane.removeEventListener('pointermove', move);
          lane.removeEventListener('pointerup', stop);
          lane.removeEventListener('pointercancel', stop);
        };
        lane.addEventListener('pointermove', move);
        lane.addEventListener('pointerup', stop);
        lane.addEventListener('pointercancel', stop);
      });
    }
    this.deleteButton.addEventListener('click', () => {
      this.notice = '';
      const frame = Math.round(options.readFrame());
      if (frame === 0 || frame === options.period) return;
      this.tracks[this.selectedBone][this.selectedChannel] = this.tracks[this.selectedBone][this.selectedChannel]
        .filter((key) => key.frame !== frame);
      this.draw(); this.save(); this.update(frame);
    });
    find<HTMLButtonElement>('[data-bone-action="reset-bone"]').addEventListener('click', () => {
      this.notice = '';
      this.tracks[this.selectedBone] = structuredClone(this.defaults[this.selectedBone]);
      this.draw(); this.save(); this.update(options.readFrame());
    });
    find<HTMLButtonElement>('[data-bone-action="reset-all"]').addEventListener('click', () => {
      this.notice = '';
      this.tracks = structuredClone(this.defaults);
      this.draw(); this.save(); this.update(options.readFrame());
    });
    find<HTMLInputElement>('#editor-bone-reference').addEventListener('change', (event) => {
      this.showReference = (event.target as HTMLInputElement).checked;
      options.changed();
    });
    find<HTMLButtonElement>('[data-bone-action="export"]').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(this.preset(), null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'fluffy-peach-bones.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const fileInput = find<HTMLInputElement>('#editor-bone-file');
    find<HTMLButtonElement>('[data-bone-action="import"]').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      options.seek(Math.round(options.readFrame()));
      try {
        const parsed = parseBoneTracks(JSON.parse(await file.text()), options.period);
        if (!parsed) throw new Error('invalid bones');
        this.tracks = parsed; this.draw(); this.save();
        this.notice = '뼈대 키프레임을 불러왔습니다.';
      } catch { this.notice = '이 뼈대와 길이에 맞는 JSON을 선택해 주세요.'; }
      this.statusFrame = Math.round(options.readFrame());
      this.update(options.readFrame());
      fileInput.value = '';
    });
    this.selectBone(this.selectedBone);
  }

  private preset() { return { version: 2, period: this.options.period, bones: this.tracks }; }
  private save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preset())); }
    catch { this.notice = '자동 저장 불가 · JSON 저장을 사용해 주세요.'; }
    this.options.changed();
  }

  selectBone(index: number) {
    this.notice = '';
    this.selectedBone = Math.max(0, Math.min(boneDefinitions.length - 1, Math.round(index)));
    this.selector.value = String(this.selectedBone);
    this.draw(); this.update(this.options.readFrame());
    this.options.changed();
  }

  sample(frame: number) { return sampleBoneTracks(this.tracks, frame, this.options.period); }

  update(frame: number) {
    for (const channel of boneChannels) {
      const value = sampleTrack(this.tracks[this.selectedBone][channel], frame, this.options.period);
      const input = find<HTMLInputElement>(`#editor-bone-${channel}`);
      if (document.activeElement !== input) input.value = value.toFixed(1);
      find<HTMLOutputElement>(`[data-bone-label="${channel}"] output`).value = `${value.toFixed(1)}${boneChannelSpecs[channel].unit}`;
      const lane = find<HTMLElement>(`[data-bone-lane="${channel}"]`);
      lane.classList.toggle('selected', channel === this.selectedChannel);
      for (const key of lane.querySelectorAll<HTMLButtonElement>('.bone-key')) {
        key.classList.toggle('selected', Number(key.dataset.frame) === Math.round(frame) && channel === this.selectedChannel);
      }
    }
    const at = Math.round(frame);
    if (at !== this.statusFrame) this.notice = '';
    this.statusFrame = at;
    this.deleteButton.disabled = at === 0 || at === this.options.period
      || !this.tracks[this.selectedBone][this.selectedChannel].some((key) => key.frame === at);
    this.status.value = this.notice || `${at}f · ${boneChannelSpecs[this.selectedChannel].label}`;
  }

  private frameAt(lane: HTMLElement, x: number) {
    const bounds = lane.getBoundingClientRect();
    return Math.max(0, Math.min(this.options.period, Math.round((x - bounds.left) / bounds.width * this.options.period)));
  }

  private draw() {
    for (const channel of boneChannels) {
      const lane = find<HTMLElement>(`[data-bone-lane="${channel}"]`);
      lane.replaceChildren();
      const keys = this.tracks[this.selectedBone][channel], defaults = this.defaults[this.selectedBone][channel];
      const values = keys.concat(defaults).map((key) => key.value);
      const low = Math.min(0, ...values), high = Math.max(0, ...values);
      const pad = Math.max(channel === 'angle' ? 3 : 6, (high - low) * 0.2);
      const minimum = low - pad, maximum = high + pad;
      const yAt = (value: number) => 100 * (1 - (value - minimum) / (maximum - minimum));
      const svg = svgNode('svg'); svg.setAttribute('viewBox', '0 0 1000 100'); svg.setAttribute('preserveAspectRatio', 'none');
      const zero = svgNode('line');
      for (const [key, value] of Object.entries({ x1: '0', x2: '1000', y1: String(yAt(0)), y2: String(yAt(0)), stroke: '#67758b', 'stroke-width': '1', 'stroke-dasharray': '3 4' })) zero.setAttribute(key, value);
      svg.append(zero);
      const curve = (source: typeof keys, color: string, dashed: boolean) => {
        const line = svgNode('polyline');
        const points = Array.from({ length: this.options.period + 1 }, (_, frame) => `${frame / this.options.period * 1000},${yAt(sampleTrack(source, frame, this.options.period))}`).join(' ');
        line.setAttribute('points', points); line.setAttribute('fill', 'none'); line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', dashed ? '1' : '2');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        if (dashed) line.setAttribute('stroke-dasharray', '4 4');
        svg.append(line);
        return line;
      };
      curve(defaults, '#8390a5', true);
      const editedCurve = curve(keys, boneChannelSpecs[channel].color, false);
      lane.append(svg);
      const scale = document.createElement('span'); scale.className = 'bone-curve-scale';
      scale.textContent = `${maximum.toFixed(0)} / ${minimum.toFixed(0)}${boneChannelSpecs[channel].unit}`;
      lane.append(scale);
      for (const key of keys) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'editor-keyframe bone-key'; button.dataset.frame = String(key.frame);
        button.style.left = `${key.frame / this.options.period * 100}%`; button.style.top = `${yAt(key.value)}%`;
        button.setAttribute('aria-label', `${boneDefinitions[this.selectedBone].name} ${boneChannelSpecs[channel].label} ${key.frame}프레임 ${key.value.toFixed(1)}${boneChannelSpecs[channel].unit}`);
        button.addEventListener('pointerdown', (event) => {
          event.stopPropagation(); event.preventDefault();
          this.selectedChannel = channel;
          this.options.seek(key.frame);
          button.setPointerCapture(event.pointerId);
          const bounds = lane.getBoundingClientRect();
          const beforeDrag = structuredClone(this.tracks[this.selectedBone][channel]);
          const move = (next: PointerEvent) => {
            const at = key.frame === 0 || key.frame === this.options.period ? key.frame
              : Math.max(1, Math.min(this.options.period - 1, this.frameAt(lane, next.clientX)));
            const value = maximum - (next.clientY - bounds.top) / bounds.height * (maximum - minimum);
            // Start each move from the same clip so passing over another key
            // does not erase it. Only a key at the final drop time is replaced.
            this.tracks[this.selectedBone][channel] = beforeDrag
              .filter((item) => key.frame === 0 || key.frame === this.options.period || item.frame !== key.frame)
              .map((item) => ({ ...item }));
            setBoneKey(this.tracks, this.selectedBone, channel, at, value, this.options.period);
            button.dataset.frame = String(at); button.style.left = `${at / this.options.period * 100}%`;
            button.style.top = `${yAt(Math.max(boneChannelSpecs[channel].min, Math.min(boneChannelSpecs[channel].max, value)))}%`;
            editedCurve.setAttribute('points', Array.from({ length: this.options.period + 1 }, (_, frame) => `${frame / this.options.period * 1000},${yAt(sampleTrack(this.tracks[this.selectedBone][channel], frame, this.options.period))}`).join(' '));
            this.options.seek(at);
          };
          const stop = () => {
            button.removeEventListener('pointermove', move); button.removeEventListener('pointerup', stop); button.removeEventListener('pointercancel', stop);
            this.draw(); this.save(); this.update(this.options.readFrame());
          };
          button.addEventListener('pointermove', move); button.addEventListener('pointerup', stop); button.addEventListener('pointercancel', stop);
        });
        button.addEventListener('click', (event) => {
          if (event.detail !== 0) return;
          this.selectedChannel = channel; this.options.seek(key.frame); this.update(key.frame);
        });
        lane.append(button);
      }
    }
  }
}
