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
  springDamping: number;
  specWarpMode?: 'harmonic' | 'radial';
  specRayDebugEnabled?: boolean;
  specWarpCenterStiffness?: number;
  specWarpContactStiffness?: number;
  specWarpRestStiffness?: number;
  specWarpIterations?: number;
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
  specWarpMap: Float32Array;
  specWarpRevision: number;
  specBoundaryRadii: Float32Array;
  specBoundaryRevision: number;
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
  persistent: boolean;
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
export const elasticSpecWarpResolution = 65;
export const elasticSpecWarpExtent = 3.2;
export const elasticSpecRayCount = 256;
const specWarpCellCount = elasticSpecWarpResolution * elasticSpecWarpResolution;

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
      Math.min(smoothInfluence(ordered[0].influence), smoothInfluence(ordered[1].influence)),
    );
    return [...links.values()];
  }

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const next = ordered[(index + 1) % ordered.length];
    addLink(
      current,
      next,
      Math.min(smoothInfluence(current.influence), smoothInfluence(next.influence)),
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
        Math.min(smoothInfluence(previous.influence), smoothInfluence(next.influence))
          * (1 - smoothInfluence(current.influence)),
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
    const releaseWobble = item.active || item.releaseAge === null
      ? 1
      : 1 + Math.sin(Math.PI * 2 * controls.springFrequency * item.releaseAge)
        * Math.exp(
          -Math.PI * 2 * controls.springFrequency
            * controls.springDamping * item.releaseAge,
        ) * 0.14;

    return seedRadius * radiusScale * releaseWobble;
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
    distanceToShape += (combinedDistance - distanceToShape) * link.influence;
  }

  return distanceToShape;
}

function compactSupport(distance: number, inner: number, outer: number): number {
  const progress = 1 - clamp(
    (distance - inner) / Math.max(outer - inner, 0.0001),
    0,
    1,
  );
  return smoothInfluence(progress);
}

class HarmonicSpecWarpSolver {
  readonly map = new Float32Array(specWarpCellCount * 2);
  revision = 0;

  private displacementX = new Float32Array(specWarpCellCount);
  private displacementY = new Float32Array(specWarpCellCount);
  private nextX = new Float32Array(specWarpCellCount);
  private nextY = new Float32Array(specWarpCellCount);
  private readonly mask = new Uint8Array(specWarpCellCount);
  private readonly constraintWeight = new Float32Array(specWarpCellCount);
  private readonly constraintX = new Float32Array(specWarpCellCount);
  private readonly constraintY = new Float32Array(specWarpCellCount);
  private lastSignature = 'identity';

  constructor() {
    this.writeIdentityMap();
  }

