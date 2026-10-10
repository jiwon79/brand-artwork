import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, PMREMGenerator, Scene, type WebGLRenderer } from 'three';

/** Broad studio panels reflected by the clear coat. This map belongs only to
 * glossy materials, leaving the matte and solid lighting unchanged. */
export function createTubeStudioEnvironment(renderer: WebGLRenderer) {
  const studio = new Scene(), geometry = new PlaneGeometry(1, 1);
  studio.background = new Color('#11131c');
  const panels = [
    { position: [-4, 4, 5], size: [2.5, 9], brightness: 6 },
    { position: [4, 1, 3], size: [1.4, 7], brightness: 2.5 },
    { position: [-1, 6, 0], size: [6, 2], brightness: 3 },
  ] as const;
  const materials = panels.map(({ position, size, brightness }) => {
    const material = new MeshBasicMaterial({ color: new Color().setScalar(brightness), toneMapped: false });
    const panel = new Mesh(geometry, material);
    panel.position.set(position[0], position[1], position[2]);
    panel.scale.set(size[0], size[1], 1); panel.lookAt(0, 0, 0);
    studio.add(panel);
    return material;
  });
  const generator = new PMREMGenerator(renderer);
  try { return generator.fromScene(studio, .025); }
  finally { generator.dispose(); geometry.dispose(); materials.forEach(material => material.dispose()); }
}
