import type {
  CorpusInfo,
  KeywordSearchRequest,
  MethodInfo,
  PassageSearchRequest,
  SearchResponse,
  SemanticSearchRequest,
  UnitBrief,
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

export function searchUnits(q: string, height = 0, corpusId?: number): Promise<UnitBrief[]> {
  const params = new URLSearchParams({ q, height: String(height) })
  if (corpusId != null) params.set('corpus_id', String(corpusId))
  return get(`/api/units/search?${params}`)
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
