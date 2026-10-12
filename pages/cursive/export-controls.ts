import type GUI from 'lil-gui';
import type { Controller } from 'lil-gui';
import type { Bounds } from './coordinates';
import type { InkStyle } from './artwork-view';
import { expandPenBounds, type PenPath } from './pen-geometry';
import type { PenPlayback } from './pen-playback';
import { createArtworkPhoto } from './photo-export';
import { createArtworkVideo } from './video-export';
import { downloadArtworkFile, prefersFileShare, shareArtworkFile } from './file-share';

interface ExportSnapshot {
  ready: boolean;
  hasInk: boolean;
  artwork: SVGSVGElement;
  text: string;
  playback: PenPlayback;
  bounds: Bounds;
  style: InkStyle;
  speed: number;
  ropePens?: readonly PenPath[];
}

/** Export actions and prepared files never own or seek the live playback. */
export class ExportControls {
  private savingPhoto = false;
  private savingVideo = false;
  private preparedPhoto: File | undefined;
  private preparedVideo: { file: File; key: string } | undefined;
  private shareFiles = prefersFileShare();
  private photoLabel = this.shareFiles ? '사진 공유' : '사진 다운로드';
  private videoLabel = this.shareFiles ? '영상 만들기' : '영상 다운로드';
  private photoController: Controller;
  private videoController: Controller;

  constructor(gui: GUI, private readonly status: HTMLElement,
    private readonly snapshot: () => ExportSnapshot, private readonly renderCurrent: () => void) {
    this.photoController = gui.add({ photo: () => this.savePhoto() }, 'photo').name(this.photoLabel).disable();
    this.videoController = gui.add({ video: () => this.saveVideo() }, 'video').name(this.videoLabel).disable();
  }

  resetPhoto() {
    if (this.preparedPhoto) this.status.hidden = true;
    this.preparedPhoto = undefined;
    this.photoController.name(this.photoLabel);
    const { hasInk } = this.snapshot();
    this.photoController.disable(!hasInk || this.savingPhoto);
    this.videoController.disable(!hasInk || this.savingVideo);
  }

  sync() {
    const state = this.snapshot();
    if (state.ready && !this.savingVideo && this.preparedVideo && this.preparedVideo.key !== this.videoKey(state)) {
      this.preparedVideo = undefined; this.videoController.name(this.videoLabel); this.status.hidden = true;
    }
  }

  private videoKey({ text, style, speed }: ExportSnapshot) {
    return JSON.stringify([text, style.ink, style.paper, style.weight, style.gradient, speed]);
  }

  private async savePhoto() {
    const initial = this.snapshot();
    if (!initial.ready || !initial.hasInk || this.savingPhoto) return;
    this.savingPhoto = true; this.photoController.disable(); this.status.hidden = true;
    try {
      let photo = this.preparedPhoto;
      if (!photo) {
        this.renderCurrent();
        const { artwork, style, text, bounds, ropePens } = this.snapshot();
        // Fit the deformed ink, falling back to text bounds for an empty frame.
        const ropeBounds = ropePens ? expandPenBounds([Infinity, Infinity, -Infinity, -Infinity], ropePens, style.weight) : undefined;
        const photoBounds = ropeBounds?.every(Number.isFinite) ? ropeBounds : bounds;
        photo = await createArtworkPhoto(artwork, { paper: style.paper, ink: style.ink, text, bounds: photoBounds });
      }
      // A fresh tap shares the prepared file before any asynchronous encoding.
      const result = this.shareFiles ? await shareArtworkFile(photo) : downloadArtworkFile(photo);
      this.preparedPhoto = result === 'retry' ? photo : undefined;
      this.photoController.name(this.preparedPhoto ? '준비된 사진 공유' : this.photoLabel);
      if (this.preparedPhoto) this.message('사진이 준비됐습니다. ‘준비된 사진 공유’를 눌러 공유 시트에서 이미지 저장을 선택하세요.');
    } catch (error) {
      this.message(error instanceof Error ? error.message : '사진을 저장하지 못했습니다.');
    } finally {
      this.savingPhoto = false; this.photoController.disable(!this.snapshot().hasInk);
    }
  }

  private async saveVideo() {
    const state = this.snapshot();
    if (!state.ready || !state.hasInk || this.savingVideo) return;
    this.savingVideo = true; this.videoController.disable(); this.status.hidden = true;
    try {
      const key = this.videoKey(state);
      if (this.shareFiles && this.preparedVideo?.key === key) {
        const result = await shareArtworkFile(this.preparedVideo.file);
        if (result !== 'retry') this.preparedVideo = undefined;
      } else {
        this.preparedVideo = undefined;
        const { playback, bounds, text, style, speed } = state;
        const file = await createArtworkVideo({ playback, bounds: [...bounds], text,
          ink: style.ink, paper: style.paper, weight: style.weight, gradient: style.gradient, speed,
          onProgress: fraction => this.videoController.name(`영상 만드는 중 ${Math.round(fraction * 100)}%`),
        });
        if (this.shareFiles) this.preparedVideo = { file, key };
        else downloadArtworkFile(file);
      }
      if (this.preparedVideo) this.message('영상이 준비됐습니다. ‘준비된 영상 공유’를 눌러 공유 창에서 비디오 저장을 선택하세요.');
    } catch (error) {
      this.message(error instanceof Error ? error.message : '영상을 저장하지 못했습니다.');
    } finally {
      this.savingVideo = false;
      this.videoController.name(this.preparedVideo ? '준비된 영상 공유' : this.videoLabel).disable(!this.snapshot().hasInk);
    }
  }

  private message(text: string) { this.status.textContent = text; this.status.hidden = false; }
}
