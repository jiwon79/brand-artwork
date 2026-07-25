export type ElasticVec2 = {
  x: number;
  y: number;
};

export type ElasticFieldControls = {
  seedRadiusScale: number;
  bridgeRadiusRatio: number;
  membraneBridgeRadiusRatio: number;
  membraneFanThreshold: number;
  contactRadiusShrinkStart: number;
  contactRadiusShrinkEnd: number;
  contactRadiusMinScale: number;
  contactFill: number;
  edgeConcavity: number;
  fieldSmoothness: number;
  contactBlendDuration: number;
  areaPreservation: number;
  minimumNeckWidth: number;
  pressureResponse: number;
  releaseHoldDuration: number;
  releaseLifetime: number;
  springFrequency: number;
  specBoundarySamples: number;
};

export type ElasticContactSample = {
  id: number;
  anchor: ElasticVec2;
  position: ElasticVec2;
  radius: number;
  influence: number;
  active: boolean;
};

export type ElasticMembraneLink = {
  start: ElasticVec2;
  end: ElasticVec2;
  startRadius: number;
  endRadius: number;
  influence: number;
  fillTriangle: number;
};

export type ElasticShapeFrame = {
  contacts: ElasticContactSample[];
  membraneLinks: ElasticMembraneLink[];
  specWarpCage: Float32Array;
  specWarpCageCount: number;
  specWarpCageRevision: number;
  specWarpCenter: ElasticVec2;
  contactRadius: number;
  bridgeRadius: number;
  membraneBridgeRadius: number;
  contourOffset: number;
  edgeConcavity: number;
  fieldSmoothness: number;
};

type Contact = {
  id: number;
  anchor: ElasticVec2;
  position: ElasticVec2;
  target: ElasticVec2;
  velocity: ElasticVec2;
  influence: number;
  releaseAge: number | null;
  releaseOffset: ElasticVec2;
  releaseAngle: number;
  active: boolean;
};

type ShapeMetrics = {
  seedRadius: number;
  bridgeRadius: number;
  membraneBridgeRadius: number;
  contactRadii: number[];
};

const maxContacts = 10;
const maxMembraneLinks = maxContacts * 2;
const areaSampleResolution = 76;
const baseArea = Math.PI;
const specCageGridResolution = 101;
const specCageGridExtent = 5;
export const maxElasticSpecBoundaryPoints = 64;
const specCageGridCellCount = specCageGridResolution * specCageGridResolution;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function add(first: ElasticVec2, second: ElasticVec2): ElasticVec2 {
  return { x: first.x + second.x, y: first.y + second.y };
}

function subtract(first: ElasticVec2, second: ElasticVec2): ElasticVec2 {
  return { x: first.x - second.x, y: first.y - second.y };
}

function scale(vector: ElasticVec2, amount: number): ElasticVec2 {
  return { x: vector.x * amount, y: vector.y * amount };
}

function length(vector: ElasticVec2): number {
  return Math.hypot(vector.x, vector.y);
}

function dot(first: ElasticVec2, second: ElasticVec2): number {
  return first.x * second.x + first.y * second.y;
}

function cross(first: ElasticVec2, second: ElasticVec2): number {
  return first.x * second.y - first.y * second.x;
}

function smoothMinimum(first: number, second: number, radius: number): number {
  const safeRadius = Math.max(radius, 0.0001);
  const blend = Math.max(safeRadius - Math.abs(first - second), 0) / safeRadius;
  return Math.min(first, second) - blend * blend * safeRadius * 0.25;
}

function smoothMaximum(first: number, second: number, radius: number): number {
  return -smoothMinimum(-first, -second, radius);
}

function distanceToSegment(
  point: ElasticVec2,
  start: ElasticVec2,
  end: ElasticVec2,
): number {
  const segment = subtract(end, start);
  const denominator = Math.max(dot(segment, segment), 0.0001);
  const progress = clamp(dot(subtract(point, start), segment) / denominator, 0, 1);
  return length(subtract(point, add(start, scale(segment, progress))));
}