  solve(
    items: Contact[],
    metrics: ShapeMetrics,
    controls: ElasticFieldControls,
  ): Float32Array {
    if (items.length === 0) {
      if (this.lastSignature !== 'identity') {
        this.lastSignature = 'identity';
        this.writeIdentityMap();
        this.revision += 1;
      }
      return this.map;
    }

    const centerStiffness = controls.specWarpCenterStiffness ?? 80;
    const contactStiffness = controls.specWarpContactStiffness ?? 36;
    const restStiffness = controls.specWarpRestStiffness ?? 0.02;
    const iterations = Math.round(clamp(controls.specWarpIterations ?? 4, 2, 32));
    const signature = [
      metrics.seedRadius,
      metrics.bridgeRadius,
      metrics.membraneBridgeRadius,
      centerStiffness,
      contactStiffness,
      restStiffness,
      iterations,
      ...metrics.contactRadii,
      ...items.flatMap((item) => [
        item.anchor.x,
        item.anchor.y,
        item.position.x,
        item.position.y,
        item.influence,
      ]),
    ].map((value) => value.toFixed(5)).join('|');

    if (signature === this.lastSignature) {
      return this.map;
    }
    this.lastSignature = signature;

    const resolution = elasticSpecWarpResolution;
    const spacing = elasticSpecWarpExtent * 2 / (resolution - 1);
    const centerRadius = Math.max(spacing * 2.4, 0.08);
    // The visible SDF still clips the glass. This continuous support only carries
    // material coordinates, so concave contour branches cannot swap underneath it.
    const supportRadius = Math.min(
      elasticSpecWarpExtent - spacing,
      items.reduce((maximum, item, index) => Math.max(
        maximum,
        length(item.position) + metrics.contactRadii[index] + 0.5,
      ), 1.25),
    );

    for (let row = 0; row < resolution; row += 1) {
      const y = -elasticSpecWarpExtent + row * spacing;
      for (let column = 0; column < resolution; column += 1) {
        const x = -elasticSpecWarpExtent + column * spacing;
        const index = row * resolution + column;
        const centerDistance = Math.hypot(x, y);
        this.mask[index] = centerDistance <= supportRadius ? 1 : 0;
        const centerWeight = compactSupport(
          centerDistance,
          centerRadius * 0.24,
          centerRadius,
        ) * centerStiffness;
        let targetWeight = centerWeight;
        let targetX = 0;
        let targetY = 0;
        let initialWeight = 1 / (centerDistance * centerDistance + 0.08);
        let initialX = 0;
        let initialY = 0;

        for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
          const item = items[itemIndex];
          const influence = smoothInfluence(item.influence);
          const distance = Math.hypot(x - item.position.x, y - item.position.y);
          const contactRadius = Math.max(
            metrics.contactRadii[itemIndex] * 0.72,
            spacing * 2.5,
          );
          const contactWeight = compactSupport(
            distance,
            contactRadius * 0.42,
            contactRadius,
          ) * contactStiffness * influence;
          const displacementX = item.position.x - item.anchor.x;
          const displacementY = item.position.y - item.anchor.y;
          targetWeight += contactWeight;
          targetX += displacementX * contactWeight;
          targetY += displacementY * contactWeight;

          const interpolationWeight = influence
            / (distance * distance + contactRadius * contactRadius * 0.38 + 0.01);
          initialWeight += interpolationWeight;
          initialX += displacementX * interpolationWeight;
          initialY += displacementY * interpolationWeight;
        }

        this.constraintWeight[index] = targetWeight;
        this.constraintX[index] = targetWeight > 0 ? targetX / targetWeight : 0;
        this.constraintY[index] = targetWeight > 0 ? targetY / targetWeight : 0;
        this.displacementX[index] = initialX / initialWeight;
        this.displacementY[index] = initialY / initialWeight;
      }
    }

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      for (let row = 0; row < resolution; row += 1) {
        for (let column = 0; column < resolution; column += 1) {
          const index = row * resolution + column;
          if (this.mask[index] === 0) {
            this.nextX[index] = this.displacementX[index];
            this.nextY[index] = this.displacementY[index];
            continue;
          }

          let sumX = 0;
          let sumY = 0;
          let neighborCount = 0;
          const left = index - 1;
          const right = index + 1;
          const top = index - resolution;
          const bottom = index + resolution;
          if (column > 0 && this.mask[left] !== 0) {
            sumX += this.displacementX[left];
            sumY += this.displacementY[left];
            neighborCount += 1;
          }
          if (column + 1 < resolution && this.mask[right] !== 0) {
            sumX += this.displacementX[right];
            sumY += this.displacementY[right];
            neighborCount += 1;
          }
          if (row > 0 && this.mask[top] !== 0) {
            sumX += this.displacementX[top];
            sumY += this.displacementY[top];
            neighborCount += 1;
          }
          if (row + 1 < resolution && this.mask[bottom] !== 0) {
            sumX += this.displacementX[bottom];
            sumY += this.displacementY[bottom];
            neighborCount += 1;
          }

          const constraintWeight = this.constraintWeight[index];
          const denominator = neighborCount + constraintWeight + restStiffness;
          const solvedX = (
            sumX + this.constraintX[index] * constraintWeight
          ) / Math.max(denominator, 0.0001);
          const solvedY = (
            sumY + this.constraintY[index] * constraintWeight
          ) / Math.max(denominator, 0.0001);
          this.nextX[index] = this.displacementX[index]
            + (solvedX - this.displacementX[index]) * 0.92;
          this.nextY[index] = this.displacementY[index]
            + (solvedY - this.displacementY[index]) * 0.92;
        }
      }

      [this.displacementX, this.nextX] = [this.nextX, this.displacementX];
      [this.displacementY, this.nextY] = [this.nextY, this.displacementY];
    }

    for (let row = 0; row < resolution; row += 1) {
      const y = -elasticSpecWarpExtent + row * spacing;
      for (let column = 0; column < resolution; column += 1) {
        const x = -elasticSpecWarpExtent + column * spacing;
        const index = row * resolution + column;
        this.map[index * 2] = x - this.displacementX[index];
        this.map[index * 2 + 1] = y - this.displacementY[index];
      }
    }

    this.revision += 1;
    return this.map;
  }

  private writeIdentityMap(): void {
    const resolution = elasticSpecWarpResolution;
    const spacing = elasticSpecWarpExtent * 2 / (resolution - 1);
    for (let row = 0; row < resolution; row += 1) {
      const y = -elasticSpecWarpExtent + row * spacing;
      for (let column = 0; column < resolution; column += 1) {
        const x = -elasticSpecWarpExtent + column * spacing;
        const index = row * resolution + column;
        this.map[index * 2] = x;
        this.map[index * 2 + 1] = y;
      }
    }
  }
}

class RadialSpecBoundarySampler {
  readonly radii = new Float32Array(elasticSpecRayCount).fill(1);
  revision = 0;

  private lastSignature = '';

