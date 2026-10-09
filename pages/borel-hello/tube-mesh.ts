import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage } from 'three';
import { interpolateTubeFrame, sampleTube, TUBE_SIDES, tubeRing, type TubeFrame, type TubePath, type TubePoint } from './tube-geometry';

const ringSize = TUBE_SIDES + 1, segmentIndices = TUBE_SIDES * 6;

/** Extend only the final segment. Restore its full ring before moving forward
 * or rewinding, so scrubbing can never leave a pinched earlier section. */
export class TubeBodyGeometry extends BufferGeometry {
  private partial = -1;
  private weight = -1;
  readonly colors: readonly Color[];

  constructor(readonly path: TubePath, readonly frames: TubeFrame[], colors?: readonly Color[]) {
    super();
    this.colors = colors ?? path.points.map(() => new Color(0xffffff));
    const count = Math.max(0, path.points.length - 1);
    this.setAttribute('position', new BufferAttribute(new Float32Array(count * ringSize * 2 * 3), 3).setUsage(DynamicDrawUsage));
    this.setAttribute('normal', new BufferAttribute(new Float32Array(count * ringSize * 2 * 3), 3).setUsage(DynamicDrawUsage));
    this.setAttribute('color', new BufferAttribute(new Float32Array(count * ringSize * 2 * 3), 3).setUsage(DynamicDrawUsage));
    const indices = new Uint32Array(count * segmentIndices);
    for (let segment = 0; segment < count; segment++) for (let side = 0; side < TUBE_SIDES; side++) {
      const a = segment * ringSize * 2 + side, b = a + ringSize;
      indices.set([a, a + 1, b, a + 1, b + 1, b], segment * segmentIndices + side * 6);
    }
    this.setIndex(new BufferAttribute(indices, 1));
    this.setDrawRange(0, 0);
  }

  private writeRing(segment: number, end: boolean, point: TubePoint, frame: TubeFrame, weight: number, color: Color) {
    const offset = (segment * 2 + Number(end)) * ringSize;
    const positions = this.getAttribute('position'), normals = this.getAttribute('normal'), colors = this.getAttribute('color');
    for (const [i, vertex] of tubeRing(point, frame.tangent, weight, TUBE_SIDES, frame.normal).entries()) {
      positions.setXYZ(offset + i, ...vertex.position); normals.setXYZ(offset + i, ...vertex.normal);
      colors.setXYZ(offset + i, color.r, color.g, color.b);
    }
    positions.needsUpdate = normals.needsUpdate = colors.needsUpdate = true;
  }

  setProgress(written: number, weight: number) {
    const { path, frames, colors } = this;
    if (this.weight !== weight) {
      for (let segment = 0; segment < path.points.length - 1; segment++) {
        this.writeRing(segment, false, path.points[segment], frames[segment], weight, colors[segment]);
        this.writeRing(segment, true, path.points[segment + 1], frames[segment + 1], weight, colors[segment + 1]);
      }
    } else if (this.partial >= 0) {
      const index = this.partial + 1;
      this.writeRing(this.partial, true, path.points[index], frames[index], weight, colors[index]);
    }
    const { point, segment, fraction } = sampleTube(path, written);
    const frame = interpolateTubeFrame(frames[segment], frames[segment + 1], fraction);
    const color = colors[segment].clone().lerp(colors[segment + 1], fraction);
    if (written > 0) {
      this.writeRing(segment, true, point, frame, weight, color);
      this.setDrawRange(0, (segment + 1) * segmentIndices);
      this.partial = segment;
    } else { this.setDrawRange(0, 0); this.partial = -1; }
    this.weight = weight;
    return { point, frame, color };
  }
}
