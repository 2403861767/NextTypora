import { LeftOutlined, RightOutlined, SyncOutlined } from '@ant-design/icons';
import { Button, Select } from 'antd';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { SearchIndexStatus, SearchResult, SearchSort } from '../types';
import { fadeSoftMotion, listItemEnterMotion } from '../utils/motionPresets';

interface SearchResultsPanelProps {
  query: string;
  results: SearchResult[];
  total: number;
  offset: number;
  pageSize: number;
  sort: SearchSort;
  loading: boolean;
  indexStatus: SearchIndexStatus | null;
  onSortChange: (sort: SearchSort) => void;
  onPageChange: (offset: number) => void;
  onSelect: (path: string) => void;
  onClear: () => void;
}

const sortOptions: Array<{ label: string; value: SearchSort }> = [
  { label: '相关性', value: 'relevance' },
  { label: '更新时间', value: 'updatedAt' },
  { label: '路径', value: 'path' },
];

export function SearchResultsPanel({
  query,
  results,
  total,
  offset,
  pageSize,
  sort,
  loading,
  indexStatus,
  onSortChange,
  onPageChange,
  onSelect,
  onClear,
}: SearchResultsPanelProps) {
  const reduceMotion = useReducedMotion();
  const hasQuery = query.trim().length > 0;
  const currentPageEnd = Math.min(offset + results.length, total);
  const canPrev = offset > 0;
  const canNext = offset + pageSize < total;

  return (
    <div className="search-results-panel" aria-live="polite">
      <div className="search-results-header">
        <div className="search-results-summary">
          <span className="search-results-title">搜索结果</span>
          {hasQuery && (
            <span className="search-results-count">
              {loading ? '搜索中…' : `${total} 个命中`}
            </span>
          )}
        </div>
        <Select
          size="small"
          value={sort}
          options={sortOptions}
          onChange={onSortChange}
          className="search-sort-select"
          aria-label="搜索排序"
        />
      </div>

      <AnimatePresence initial={false}>
      {indexStatus?.indexing && (
        <motion.div className="search-index-status" {...fadeSoftMotion}>
          <SyncOutlined spin />
          <span>正在索引 {indexStatus.indexedFiles}/{indexStatus.totalFiles || '?'} 个文件</span>
        </motion.div>
      )}
      {indexStatus && !indexStatus.indexing && ((indexStatus.failedFiles ?? 0) > 0 || (indexStatus.skippedFiles ?? 0) > 0) && (
        <motion.div className="search-index-status search-index-warning" {...fadeSoftMotion}>
          <span>
            索引完成，跳过 {indexStatus.skippedFiles ?? 0} 个大文件，失败 {indexStatus.failedFiles ?? 0} 个文件。
          </span>
        </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
      {!hasQuery ? (
        <motion.div key="empty-query" className="search-empty-state" {...fadeSoftMotion}>输入关键词后按 Enter 搜索当前工作区。</motion.div>
      ) : results.length === 0 && !loading ? (
        <motion.div key="empty-results" className="search-empty-state" {...fadeSoftMotion}>没有找到匹配笔记。</motion.div>
      ) : (
        <motion.div key="results" className="search-results" {...fadeSoftMotion}>
          <AnimatePresence initial={false}>
          {results.map((note, index) => (
            <motion.button
              key={`${note.path}:${note.lineNumber ?? 'path'}`}
              {...listItemEnterMotion(index, reduceMotion ?? false)}
              type="button"
              className="search-result-item"
              onClick={() => onSelect(note.path)}
            >
              <span className="search-result-title-row">
                <span className="search-result-title">{note.title || note.path}</span>
                {typeof note.lineNumber === 'number' && (
                  <span className="search-result-line">L{note.lineNumber}</span>
                )}
              </span>
              <span className="search-result-path">{note.path}</span>
              {note.snippet && (
                <span className="search-result-snippet">
                  <HighlightedSnippet text={note.snippet} query={query} />
                </span>
              )}
            </motion.button>
          ))}
          </AnimatePresence>
        </motion.div>
      )}
      </AnimatePresence>

      <div className="search-results-footer">
        <Button type="text" size="small" onClick={onClear}>清除</Button>
        <span className="search-page-meta">
          {total > 0 ? `${offset + 1}-${currentPageEnd} / ${total}` : '0 / 0'}
        </span>
        <Button
          type="text"
          size="small"
          icon={<LeftOutlined />}
          disabled={!canPrev || loading}
          onClick={() => onPageChange(Math.max(0, offset - pageSize))}
          aria-label="上一页搜索结果"
        />
        <Button
          type="text"
          size="small"
          icon={<RightOutlined />}
          disabled={!canNext || loading}
          onClick={() => onPageChange(offset + pageSize)}
          aria-label="下一页搜索结果"
        />
      </div>
    </div>
  );
}

function HighlightedSnippet({ text, query }: { text: string; query: string }) {
  const pieces = snippetToPieces(text, query);

  return (
    <>
      {pieces.map((piece, index) => (
        piece.hit ? <mark key={`${piece.value}-${index}`}>{piece.value}</mark> : <span key={`${piece.value}-${index}`}>{piece.value}</span>
      ))}
    </>
  );
}

export function snippetToPieces(text: string, query: string): Array<{ value: string; hit: boolean }> {
  const markedPieces = snippetMarkedPieces(text);
  if (markedPieces.length > 0) return markedPieces;

  const token = query.trim();
  if (!token) return [{ value: text, hit: false }];

  const lowerText = text.toLowerCase();
  const lowerToken = token.toLowerCase();
  const pieces: Array<{ value: string; hit: boolean }> = [];
  let cursor = 0;
  let index = lowerText.indexOf(lowerToken);

  while (index >= 0) {
    if (index > cursor) {
      pieces.push({ value: text.slice(cursor, index), hit: false });
    }
    pieces.push({ value: text.slice(index, index + token.length), hit: true });
    cursor = index + token.length;
    index = lowerText.indexOf(lowerToken, cursor);
  }

  if (cursor < text.length) {
    pieces.push({ value: text.slice(cursor), hit: false });
  }

  return pieces.length > 0 ? pieces : [{ value: text, hit: false }];
}

function snippetMarkedPieces(text: string): Array<{ value: string; hit: boolean }> {
  const markPattern = /<mark>(.*?)<\/mark>/gis;
  const pieces: Array<{ value: string; hit: boolean }> = [];
  let cursor = 0;
  let match = markPattern.exec(text);

  while (match) {
    if (match.index > cursor) {
      pieces.push({ value: decodeSnippetEntities(text.slice(cursor, match.index)), hit: false });
    }
    pieces.push({ value: decodeSnippetEntities(match[1] ?? ''), hit: true });
    cursor = match.index + match[0].length;
    match = markPattern.exec(text);
  }

  if (cursor < text.length) {
    pieces.push({ value: decodeSnippetEntities(text.slice(cursor)), hit: false });
  }

  return pieces;
}

function decodeSnippetEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
