import type {
  CorpusInfo,
  KeywordSearchRequest,
  MethodInfo,
  PassageSearchRequest,
  CompareRequest,
  CompareResponse,
  SearchResponse,
  SemanticSearchRequest,
  UnitBrief,
  UnitChildPreview,
} from './types'

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}

export function fetchCorpora(): Promise<CorpusInfo[]> {
  return get('/api/corpora')
}

export function fetchMethods(): Promise<MethodInfo[]> {
  return get('/api/methods')
}

/** height omitted = search all heights */
export function searchUnits(q: string, height?: number, corpusIds?: number[]): Promise<UnitBrief[]> {
  const params = new URLSearchParams({ q })
  if (height != null) params.set('height', String(height))
  if (corpusIds && corpusIds.length > 0) {
    corpusIds.forEach((id) => params.append('corpus_id', String(id)))
  }
  return get(`/api/units/search?${params}`)
}

export function fetchUnit(unitId: number): Promise<UnitBrief> {
  return get(`/api/units/${unitId}`)
}

export function getUnitChildren(unitId: number): Promise<UnitChildPreview[]> {
  return get(`/api/units/${unitId}/children`)
}

export function searchSemantic(req: SemanticSearchRequest): Promise<SearchResponse> {
  return post('/api/search/semantic', req)
}

export function searchKeyword(req: KeywordSearchRequest): Promise<SearchResponse> {
  return post('/api/search/keyword', req)
}

export function searchPassage(req: PassageSearchRequest): Promise<SearchResponse> {
  return post('/api/search/passage', req)
}

export function compareUnits(req: CompareRequest): Promise<CompareResponse> {
  return post('/api/units/compare', req)
}
