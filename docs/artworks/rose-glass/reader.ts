/// <reference types="vite/client" />
import source from './architecture.md?raw';
import { mountDocument } from '../../reader/reader';
import { createDragDemo, createMaterialDemo } from './demos';
import './style.css';
import { createPixelDemo } from './pixel-demos';
import { createOutlineDemo } from './outline-demo';
import { createReliefDemo } from './relief-demo';
import { createDeformationDemo } from './deformation-demo';

mountDocument(source, {
  sourcePath: '/docs/artworks/rose-glass/architecture.md',
  demos: { 'shape-pixels': () => createPixelDemo('shape'), 'shading-pixels': () => createPixelDemo('shading'), 'edge-pixels': () => createPixelDemo('edge'), outline: createOutlineDemo, relief: createReliefDemo, material: createMaterialDemo, deformation: createDeformationDemo, drag: createDragDemo },
});
