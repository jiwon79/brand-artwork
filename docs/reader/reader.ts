import { renderMarkdown } from './markdown';
import './style.css';
import { preventDragSelection } from '../../common/drag-selection';

export function mountDocument(source: string, options: { sourcePath: string; images?: Record<string, string>; demos: Record<string, () => HTMLElement> }) {
  const article = document.querySelector<HTMLElement>('#document')!;
  article.innerHTML = renderMarkdown(source, options.images ?? {}, options.sourcePath);

  const placeholders: Comment[] = [];
  const comments = document.createTreeWalker(article, NodeFilter.SHOW_COMMENT);
  while (comments.nextNode()) placeholders.push(comments.currentNode as Comment);
  for (const comment of placeholders) {
    const name = /^\s*interactive-demo: ([a-z-]+)\s*$/.exec(comment.data)?.[1];
    if (name && options.demos[name]) comment.replaceWith(options.demos[name]());
  }
  for (const demo of article.querySelectorAll<HTMLElement>('.interactive-demo')) {
    demo.querySelector('.demo-heading .eyebrow')?.remove();
    // Keep live readouts and controls together without extra explanatory footers.
    demo.querySelectorAll(':scope > p.demo-note:not([aria-live]):not(.relief-calculation)').forEach(note => note.remove());
  }
  article.querySelectorAll<HTMLElement>('canvas, .interactive-demo input[type="range"]').forEach(preventDragSelection);

  // Keep wide tables locally scrollable instead of stretching the mobile page.
  for (const table of article.querySelectorAll('table')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', `${table.previousElementSibling?.textContent?.slice(0, 80) ?? '문서'} 표`);
    table.before(wrapper); wrapper.append(table);
  }

  const navigation = document.querySelector('#contents')!;
  const headings = [...article.querySelectorAll<HTMLHeadingElement>('h2')];
  headings.forEach((heading, index) => {
    heading.id = `section-${index + 1}`;
    const anchor = document.createElement('a');
    anchor.href = `#${heading.id}`;
    anchor.textContent = heading.textContent;
    navigation.append(anchor);
  });
  // Observe every heading with a single observer.
  const observer = new IntersectionObserver(entries => {
    const visible = entries.find(entry => entry.isIntersecting);
    if (!visible) return;
    navigation.querySelector('[aria-current]')?.removeAttribute('aria-current');
    navigation.querySelector(`[href="#${visible.target.id}"]`)?.setAttribute('aria-current', 'location');
  }, { rootMargin: '-5% 0px -75% 0px' });
  headings.forEach(heading => observer.observe(heading));

  // Hash navigation also works on the first load, after the Markdown is mounted.
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();

}