function signedDistanceToTriangle(
  point: ElasticVec2,
  first: ElasticVec2,
  second: ElasticVec2,
  third: ElasticVec2,
): number {
  const edges = [
    subtract(second, first),
    subtract(third, second),
    subtract(first, third),
  ];
  const values = [
    subtract(point, first),
    subtract(point, second),
    subtract(point, third),
  ];
  const orientation = Math.sign(cross(edges[0], edges[2])) || 1;
  let minimumDistanceSquared = Number.POSITIVE_INFINITY;
  let minimumSide = Number.POSITIVE_INFINITY;

  for (let index = 0; index < 3; index += 1) {
    const edge = edges[index];
    const value = values[index];
    const edgeLengthSquared = Math.max(dot(edge, edge), 0.0001);
    const progress = clamp(dot(value, edge) / edgeLengthSquared, 0, 1);
    const nearest = subtract(value, scale(edge, progress));
    minimumDistanceSquared = Math.min(minimumDistanceSquared, dot(nearest, nearest));
    minimumSide = Math.min(minimumSide, orientation * cross(value, edge));
  }

  return -Math.sqrt(minimumDistanceSquared) * Math.sign(minimumSide);
}

function signedDistanceToCurvedFanEdge(
  point: ElasticVec2,
  start: ElasticVec2,
  end: ElasticVec2,
  startRadius: number,
  endRadius: number,
  edgeConcavity: number,
): number {
  const segment = subtract(end, start);
  const segmentLength = Math.max(length(segment), 0.0001);
  const tangent = scale(segment, 1 / segmentLength);
  let inwardNormal = { x: -tangent.y, y: tangent.x };

  if (dot(scale(start, -1), inwardNormal) < 0) {
    inwardNormal = scale(inwardNormal, -1);
  }

  const progress = clamp(dot(subtract(point, start), tangent) / segmentLength, 0, 1);
  const easedProgress = progress * progress * (3 - 2 * progress);
  const bell = 16 * progress * progress * (1 - progress) * (1 - progress);
  const centerDepth = Math.max(dot(scale(start, -1), inwardNormal), 0);
  const endpointRadius = startRadius + (endRadius - startRadius) * easedProgress;
  const bulgeAmplitude = 0.5 * (startRadius + endRadius)
    + centerDepth * edgeConcavity;
  const curveHeight = -endpointRadius + bulgeAmplitude * bell;
  const radiusDerivative = (endRadius - startRadius) * 6 * progress * (1 - progress);
  const bellDerivative = 32 * progress * (1 - progress) * (1 - 2 * progress);
  const curveDerivative = -radiusDerivative + bulgeAmplitude * bellDerivative;
  const slope = curveDerivative / segmentLength;
  const pointHeight = dot(subtract(point, start), inwardNormal);

  return (curveHeight - pointHeight) / Math.sqrt(1 + slope * slope);
}

function smoothInfluence(influence: number): number {
  const value = clamp(influence, 0, 1);
  return value * value * (3 - 2 * value);
}

function contactSortAngle(item: Contact): number {
  return item.active || item.releaseAge === null
    ? Math.atan2(item.position.y, item.position.x)
    : item.releaseAngle;
}

function buildMembraneLinks(
  items: Contact[],
  metrics: ShapeMetrics,
  controls: ElasticFieldControls,
): ElasticMembraneLink[] {
  if (items.length < 2 || controls.contactFill <= 0) return [];
  const ordered = [...items].sort((first, second) => (
    contactSortAngle(first) - contactSortAngle(second)
  ));
  const links = new Map<string, ElasticMembraneLink>();
  const radiusById = new Map(items.map((item, index) => (
    [item.id, metrics.contactRadii[index]]
  )));

  const addLink = (first: Contact, second: Contact, influence: number): void => {
    const weightedInfluence = clamp(influence * controls.contactFill, 0, 1);
    if (weightedInfluence <= 0.0001) return;
    const key = first.id < second.id
      ? `${first.id}:${second.id}`
      : `${second.id}:${first.id}`;
    const fillTriangle = Math.abs(cross(first.position, second.position))
      > controls.membraneFanThreshold ? 1 : 0;
    const previous = links.get(key);
    if (previous && previous.influence >= weightedInfluence) return;

    links.set(key, {
      start: first.position,
      end: second.position,
      startRadius: radiusById.get(first.id) ?? metrics.seedRadius,
      endRadius: radiusById.get(second.id) ?? metrics.seedRadius,
      influence: weightedInfluence,
      fillTriangle,
    });
  };

  if (ordered.length === 2) {
    addLink(
      ordered[0],
      ordered[1],
      Math.min(ordered[0].influence, ordered[1].influence),
    );
    return [...links.values()];
  }

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const next = ordered[(index + 1) % ordered.length];
    addLink(
      current,
      next,
      Math.min(current.influence, next.influence),
    );
  }

  if (ordered.length > 3) {
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index];
      const previous = ordered[(index - 1 + ordered.length) % ordered.length];
      const next = ordered[(index + 1) % ordered.length];
      addLink(
        previous,
        next,
        Math.min(previous.influence, next.influence) * (1 - current.influence),
      );
    }
  }

  return [...links.values()].slice(0, maxMembraneLinks);
}

