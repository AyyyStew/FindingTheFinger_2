export interface CorpusVersionInfo {
  id: number
  translation_name: string | null
  language: string | null
}

export interface CorpusInfo {
  id: number
  name: string
  description: string | null
  taxonomy: string[]
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
}

export interface SearchResponse {
  results: SearchResult[]
  mode: 'semantic' | 'keyword' | 'passage'
}

export interface SemanticSearchRequest {
  query: string
  method_id?: number
  height?: number
  corpus_id?: number
  limit?: number
}

export interface KeywordSearchRequest {
  query: string
  height?: number
  corpus_id?: number
  limit?: number
}

export interface PassageSearchRequest {
  unit_id: number
  method_id?: number
  height?: number
  corpus_id?: number
  limit?: number
  exclude_self?: boolean
}
