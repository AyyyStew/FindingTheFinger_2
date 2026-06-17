export type SemanticSearchGrouping = 'global' | 'per_corpus'

export const SEMANTIC_SEARCH_GROUPINGS: SemanticSearchGrouping[] = ['global', 'per_corpus']

export const SEMANTIC_SEARCH_GROUPING_LABELS: Record<SemanticSearchGrouping, string> = {
  global: 'Top matches overall',
  per_corpus: 'Best match per corpus',
}