function computeShapeMetrics(
  items: Contact[],
  controls: ElasticFieldControls,
): ShapeMetrics {
  const seedRadius = controls.seedRadiusScale;
  const shrinkRange = Math.max(
    controls.contactRadiusShrinkEnd - controls.contactRadiusShrinkStart,
    0.001,
  );
  const contactRadii = items.map((item) => {
    const progress = clamp(
      (length(item.position) - controls.contactRadiusShrinkStart) / shrinkRange,
      0,
      1,
    );
    const easedProgress = progress * progress * (3 - 2 * progress);
    const radiusScale = 1
      - (1 - controls.contactRadiusMinScale) * easedProgress;

    return seedRadius * radiusScale;
  });

  return {
    seedRadius,
    bridgeRadius: seedRadius * controls.bridgeRadiusRatio,
    membraneBridgeRadius: seedRadius * controls.membraneBridgeRadiusRatio,
    contactRadii,
  };
}

function rawShapeDistance(
  position: ElasticVec2,
  items: Contact[],
  membraneLinks: ElasticMembraneLink[],
  metrics: ShapeMetrics,
  controls: ElasticFieldControls,
): number {
  let distanceToShape = length(position) - metrics.seedRadius;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    const influence = smoothInfluence(item.influence);
    const pointDistance = length(subtract(position, item.position))
      - metrics.contactRadii[itemIndex];
    const contactBridgeRadius = Math.min(
      metrics.bridgeRadius,
      metrics.contactRadii[itemIndex] * 0.88,
    );
    const bridgeDistance = distanceToSegment(
      position,
      { x: 0, y: 0 },
      item.position,
    ) - contactBridgeRadius;
    const branchDistance = smoothMinimum(
      pointDistance,
      bridgeDistance,
      controls.fieldSmoothness * 0.72,
    );
    const combinedDistance = smoothMinimum(
      distanceToShape,
      branchDistance,
      controls.fieldSmoothness,
    );
    distanceToShape += (combinedDistance - distanceToShape) * influence;
  }

  for (const link of membraneLinks) {
    let linkDistance = distanceToSegment(position, link.start, link.end)
      - metrics.membraneBridgeRadius;

    if (link.fillTriangle > 0.5) {
      const triangleDistance = signedDistanceToTriangle(
        position,
        { x: 0, y: 0 },
        link.start,
        link.end,
      );
      const roundedTriangleDistance = triangleDistance - metrics.membraneBridgeRadius;
      const curvedEdgeDistance = signedDistanceToCurvedFanEdge(
        position,
        link.start,
        link.end,
        link.startRadius,
        link.endRadius,
        controls.edgeConcavity,
      );
      linkDistance = smoothMaximum(
        roundedTriangleDistance,
        curvedEdgeDistance,
        controls.fieldSmoothness * 0.32,
      );
    }

    const combinedDistance = smoothMinimum(
      distanceToShape,
      linkDistance,
      controls.fieldSmoothness,
    );
    distanceToShape += (combinedDistance - distanceToShape)
      * smoothInfluence(link.influence);
  }

  return distanceToShape;
}

type ContourSegment = {
  start: ElasticVec2;
  end: ElasticVec2;
};

class BoundarySpecCageSolver {
  readonly cage = new Float32Array(maxElasticSpecBoundaryPoints * 4);
  cageCount = 0;
  center: ElasticVec2 = { x: 0, y: 0 };
  revision = 0;

  private readonly values = new Float32Array(specCageGridCellCount);
  private lastSignature = '';
  private previousSeam: ElasticVec2 | null = null;

  constructor() {
    this.writeIdentityCage(48);
  }

