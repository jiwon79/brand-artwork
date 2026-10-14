/// <reference types="vite/client" />
import source from './architecture.md?raw';
import { mountDocument } from '../../reader/reader';
import { createDragDemo, createMaterialDemo } from './demos';
import './style.css';

mountDocument(source, {
  sourcePath: '/docs/artworks/rose-glass/architecture.md',
  demos: { material: createMaterialDemo, drag: createDragDemo },
});
