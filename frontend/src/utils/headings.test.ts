import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseHeadings,
  scrollToHeadingLine,
} from './headings';

describe('heading outline keys', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('creates stable keys from source line and slug identity', () => {
    const headings = parseHeadings([
      '# Intro',
      '',
      '## Install',
      '',
      '## Install',
    ].join('\n'));

    expect(headings.map((heading) => heading.key)).toEqual([
      '0-intro',
      '2-install',
      '4-install-1',
    ]);
  });

  it('scrolls to the matching DOM heading when extra rendered headings shift ordinal order', () => {
    const content = [
      '# Alpha',
      '',
      '## Beta',
      '',
      '### Gamma',
    ].join('\n');
    const headings = parseHeadings(content);

    document.body.innerHTML = `
      <div class="typora-editor">
        <div class="ProseMirror">
          <h1>Alpha</h1>
          <h2>Inserted by editor chrome</h2>
          <h2>Beta</h2>
          <h3>Gamma</h3>
        </div>
      </div>
    `;

    const beta = document.querySelector<HTMLElement>('h2');
    const realBeta = Array.from(document.querySelectorAll<HTMLElement>('h2'))[1];
    const inserted = Array.from(document.querySelectorAll<HTMLElement>('h2'))[0];
    const gamma = document.querySelector<HTMLElement>('h3');
    if (!beta || !realBeta || !inserted || !gamma) throw new Error('Missing DOM headings');

    inserted.scrollIntoView = vi.fn();
    realBeta.scrollIntoView = vi.fn();
    gamma.scrollIntoView = vi.fn();

    scrollToHeadingLine(headings[1].line, content, undefined, headings[1]);

    expect(realBeta.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(inserted.scrollIntoView).not.toHaveBeenCalled();
    expect(gamma.scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector('[data-outline-key]')).toBeNull();
  });

  it('keeps duplicate heading jumps aligned by occurrence', () => {
    const content = [
      '# Alpha',
      '',
      '## Install',
      '',
      '## Install',
    ].join('\n');
    const headings = parseHeadings(content);

    document.body.innerHTML = `
      <div class="typora-editor">
        <div class="ProseMirror">
          <h1>Alpha</h1>
          <h2>Install</h2>
          <h2>Install</h2>
        </div>
      </div>
    `;

    const installs = Array.from(document.querySelectorAll<HTMLElement>('h2'));
    installs.forEach((element) => {
      element.scrollIntoView = vi.fn();
    });

    scrollToHeadingLine(headings[2].line, content, undefined, headings[2]);

    expect(installs[0].scrollIntoView).not.toHaveBeenCalled();
    expect(installs[1].scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('falls back to ordinal scrolling when no keyed DOM heading is available', () => {
    const content = [
      '# Alpha',
      '',
      '## Beta',
    ].join('\n');
    const headings = parseHeadings(content);

    document.body.innerHTML = `
      <div class="typora-editor">
        <div class="ProseMirror">
          <h1>Alpha</h1>
          <h2>Beta</h2>
        </div>
      </div>
    `;

    const beta = document.querySelector<HTMLElement>('h2');
    const alpha = document.querySelector<HTMLElement>('h1');
    if (!beta || !alpha) throw new Error('Missing DOM headings');

    beta.scrollIntoView = vi.fn();
    alpha.scrollIntoView = vi.fn();

    scrollToHeadingLine(headings[1].line, content, undefined, headings[1]);

    expect(beta.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(alpha.scrollIntoView).not.toHaveBeenCalled();
  });
});
