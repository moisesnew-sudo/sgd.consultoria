import React, { useMemo } from 'react';
import { normalize } from '../../lib/search';

interface HighlightProps {
  text: string;
  terms?: (string | undefined)[];
  className?: string;
}

interface Range {
  start: number;
  end: number;
}

function findMatches(text: string, term: string): Range[] {
  const t = normalize(term);
  if (!t || !text) return [];
  const nText = normalize(text);
  if (!nText.includes(t)) return [];

  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    positions.push(i);
  }
  const searchText = nText;
  const out: Range[] = [];
  let idx = searchText.indexOf(t);
  while (idx !== -1) {
    const start = positions[idx];
    const endChar = positions[idx + t.length - 1];
    out.push({ start, end: endChar + 1 });
    idx = searchText.indexOf(t, idx + 1);
  }
  return out;
}

function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

export function Highlight({ text, terms = [], className = '' }: HighlightProps) {
  const cleanTerms = useMemo(() => {
    const seen = new Set<string>();
    return (terms.filter(Boolean) as string[])
      .map(t => normalize(t))
      .filter(t => {
        if (!t || seen.has(t)) return false;
        seen.add(t);
        return true;
      });
  }, [terms]);

  const ranges = useMemo(() => {
    if (cleanTerms.length === 0 || !text) return [];
    const all: Range[] = [];
    for (const t of cleanTerms) {
      all.push(...findMatches(text, t));
    }
    return mergeRanges(all);
  }, [text, cleanTerms]);

  if (ranges.length === 0) {
    return <>{text}</>;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) parts.push(text.slice(cursor, r.start));
    parts.push(
      <mark
        key={`${r.start}-${r.end}`}
        className={`bg-amber-200/80 dark:bg-amber-400/30 text-inherit rounded-[3px] px-0.5 ${className}`}
      >
        {text.slice(r.start, r.end)}
      </mark>
    );
    cursor = r.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <>{parts}</>;
}
