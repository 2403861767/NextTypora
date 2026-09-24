import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchResultsPanel } from './SearchResultsPanel';

describe('SearchResultsPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders markup in titles, paths and snippets as inert text', () => {
    const payload = `<script>alert('XSS')</script>`;
    const { container } = render(
      <SearchResultsPanel
        query="payload"
        results={[{
          path: `${payload}.md`,
          title: payload,
          snippet: '&lt;script&gt;alert(&#39;XSS&#39;)&lt;/script&gt; &lt;img src=x onerror=&quot;alert(1)&quot;&gt; <mark>payload</mark>',
          lineNumber: 1,
        }]}
        total={1}
        offset={0}
        pageSize={20}
        sort="relevance"
        loading={false}
        indexStatus={null}
        onSortChange={vi.fn()}
        onPageChange={vi.fn()}
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(container.querySelector('script, img')).toBeNull();
    expect(container.querySelector('.search-result-title')?.textContent).toBe(payload);
    expect(container.querySelector('.search-result-path')?.textContent).toBe(`${payload}.md`);
    expect(container.querySelector('.search-result-snippet')?.textContent)
      .toBe(`${payload} <img src=x onerror="alert(1)"> payload`);
    expect(container.querySelectorAll('.search-result-snippet mark')).toHaveLength(1);
  });
});
