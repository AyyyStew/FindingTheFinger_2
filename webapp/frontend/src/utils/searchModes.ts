export type SearchMode = 'semantic' | 'keyword' | 'passage';

export const SEARCH_MODES: SearchMode[] = ['semantic', 'keyword', 'passage'];

export const SEARCH_MODE_LABELS: Record<SearchMode, string> = {
  semantic: 'Semantic',
  keyword: 'Keyword',
  passage: 'Passage',
};

export const SEARCH_MODE_BADGES: Record<SearchMode, string> = {
  semantic: 'sem',
  keyword: 'kw',
  passage: 'psg',
};