  solve(
    items: Contact[],
    membraneLinks: ElasticMembraneLink[],
    metrics: ShapeMetrics,
    controls: ElasticFieldControls,
    contourOffset: number,
  ): void {
    const boundarySamples = Math.round(clamp(
      controls.specBoundarySamples,
      16,
      maxElasticSpecBoundaryPoints,
    ));
    const signature = [
      contourOffset,
      metrics.seedRadius,
      metrics.bridgeRadius,
      metrics.membraneBridgeRadius,
      controls.edgeConcavity,
      controls.fieldSmoothness,
      boundarySamples,
      ...metrics.contactRadii,
      ...items.flatMap((item) => [
        item.position.x,
        item.position.y,
        item.influence,
      ]),
      ...membraneLinks.flatMap((link) => [
        link.start.x,
        link.start.y,
        link.end.x,
        link.end.y,
        link.influence,
        link.fillTriangle,
      ]),
    ].map((value) => value.toFixed(5)).join('|');

    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    const resolution = specCageGridResolution;
    const spacing = specCageGridExtent * 2 / (resolution - 1);
    this.sampleField(
      items,
      membraneLinks,
      metrics,
      controls,
      contourOffset,
      spacing,
    );
    const contour = this.extractPrimaryContour(spacing);

    if (contour.length < 3) {
      this.writeIdentityCage(boundarySamples);
      this.revision += 1;
      return;
    }

    const orderedContour = this.orderContour(contour);
    const boundaryCage = this.resampleContour(orderedContour, boundarySamples);
    const boundaryCoordinates = boundaryCage.map((_, index) => {
      const angle = index / boundaryCage.length * Math.PI * 2;
      return { x: Math.cos(angle), y: Math.sin(angle) };
    });
    const distances = new Float64Array(boundaryCage.length);
    const halfAngleTangents = new Float64Array(boundaryCage.length);
    // RGBA cage texel: deformed boundary xy, matching unit-circle coordinate zw.
    this.cage.fill(0);
    boundaryCage.forEach((point, index) => {
      const coordinate = boundaryCoordinates[index];
      this.cage[index * 4] = point.x;
      this.cage[index * 4 + 1] = point.y;
      this.cage[index * 4 + 2] = coordinate.x;
      this.cage[index * 4 + 3] = coordinate.y;
    });
    this.cageCount = boundaryCage.length;
    this.center = this.meanValueCoordinate(
      { x: 0, y: 0 },
      boundaryCage,
      boundaryCoordinates,
      distances,
      halfAngleTangents,
    );

    this.revision += 1;
  }

  private sampleField(
    items: Contact[],
    membraneLinks: ElasticMembraneLink[],
    metrics: ShapeMetrics,
    controls: ElasticFieldControls,
    contourOffset: number,
    spacing: number,
  ): void {
    const resolution = specCageGridResolution;
    for (let row = 0; row < resolution; row += 1) {
      const y = -specCageGridExtent + row * spacing;
      for (let column = 0; column < resolution; column += 1) {
        const x = -specCageGridExtent + column * spacing;
        const index = row * resolution + column;
        const value = rawShapeDistance(
          { x, y },
          items,
          membraneLinks,
          metrics,
          controls,
        ) - contourOffset;
        this.values[index] = value;
      }
    }
  }

