import { useMemo, useState } from 'react';

export function useFindReplace(
  content: string,
  setContent: (next: string) => void,
  onProgrammaticChange?: () => void,
) {
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceValue, setReplaceValue] = useState('');

  const findMatchCount = useMemo(() => {
    if (!findQuery) return 0;
    const escaped = escapeRegExp(findQuery);
    return Array.from(content.matchAll(new RegExp(escaped, 'gi'))).length;
  }, [content, findQuery]);

  const replaceFirst = () => {
    if (!findQuery) return;
    const index = content.toLowerCase().indexOf(findQuery.toLowerCase());
    if (index < 0) return;
    setContent(`${content.slice(0, index)}${replaceValue}${content.slice(index + findQuery.length)}`);
    onProgrammaticChange?.();
  };

  const replaceAll = () => {
    if (!findQuery) return;
    setContent(content.replace(new RegExp(escapeRegExp(findQuery), 'gi'), replaceValue));
    onProgrammaticChange?.();
  };

  return {
    findOpen,
    setFindOpen,
    findQuery,
    setFindQuery,
    replaceValue,
    setReplaceValue,
    findMatchCount,
    replaceFirst,
    replaceAll,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
