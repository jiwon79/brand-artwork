/** Minimal SVG DOM for rasterizing the shipped view in Node tests. */
export class SVGNode {
  attributes = new Map<string, string>();
  children: SVGNode[] = [];
  style: Record<string, string> = {};
  textContent = '';
  writes = 0;
  private parent: SVGNode | undefined;
  constructor(readonly tag: string) {}
  get id() { return this.attributes.get('id') ?? ''; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); this.writes++; }
  private detach(child: SVGNode) {
    if (child.parent) child.parent.children = child.parent.children.filter(node => node !== child);
    child.parent = this;
  }
  append(...children: SVGNode[]) {
    for (const child of children) { this.detach(child); this.children.push(child); }
  }
  prepend(...children: SVGNode[]) {
    for (const child of children) this.detach(child);
    this.children.unshift(...children);
  }
  insertBefore(child: SVGNode, reference: SVGNode) {
    this.detach(child); this.children.splice(this.children.indexOf(reference), 0, child);
  }
  replaceChildren(...children: SVGNode[]) {
    for (const child of this.children) child.parent = undefined;
    this.children = []; this.append(...children);
  }
  get outerHTML(): string {
    const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const styles = Object.entries(this.style).map(([key, value]) => `${key}:${value}`).join(';');
    const attributes = [...this.attributes].map(([key, value]) => `${key}="${escape(value)}"`).join(' ');
    return `<${this.tag} ${attributes}${styles ? ` style="${styles}"` : ''}>${escape(this.textContent)}${this.children.map(child => child.outerHTML).join('')}</${this.tag}>`;
  }
  all(): SVGNode[] { return [this, ...this.children.flatMap(child => child.all())]; }
}

export const svgNode = (element: SVGElement) => element as unknown as SVGNode;
export const svgDocument = () => ({
  documentElement: { style: {} },
  createElementNS: (_: string, tag: string) => new SVGNode(tag),
});