  private extractPrimaryContour(spacing: number): ElasticVec2[] {
    const resolution = specCageGridResolution;
    const segments: ContourSegment[] = [];
    const edgePoint = (
      first: ElasticVec2,
      second: ElasticVec2,
      firstValue: number,
      secondValue: number,
    ): ElasticVec2 => {
      const denominator = firstValue - secondValue;
      const amount = clamp(
        Math.abs(denominator) < 0.000001 ? 0.5 : firstValue / denominator,
        0,
        1,
      );
      return {
        x: first.x + (second.x - first.x) * amount,
        y: first.y + (second.y - first.y) * amount,
      };
    };

    for (let row = 0; row + 1 < resolution; row += 1) {
      const top = -specCageGridExtent + row * spacing;
      const bottom = top + spacing;
      for (let column = 0; column + 1 < resolution; column += 1) {
        const left = -specCageGridExtent + column * spacing;
        const right = left + spacing;
        const topLeftIndex = row * resolution + column;
        const topRightIndex = topLeftIndex + 1;
        const bottomLeftIndex = topLeftIndex + resolution;
        const bottomRightIndex = bottomLeftIndex + 1;
        const values = [
          this.values[topLeftIndex],
          this.values[topRightIndex],
          this.values[bottomRightIndex],
          this.values[bottomLeftIndex],
        ];
        const points = [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
        ];
        const mask = values.reduce(
          (result, value, index) => result | (value <= 0 ? 1 << index : 0),
          0,
        );
        if (mask === 0 || mask === 15) continue;

        const edges = [
          edgePoint(points[0], points[1], values[0], values[1]),
          edgePoint(points[1], points[2], values[1], values[2]),
          edgePoint(points[2], points[3], values[2], values[3]),
          edgePoint(points[3], points[0], values[3], values[0]),
        ];
        const addSegment = (firstEdge: number, secondEdge: number): void => {
          segments.push({ start: edges[firstEdge], end: edges[secondEdge] });
        };
        const centerInside = values.reduce((sum, value) => sum + value, 0) * 0.25 <= 0;

        switch (mask) {
          case 1: addSegment(3, 0); break;
          case 2: addSegment(0, 1); break;
          case 3: addSegment(3, 1); break;
          case 4: addSegment(1, 2); break;
          case 5:
            if (centerInside) {
              addSegment(0, 1);
              addSegment(2, 3);
            } else {
              addSegment(3, 0);
              addSegment(1, 2);
            }
            break;
          case 6: addSegment(0, 2); break;
          case 7: addSegment(3, 2); break;
          case 8: addSegment(2, 3); break;
          case 9: addSegment(0, 2); break;
          case 10:
            if (centerInside) {
              addSegment(3, 0);
              addSegment(1, 2);
            } else {
              addSegment(0, 1);
              addSegment(2, 3);
            }
            break;
          case 11: addSegment(1, 2); break;
          case 12: addSegment(3, 1); break;
          case 13: addSegment(0, 1); break;
          case 14: addSegment(3, 0); break;
          default: break;
        }
      }
    }

    const keyScale = 1 / Math.max(spacing * 0.0001, 0.000001);
    const pointKey = (point: ElasticVec2): string => (
      `${Math.round(point.x * keyScale)},${Math.round(point.y * keyScale)}`
    );
    const pointsByKey = new Map<string, ElasticVec2>();
    const adjacency = new Map<string, Array<{ segment: number; other: string }>>();

    segments.forEach((segment, index) => {
      const startKey = pointKey(segment.start);
      const endKey = pointKey(segment.end);
      pointsByKey.set(startKey, segment.start);
      pointsByKey.set(endKey, segment.end);
      const startLinks = adjacency.get(startKey) ?? [];
      const endLinks = adjacency.get(endKey) ?? [];
      startLinks.push({ segment: index, other: endKey });
      endLinks.push({ segment: index, other: startKey });
      adjacency.set(startKey, startLinks);
      adjacency.set(endKey, endLinks);
    });

    const visited = new Uint8Array(segments.length);
    const loops: ElasticVec2[][] = [];
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      if (visited[segmentIndex] !== 0) continue;
      const startKey = pointKey(segments[segmentIndex].start);
      let currentKey = startKey;
      let currentSegment = segmentIndex;
      const loop: ElasticVec2[] = [];

      for (let guard = 0; guard <= segments.length; guard += 1) {
        if (visited[currentSegment] !== 0) break;
        visited[currentSegment] = 1;
        const point = pointsByKey.get(currentKey);
        if (point) loop.push(point);
        const segment = segments[currentSegment];
        const firstKey = pointKey(segment.start);
        const nextKey = currentKey === firstKey
          ? pointKey(segment.end)
          : firstKey;
        if (nextKey === startKey) {
          if (loop.length >= 3) loops.push(loop);
          break;
        }
        const nextLink = (adjacency.get(nextKey) ?? []).find(
          (link) => visited[link.segment] === 0,
        );
        if (!nextLink) break;
        currentKey = nextKey;
        currentSegment = nextLink.segment;
      }
    }

    const contourArea = (loop: ElasticVec2[]): number => loop.reduce((area, point, index) => {
      const next = loop[(index + 1) % loop.length];
      return area + point.x * next.y - next.x * point.y;
    }, 0) * 0.5;

