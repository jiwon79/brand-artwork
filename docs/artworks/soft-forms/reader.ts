/// <reference types="vite/client" />
import source from './architecture.md?raw';
import pipelineImage from '../../assets/soft-forms-frame-pipeline.svg?url';
import { renderMarkdown } from './markdown';
import { createRibbonDemo, createShellDemo } from './demos';
import 'katex/dist/katex.min.css';
import './style.css';

const article = document.querySelector<HTMLElement>('#document')!;
article.innerHTML = renderMarkdown(source, { '/docs/assets/soft-forms-frame-pipeline.svg': pipelineImage });

const placeholders: Comment[] = [];
const comments = document.createTreeWalker(article, NodeFilter.SHOW_COMMENT);
while (comments.nextNode()) placeholders.push(comments.currentNode as Comment);
for (const comment of placeholders) {
  const name = /^\s*interactive-demo: (shells|ribbons)\s*$/.exec(comment.data)?.[1];
  if (name) comment.replaceWith(name === 'shells' ? createShellDemo() : createRibbonDemo());
}

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
