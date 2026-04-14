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

export interface EmbeddingProfileInfo {
  id: number
  label: string
  target_tokens: number
  overlap_tokens: number
  min_tokens: number
  max_tokens: number
  model_name: string
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

export interface UnitDetail {
  id: number
  reference_label: string | null
  ancestor_path: string | null
  corpus_name: string
  corpus_version_name: string | null
  corpus_version_id: number
  height: number | null
  depth: number
  taxonomy: TaxonomyLabel[]
  cleaned_text: string | null
  original_text: string | null
  unit_source: string | null
  version_source: string | null
}

export interface SearchResult {
  id: number
  result_type: 'unit' | 'span'
  text: string | null
  reference_label: string | null
  ancestor_path: string | null
  corpus_name: string
  corpus_version_name: string | null
  height: number | null
  score: number
  taxonomy: TaxonomyLabel[]
  embedding_span_id?: number | null
  embedding_profile_id?: number | null
  support_unit_ids: number[]
  start_unit_id?: number | null
  end_unit_id?: number | null
  primary_unit_id?: number | null
}

export interface SearchResponse {
  results: SearchResult[]
  mode: 'semantic' | 'keyword' | 'passage'
  embedding_profile_id?: number | null
}

export interface SemanticSearchRequest {
  query: string
  method_id?: number
  embedding_profile_id?: number
  height_min?: number
  height_max?: number
  depth_min?: number
  depth_max?: number
  corpus_ids?: number[]
  corpus_version_ids?: number[]
  limit?: number
  offset?: number
}

export interface KeywordSearchRequest {
  query: string
  height_min?: number
  height_max?: number
  depth_min?: number
  depth_max?: number
  corpus_ids?: number[]
  corpus_version_ids?: number[]
  limit?: number
  offset?: number
}

export interface PassageSearchRequest {
  unit_id: number
  method_id?: number
  embedding_profile_id?: number
  height_min?: number
  height_max?: number
  depth_min?: number
  depth_max?: number
  corpus_ids?: number[]
  corpus_version_ids?: number[]
  limit?: number
  offset?: number
  exclude_self?: boolean
}

export interface CompareRequest {
  reference_unit_id: number
  unit_ids: number[]
  method_id?: number
  embedding_profile_id?: number
}

export interface CompareItem {
  unit: UnitBrief
  cosine_similarity: number
  cosine_distance: number
}

export interface CompareResponse {
  reference_unit: UnitBrief
  method_id: number
  embedding_profile_id?: number | null
  items: CompareItem[]
}