    return loops.reduce<ElasticVec2[]>((largest, loop) => (
      Math.abs(contourArea(loop)) > Math.abs(contourArea(largest)) ? loop : largest
    ), []);
  }

  private orderContour(contour: ElasticVec2[]): ElasticVec2[] {
    const signedArea = contour.reduce((area, point, index) => {
      const next = contour[(index + 1) % contour.length];
      return area + point.x * next.y - next.x * point.y;
    }, 0) * 0.5;
    const oriented = signedArea >= 0 ? [...contour] : [...contour].reverse();
    let seamIndex = 0;

    if (this.previousSeam) {
      let closestDistance = Number.POSITIVE_INFINITY;
      oriented.forEach((point, index) => {
        const distance = length(subtract(point, this.previousSeam!));
        if (distance < closestDistance) {
          closestDistance = distance;
          seamIndex = index;
        }
      });
    } else {
      oriented.forEach((point, index) => {
        const current = oriented[seamIndex];
        if (point.x > current.x || (point.x === current.x && Math.abs(point.y) < Math.abs(current.y))) {
          seamIndex = index;
        }
      });
    }

    const ordered = [...oriented.slice(seamIndex), ...oriented.slice(0, seamIndex)];
    this.previousSeam = { ...ordered[0] };
    return ordered;
  }

  private resampleContour(contour: ElasticVec2[], sampleCount: number): ElasticVec2[] {
    const segmentLengths = new Float64Array(contour.length);
    let perimeter = 0;
    for (let index = 0; index < contour.length; index += 1) {
      const next = contour[(index + 1) % contour.length];
      const segmentLength = length(subtract(next, contour[index]));
      segmentLengths[index] = segmentLength;
      perimeter += segmentLength;
    }

    const samples: ElasticVec2[] = [];
    let segmentIndex = 0;
    let segmentStartDistance = 0;
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const targetDistance = perimeter * sampleIndex / sampleCount;
      while (
        segmentIndex + 1 < contour.length
        && segmentStartDistance + segmentLengths[segmentIndex] < targetDistance
      ) {
        segmentStartDistance += segmentLengths[segmentIndex];
        segmentIndex += 1;
      }
      const nextIndex = (segmentIndex + 1) % contour.length;
      const segmentLength = Math.max(segmentLengths[segmentIndex], 0.000001);
      const amount = clamp(
        (targetDistance - segmentStartDistance) / segmentLength,
        0,
        1,
      );
      samples.push(add(
        scale(contour[segmentIndex], 1 - amount),
        scale(contour[nextIndex], amount),
      ));
    }

    return samples;
  }

  private meanValueCoordinate(
    point: ElasticVec2,
    cage: ElasticVec2[],
    coordinates: ElasticVec2[],
    distances: Float64Array,
    halfAngleTangents: Float64Array,
  ): ElasticVec2 {
    const vertexEpsilon = 0.000001;

    for (let index = 0; index < cage.length; index += 1) {
      const dx = cage[index].x - point.x;
      const dy = cage[index].y - point.y;
      const distance = Math.hypot(dx, dy);
      distances[index] = distance;
      if (distance <= vertexEpsilon) return coordinates[index];
    }

    for (let index = 0; index < cage.length; index += 1) {
      const nextIndex = (index + 1) % cage.length;
      const firstX = cage[index].x - point.x;
      const firstY = cage[index].y - point.y;
      const secondX = cage[nextIndex].x - point.x;
      const secondY = cage[nextIndex].y - point.y;
      const cross = firstX * secondY - firstY * secondX;
      const pairDot = firstX * secondX + firstY * secondY;

      if (Math.abs(cross) <= vertexEpsilon && pairDot <= 0) {
        const amount = distances[index]
          / Math.max(distances[index] + distances[nextIndex], vertexEpsilon);
        return add(
          scale(coordinates[index], 1 - amount),
          scale(coordinates[nextIndex], amount),
        );
      }

      const denominator = distances[index] * distances[nextIndex] + pairDot;
      halfAngleTangents[index] = Math.abs(denominator) <= 0.0000000001
        ? Math.sign(cross || 1) * 1_000_000
        : cross / denominator;
    }

    let coordinateX = 0;
    let coordinateY = 0;
    let weightSum = 0;
    for (let index = 0; index < cage.length; index += 1) {
      const previousIndex = (index + cage.length - 1) % cage.length;
      const weight = (
        halfAngleTangents[previousIndex] + halfAngleTangents[index]
      ) / Math.max(distances[index], vertexEpsilon);
      coordinateX += coordinates[index].x * weight;
      coordinateY += coordinates[index].y * weight;
      weightSum += weight;
    }

    if (Number.isFinite(weightSum) && Math.abs(weightSum) > 0.00000001) {
      return {
        x: coordinateX / weightSum,
        y: coordinateY / weightSum,
      };
    }

    return this.closestBoundaryCoordinate(point, cage, coordinates);
  }

  private closestBoundaryCoordinate(
    point: ElasticVec2,
    contour: ElasticVec2[],
    coordinates: ElasticVec2[],
  ): ElasticVec2 {
    let closestDistance = Number.POSITIVE_INFINITY;
    let closest = coordinates[0];

    for (let index = 0; index < contour.length; index += 1) {
      const nextIndex = (index + 1) % contour.length;
      const start = contour[index];
      const end = contour[nextIndex];
      const segment = subtract(end, start);
      const segmentLengthSquared = Math.max(dot(segment, segment), 0.000001);
      const amount = clamp(dot(subtract(point, start), segment) / segmentLengthSquared, 0, 1);
      const projection = add(start, scale(segment, amount));
      const distance = length(subtract(point, projection));
      if (distance >= closestDistance) continue;
      closestDistance = distance;
      const startCoordinate = coordinates[index];
      const endCoordinate = coordinates[nextIndex];
      const blended = add(
        scale(startCoordinate, 1 - amount),
        scale(endCoordinate, amount),
      );
      const blendedLength = Math.max(length(blended), 0.000001);
      closest = scale(blended, 1 / blendedLength);
    }

    return closest;
  }

  private writeIdentityCage(sampleCount: number): void {
    this.cage.fill(0);
    this.cageCount = sampleCount;
    for (let index = 0; index < sampleCount; index += 1) {
      const angle = index / sampleCount * Math.PI * 2;
      const x = Math.cos(angle);
      const y = Math.sin(angle);
      this.cage[index * 4] = x;
      this.cage[index * 4 + 1] = y;
      this.cage[index * 4 + 2] = x;
      this.cage[index * 4 + 3] = y;
    }
    this.center = { x: 0, y: 0 };
  }
}

