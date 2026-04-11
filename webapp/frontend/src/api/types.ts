export interface CorpusVersionInfo {
  id: number
  translation_name: string | null
  language: string | null
}

export interface TaxonomyLabel {
  id: number
  name: string
  level: number
  parent_id: number | null
}

export interface CorpusLevelInfo {
  height: number
  name: string
}

export interface CorpusInfo {
  id: number
  name: string
  description: string | null
  taxonomy: TaxonomyLabel[]
  levels: CorpusLevelInfo[]
  versions: CorpusVersionInfo[]
}

export interface MethodInfo {
  id: number
  model_name: string
  label: string
  description: string | null
  vector_dim: number
}

export interface UnitBrief {
  id: number
  text: string | null
  reference_label: string | null
  ancestor_path: string | null
  corpus_name: string
  corpus_version_name: string | null
  height: number | null
  depth: number
  taxonomy: TaxonomyLabel[]
}

export interface UnitChildPreview extends UnitBrief {
  first_child: UnitBrief | null
  child_count: number
}

export interface SearchResult {
  id: number
  text: string | null
  reference_label: string | null
  ancestor_path: string | null
  corpus_name: string
  corpus_version_name: string | null
  height: number | null
  score: number
  taxonomy: TaxonomyLabel[]
}

export interface SearchResponse {
  results: SearchResult[]
  mode: 'semantic' | 'keyword' | 'passage'
}

export interface SemanticSearchRequest {
  query: string
  method_id?: number
  height_min?: number
  height_max?: number
  corpus_ids?: number[]
  limit?: number
}

export interface KeywordSearchRequest {
  query: string
  corpus_ids?: number[]
  limit?: number
}

export interface PassageSearchRequest {
  unit_id: number
  method_id?: number
  height_min?: number
  height_max?: number
  corpus_ids?: number[]
  limit?: number
  exclude_self?: boolean
}
