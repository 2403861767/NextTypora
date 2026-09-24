import { useCallback, useEffect, useState } from 'react';
import { describeError, getSearchIndexStatus, searchNotes } from '../api';
import type { SearchIndexStatus, SearchResult, SearchSort } from '../types';

const SEARCH_PAGE_SIZE = 12;

export function useSearchPanel(showError: (message: string) => void) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchSort, setSearchSort] = useState<SearchSort>('relevance');
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [indexStatus, setIndexStatus] = useState<SearchIndexStatus | null>(null);

  const refreshIndexStatus = useCallback(async () => {
    try {
      setIndexStatus(await getSearchIndexStatus());
    } catch {
      setIndexStatus(null);
    }
  }, []);

  const runSearch = useCallback(async (offset = searchOffset, sort = searchSort) => {
    try {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        setSearchTotal(0);
        return;
      }

      setSearchLoading(true);
      const response = await searchNotes({
        q: searchQuery.trim(),
        sort,
        limit: SEARCH_PAGE_SIZE,
        offset,
      });
      setSearchResults(response.results);
      setSearchTotal(response.total);
      setSearchOffset(response.offset);
      setSearchSort(response.sort);
    } catch (e) {
      showError(describeError(e, '搜索失败'));
    } finally {
      setSearchLoading(false);
    }
  }, [searchOffset, searchQuery, searchSort, showError]);

  const handleSearch = useCallback(async () => {
    setSearchOffset(0);
    await refreshIndexStatus();
    await runSearch(0, searchSort);
  }, [refreshIndexStatus, runSearch, searchSort]);

  const handleSearchSortChange = useCallback(async (sort: SearchSort) => {
    setSearchSort(sort);
    setSearchOffset(0);
    await runSearch(0, sort);
  }, [runSearch]);

  const handleSearchPageChange = useCallback(async (nextOffset: number) => {
    await runSearch(Math.max(0, nextOffset), searchSort);
  }, [runSearch, searchSort]);

  const clearSearchResults = useCallback(() => {
    setSearchResults([]);
    setSearchTotal(0);
    setSearchOffset(0);
  }, []);

  useEffect(() => {
    if (!searchOpen) return undefined;
    void refreshIndexStatus();
    const timer = window.setInterval(() => {
      void refreshIndexStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshIndexStatus, searchOpen]);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    clearSearchResults,
    searchOpen,
    setSearchOpen,
    handleSearch,
    searchSort,
    setSearchSort: handleSearchSortChange,
    searchOffset,
    searchTotal,
    searchPageSize: SEARCH_PAGE_SIZE,
    searchLoading,
    indexStatus,
    refreshSearch: runSearch,
    setSearchOffset: handleSearchPageChange,
  };
}