function estimateArea(values: Float32Array, offset: number, cellArea: number): number {
  let insideSamples = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] <= offset) insideSamples += 1;
  }
  return insideSamples * cellArea;
}

function solveContourOffset(
  items: Contact[],
  membraneLinks: ElasticMembraneLink[],
  metrics: ShapeMetrics,
  controls: ElasticFieldControls,
): number {
  if (items.length === 0) {
    return 1 - metrics.seedRadius;
  }

  const farthestContact = items.reduce(
    (maximum, item) => Math.max(maximum, length(item.position)),
    0,
  );
  const boundsRadius = Math.max(1.45, farthestContact + metrics.seedRadius + 0.42);
  const cellSize = (boundsRadius * 2) / areaSampleResolution;
  const cellArea = cellSize * cellSize;
  const values = new Float32Array(areaSampleResolution * areaSampleResolution);
  let valueIndex = 0;

  for (let row = 0; row < areaSampleResolution; row += 1) {
    const y = -boundsRadius + (row + 0.5) * cellSize;
    for (let column = 0; column < areaSampleResolution; column += 1) {
      const x = -boundsRadius + (column + 0.5) * cellSize;
      values[valueIndex] = rawShapeDistance(
        { x, y },
        items,
        membraneLinks,
        metrics,
        controls,
      );
      valueIndex += 1;
    }
  }

  const unconstrainedArea = estimateArea(values, 0, cellArea);
  const expansion = Math.max(unconstrainedArea - baseArea, 0);
  const targetArea = baseArea + expansion * (1 - controls.areaPreservation);
  const minimumNeckRadius = controls.minimumNeckWidth * 0.5;
  const minimumOffset = Math.min(
    minimumNeckRadius - metrics.membraneBridgeRadius,
    0,
  );
  let low = minimumOffset;
  let high = Math.max(0.42, 1 - metrics.seedRadius + 0.16);

  if (estimateArea(values, low, cellArea) > targetArea) {
    return low;
  }

  for (let iteration = 0; iteration < 13; iteration += 1) {
    const midpoint = (low + high) * 0.5;
    const area = estimateArea(values, midpoint, cellArea);
    if (area < targetArea) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }

  return (low + high) * 0.5;
}

export class ElasticContactField {
  private readonly contacts = new Map<number, Contact>();
  private readonly boundarySpecCageSolver = new BoundarySpecCageSolver();
  private contourOffset: number;
  private frame: ElasticShapeFrame;

  constructor(private readonly controls: ElasticFieldControls) {
    this.contourOffset = 1 - controls.seedRadiusScale;
    this.frame = {
      contacts: [],
      membraneLinks: [],
      specWarpCage: this.boundarySpecCageSolver.cage,
      specWarpCageCount: this.boundarySpecCageSolver.cageCount,
      specWarpCageRevision: this.boundarySpecCageSolver.revision,
      specWarpCenter: this.boundarySpecCageSolver.center,
      contactRadius: controls.seedRadiusScale,
      bridgeRadius: controls.seedRadiusScale * controls.bridgeRadiusRatio,
      membraneBridgeRadius: controls.seedRadiusScale
        * controls.membraneBridgeRadiusRatio,
      contourOffset: this.contourOffset,
      edgeConcavity: controls.edgeConcavity,
      fieldSmoothness: controls.fieldSmoothness,
    };
  }

  clear(): void {
    this.contacts.clear();
    this.contourOffset = 1 - this.controls.seedRadiusScale;
  }

  contains(position: ElasticVec2): boolean {
    const items = [...this.contacts.values()].slice(0, maxContacts);
    const metrics = computeShapeMetrics(items, this.controls);
    const links = buildMembraneLinks(items, metrics, this.controls);

    return rawShapeDistance(position, items, links, metrics, this.controls)
      <= this.contourOffset + 0.06;
  }