  solve(
    items: Contact[],
    membraneLinks: ElasticMembraneLink[],
    metrics: ShapeMetrics,
    controls: ElasticFieldControls,
    contourOffset: number,
  ): Float32Array {
    const signature = [
      contourOffset,
      metrics.seedRadius,
      metrics.bridgeRadius,
      metrics.membraneBridgeRadius,
      controls.edgeConcavity,
      controls.fieldSmoothness,
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

    if (signature === this.lastSignature) return this.radii;
    this.lastSignature = signature;

    const farthestContact = items.reduce((maximum, item, index) => Math.max(
      maximum,
      length(item.position) + metrics.contactRadii[index],
    ), 1);
    const initialSearchRadius = Math.max(
      1.4,
      farthestContact + Math.max(contourOffset, 0) + controls.fieldSmoothness + 0.7,
    );
    const raySearchSteps = 48;
    const binarySearchSteps = 10;
    const tau = Math.PI * 2;

    for (let rayIndex = 0; rayIndex < elasticSpecRayCount; rayIndex += 1) {
      const angle = ((rayIndex + 0.5) / elasticSpecRayCount) * tau - Math.PI;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      let searchRadius = initialSearchRadius;
      let outsideDistance = rawShapeDistance(
        scale(direction, searchRadius),
        items,
        membraneLinks,
        metrics,
        controls,
      ) - contourOffset;

      for (let expansion = 0; expansion < 4 && outsideDistance <= 0; expansion += 1) {
        searchRadius *= 1.5;
        outsideDistance = rawShapeDistance(
          scale(direction, searchRadius),
          items,
          membraneLinks,
          metrics,
          controls,
        ) - contourOffset;
      }

      let outsideRadius = searchRadius;
      let insideRadius = 0;
      let foundBoundary = false;
      let radius = searchRadius;
      let distance = outsideDistance;
      const minimumStep = searchRadius / 1024;

      // Trace inward from guaranteed empty space. The field distance lets most
      // rays reach their outermost boundary in a handful of evaluations.
      for (let step = 0; step < raySearchSteps; step += 1) {
        if (distance <= 0) {
          insideRadius = radius;
          foundBoundary = true;
          break;
        }

        outsideRadius = radius;
        radius = Math.max(radius - Math.max(distance * 0.6, minimumStep), 0);
        distance = rawShapeDistance(
          scale(direction, radius),
          items,
          membraneLinks,
          metrics,
          controls,
        ) - contourOffset;
      }

      if (!foundBoundary) {
        this.radii[rayIndex] = Math.max(metrics.seedRadius + contourOffset, 0.001);
        continue;
      }

      for (let step = 0; step < binarySearchSteps; step += 1) {
        const radius = (insideRadius + outsideRadius) * 0.5;
        const distance = rawShapeDistance(
          scale(direction, radius),
          items,
          membraneLinks,
          metrics,
          controls,
        ) - contourOffset;

        if (distance <= 0) insideRadius = radius;
        else outsideRadius = radius;
      }

      this.radii[rayIndex] = Math.max((insideRadius + outsideRadius) * 0.5, 0.001);
    }

    this.revision += 1;
    return this.radii;
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
  private readonly specWarpSolver = new HarmonicSpecWarpSolver();
  private readonly specBoundarySampler = new RadialSpecBoundarySampler();
  private contourOffset: number;
  private frame: ElasticShapeFrame;

  constructor(private readonly controls: ElasticFieldControls) {
    this.contourOffset = 1 - controls.seedRadiusScale;
    this.frame = {
      contacts: [],
      membraneLinks: [],
      specWarpMap: this.specWarpSolver.map,
      specWarpRevision: this.specWarpSolver.revision,
      specBoundaryRadii: this.specBoundarySampler.radii,
      specBoundaryRevision: this.specBoundarySampler.revision,
      contactRadius: controls.seedRadiusScale,
      bridgeRadius: controls.seedRadiusScale * controls.bridgeRadiusRatio,
      membraneBridgeRadius: controls.seedRadiusScale
        * controls.membraneBridgeRadiusRatio,
      contourOffset: this.contourOffset,
      edgeConcavity: controls.edgeConcavity,
      fieldSmoothness: controls.fieldSmoothness,
    };
  }

  hasContacts(): boolean {
    return this.contacts.size > 0;
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

  addContact(id: number, position: ElasticVec2, persistent = false): boolean {
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
      persistent,
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
    if (!item?.active || item.persistent) return;
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

      const returnGate = smoothInfluence(clamp((returnScale - 0.04) / 0.31, 0, 1));
      item.influence = Math.min(item.influence, returnGate);

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
    const specWarpMode = this.controls.specWarpMode ?? 'harmonic';
    const specWarpMap = specWarpMode === 'harmonic'
      ? this.specWarpSolver.solve(items, metrics, this.controls)
      : this.specWarpSolver.map;
    const specBoundaryRadii = specWarpMode === 'radial' || this.controls.specRayDebugEnabled
      ? this.specBoundarySampler.solve(
        items,
        membraneLinks,
        metrics,
        this.controls,
        this.contourOffset,
      )
      : this.specBoundarySampler.radii;
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
      specWarpMap,
      specWarpRevision: this.specWarpSolver.revision,
      specBoundaryRadii,
      specBoundaryRevision: this.specBoundarySampler.revision,
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
