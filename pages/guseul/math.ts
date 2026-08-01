export type Vec3 = [number, number, number];

export type Matrix3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

export function normalizeVec3(vector: Vec3): Vec3 {
  const length = Math.hypot(...vector);
  if (length <= 0.000001) return [0, 0, 1];
  return vector.map((component) => component / length) as Vec3;
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function reflectVec3(incident: Vec3, normal: Vec3): Vec3 {
  const amount = 2 * dotVec3(incident, normal);
  return [
    incident[0] - amount * normal[0],
    incident[1] - amount * normal[1],
    incident[2] - amount * normal[2],
  ];
}

export function projectOntoTangent(vector: Vec3, normal: Vec3): Vec3 {
  const normalAmount = dotVec3(vector, normal);
  return normalizeVec3([
    vector[0] - normal[0] * normalAmount,
    vector[1] - normal[1] * normalAmount,
    vector[2] - normal[2] * normalAmount,
  ]);
}

export function multiplyMatrix3(a: Matrix3, b: Matrix3): Matrix3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

export function rotationMatrixFromAxisAngle(axis: Vec3, angle: number): Matrix3 {
  const [x, y, z] = normalizeVec3(axis);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const t = 1 - cosine;

  return [
    t * x * x + cosine,
    t * x * y - sine * z,
    t * x * z + sine * y,
    t * x * y + sine * z,
    t * y * y + cosine,
    t * y * z - sine * x,
    t * x * z - sine * y,
    t * y * z + sine * x,
    t * z * z + cosine,
  ];
}

export function applyMatrix3(matrix: Matrix3, [x, y, z]: Vec3): Vec3 {
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[3] * x + matrix[4] * y + matrix[5] * z,
    matrix[6] * x + matrix[7] * y + matrix[8] * z,
  ];
}