  addContact(id: number, position: ElasticVec2): boolean {
    if (this.contacts.size >= maxContacts || !this.contains(position)) return false;

    this.contacts.set(id, {
      id,
      anchor: { ...position },
      position: { ...position },
      target: { ...position },
      velocity: { x: 0, y: 0 },
      influence: 0,
      releaseAge: null,
      releaseOffset: { x: 0, y: 0 },
      releaseAngle: Math.atan2(position.y, position.x),
      active: true,
    });
    return true;
  }

  moveContact(id: number, position: ElasticVec2): void {
    const item = this.contacts.get(id);
    if (!item?.active) return;
    const movement = subtract(position, item.position);
    item.velocity = scale(movement, 60);
    item.target = { ...position };
    item.position = { ...position };
  }

  releaseContact(id: number): void {
    const item = this.contacts.get(id);
    if (!item?.active) return;
    item.releaseOffset = subtract(item.position, item.anchor);
    item.releaseAngle = Math.atan2(item.position.y, item.position.x);
    item.active = false;
    item.releaseAge = 0;
    item.target = { ...item.anchor };
    item.velocity = { x: 0, y: 0 };
  }

  update(delta: number): ElasticShapeFrame {
    const angularFrequency = Math.PI * 2 * this.controls.springFrequency;
    const blendStep = this.controls.contactBlendDuration <= 0
      ? 1
      : delta / this.controls.contactBlendDuration;
    const contactsToRemove: number[] = [];

    for (const [id, item] of this.contacts) {
      if (item.active) {
        item.influence = Math.min(1, item.influence + blendStep);
        item.position = { ...item.target };
        continue;
      }

      item.releaseAge = (item.releaseAge ?? 0) + delta;
      const returnScale = (1 + angularFrequency * item.releaseAge)
        * Math.exp(-angularFrequency * item.releaseAge);
      const returnVelocity = -angularFrequency * angularFrequency * item.releaseAge
        * Math.exp(-angularFrequency * item.releaseAge);
      item.position = add(item.anchor, scale(item.releaseOffset, returnScale));
      item.velocity = scale(item.releaseOffset, returnVelocity);

      if (item.releaseAge > this.controls.releaseHoldDuration) {
        const fadeDuration = Math.max(
          this.controls.releaseLifetime - this.controls.releaseHoldDuration,
          0.001,
        );
        const fadeProgress = clamp(
          (item.releaseAge - this.controls.releaseHoldDuration) / fadeDuration,
          0,
          1,
        );
        const easedFade = fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
        item.influence = Math.min(item.influence, 1 - easedFade);
      }

      if (
        item.releaseAge >= this.controls.releaseLifetime
        || (returnScale <= 0.02 && item.influence <= 0.01)
      ) {
        contactsToRemove.push(id);
      }
    }

    for (const id of contactsToRemove) this.contacts.delete(id);

    const items = [...this.contacts.values()].slice(0, maxContacts);
    const metrics = computeShapeMetrics(items, this.controls);
    const membraneLinks = buildMembraneLinks(items, metrics, this.controls);
    const targetOffset = solveContourOffset(items, membraneLinks, metrics, this.controls);
    const pressureBlend = 1 - Math.exp(-this.controls.pressureResponse * delta);
    this.contourOffset += (targetOffset - this.contourOffset) * pressureBlend;
    this.boundarySpecCageSolver.solve(
      items,
      membraneLinks,
      metrics,
      this.controls,
      this.contourOffset,
    );
    this.frame = {
      contacts: items.map((item, index) => ({
        id: item.id,
        anchor: item.anchor,
        position: item.position,
        radius: metrics.contactRadii[index],
        influence: item.influence,
        active: item.active,
      })),
      membraneLinks,
      specWarpCage: this.boundarySpecCageSolver.cage,
      specWarpCageCount: this.boundarySpecCageSolver.cageCount,
      specWarpCageRevision: this.boundarySpecCageSolver.revision,
      specWarpCenter: this.boundarySpecCageSolver.center,
      contactRadius: metrics.seedRadius,
      bridgeRadius: metrics.bridgeRadius,
      membraneBridgeRadius: metrics.membraneBridgeRadius,
      contourOffset: this.contourOffset,
      edgeConcavity: this.controls.edgeConcavity,
      fieldSmoothness: this.controls.fieldSmoothness,
    };

    return this.frame;
  }

  getFrame(): ElasticShapeFrame {
    return this.frame;
  }
}
