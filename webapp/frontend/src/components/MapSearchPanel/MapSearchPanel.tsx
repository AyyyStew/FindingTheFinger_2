import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { fetchUnit, searchKeyword, searchPassage, searchSemantic } from '../../api/client';
import type { CorpusInfo, SearchResult, UnitBrief } from '../../api/types';
import { getTaxonomyColor } from '../../utils/taxonomyColors';
import { PassagePicker } from '../PassagePicker/PassagePicker';
import styles from './MapSearchPanel.module.css';

export type SearchMode = 'semantic' | 'keyword' | 'passage';

const SEARCH_LIMIT = 50; // fetch more so filtering to projection still gives ≥10
const DISPLAY_LIMIT = 10;

interface HistoryEntry {
  id: string;
  mode: SearchMode;
  label: string;
  query?: string;
  unitId?: number;
  results: SearchResult[];
  timestamp: number;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem('ftf_map_search_history');
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem('ftf_map_search_history', JSON.stringify(entries));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface ScoreChipProps { score: number }
function ScoreChip({ score }: ScoreChipProps) {
  const cls =
    score >= 0.75 ? styles.scoreHigh :
    score >= 0.5  ? styles.scoreMid  : styles.scoreLow;
  return <span className={`${styles.score} ${cls}`}>{Math.round(score * 100)}%</span>;
}

interface ResultRowProps {
  result: SearchResult;
  showScore: boolean;
  rank: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onHover: (result: SearchResult | null) => void;
  onFindSimilar: (result: SearchResult) => void;
}

function ResultRow({ result, showScore, rank, expanded, onToggleExpand, onHover, onFindSimilar }: ResultRowProps) {
  const { solid, dim } = getTaxonomyColor(result.taxonomy);
  const label = result.reference_label ?? `Unit ${result.id}`;
  const hasText = Boolean(result.text);

  return (
    <div
      className={styles.resultRow}
      style={{ '--tx-solid': solid, '--tx-dim': dim } as React.CSSProperties}
      onMouseEnter={() => onHover(result)}
      onMouseLeave={() => onHover(null)}
    >
      <div className={styles.resultAccent} />
      <div className={styles.resultBody}>
        <div className={styles.resultHeader}>
          <span className={styles.resultRank}>{rank}</span>
          <span className={styles.resultLabel}>{label}</span>
          {showScore && result.score != null && <ScoreChip score={result.score} />}
        </div>
        <div className={styles.resultMeta}>
          <span className={styles.resultCorpus}>{result.corpus_name}</span>
        </div>
        {hasText && (
          <p className={`${styles.resultText} ${expanded ? styles.resultTextExpanded : ''}`}>
            {result.text}
          </p>
        )}
        <div className={styles.resultActions}>
          {hasText && (
            <button
              className={styles.expandBtn}
              onClick={e => { e.stopPropagation(); onToggleExpand(); }}
            >
              {expanded ? '▴ Less' : '▾ More'}
            </button>
          )}
          <button
            className={styles.findSimilarBtn}
            onClick={e => { e.stopPropagation(); onFindSimilar(result); }}
            title="Find similar passages"
          >
            ∿ Find Similar
          </button>
        </div>
      </div>
    </div>
  );
}

const MODE_LABELS: Record<SearchMode, string> = {
  semantic: 'Semantic',
  keyword:  'Keyword',
  passage:  'Passage',
};

const MODE_BADGE: Record<SearchMode, string> = {
  semantic: 'sem',
  keyword:  'kw',
  passage:  'psg',
};

export interface MapSearchPanelHandle {
  triggerPassageSearch: (unitId: number) => Promise<void>;
}

export interface MapSearchPanelProps {
  corpora: CorpusInfo[];
  /** Unit IDs present in the current projection — results are filtered to these. */
  projectionUnitIds?: globalThis.Set<number> | null;
  /**
   * Called on each search. anchorUnitId is set for passage searches and
   * becomes the hub (index 0) of the constellation in the parent.
   */
  onResults: (results: SearchResult[], mode: SearchMode, label: string, anchorUnitId?: number) => void;
  onResultHover?: (result: SearchResult | null) => void;
}

export const MapSearchPanel = forwardRef<MapSearchPanelHandle, MapSearchPanelProps>(function MapSearchPanel({
  corpora,
  projectionUnitIds,
  onResults,
  onResultHover,
}, ref) {
  const [mode, setMode] = useState<SearchMode>('semantic');
  const [textQuery, setTextQuery] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<UnitBrief | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeResults, setActiveResults] = useState<SearchResult[] | null>(null);
  const [activeMode, setActiveMode] = useState<SearchMode | null>(null);
  const [expandedIds, setExpandedIds] = useState<globalThis.Set<number>>(new globalThis.Set());

  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [historyOpen, setHistoryOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const allCorpusIds = useMemo(() => corpora.map(c => c.id), [corpora]);

  useImperativeHandle(ref, () => ({
    triggerPassageSearch: async (unitId: number) => {
      setMode('passage');
      setActiveResults(null);
      setActiveMode(null);
      setExpandedIds(new globalThis.Set());
      setError(null);
      onResults([], 'passage', '');
      setIsSearching(true);
      try {
        const unit = await fetchUnit(unitId);
        const res = await searchPassage({ unit_id: unitId, limit: SEARCH_LIMIT, exclude_self: true });
        const label = unit.reference_label ?? `Unit ${unitId}`;
        setSelectedUnit(unit);
        const filtered = projectionUnitIds && projectionUnitIds.size > 0
          ? res.results.filter(r => projectionUnitIds.has(r.id)).slice(0, DISPLAY_LIMIT)
          : res.results.slice(0, DISPLAY_LIMIT);
        setActiveResults(filtered);
        setActiveMode('passage');
        setExpandedIds(new globalThis.Set());
        onResults(filtered, 'passage', label, unitId);
        const entry: HistoryEntry = { id: String(Date.now()), mode: 'passage', label, results: filtered, timestamp: Date.now() };
        setHistory(prev => { const next = [entry, ...prev].slice(0, 20); saveHistory(next); return next; });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed');
      } finally {
        setIsSearching(false);
      }
    },
  }), [onResults, projectionUnitIds]);

  const canSearch =
    !isSearching &&
    (mode === 'passage' ? selectedUnit != null : textQuery.trim().length > 0);

  /** Filter raw API results to only those visible in the projection, then cap at DISPLAY_LIMIT. */
  const filterToProjection = (results: SearchResult[]): SearchResult[] => {
    if (!projectionUnitIds || projectionUnitIds.size === 0) return results.slice(0, DISPLAY_LIMIT);
    return results.filter(r => projectionUnitIds.has(r.id)).slice(0, DISPLAY_LIMIT);
  };

  const commitResults = (results: SearchResult[], searchMode: SearchMode, label: string, anchorUnitId?: number) => {
    setActiveResults(results);
    setActiveMode(searchMode);
    setExpandedIds(new globalThis.Set());
    onResults(results, searchMode, label, anchorUnitId);

    const entry: HistoryEntry = {
      id: String(Date.now()),
      mode: searchMode,
      label,
      query:  searchMode !== 'passage' ? label : undefined,
      results,
      timestamp: Date.now(),
    };
    setHistory(prev => {
      const next = [entry, ...prev].slice(0, 20);
      saveHistory(next);
      return next;
    });
  };

  const handleModeChange = (newMode: SearchMode) => {
    setMode(newMode);
    setError(null);
    setActiveResults(null);
    setActiveMode(null);
    setExpandedIds(new globalThis.Set());
    onResults([], newMode, '');
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextQuery(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSearch) void handleSearch();
    }
  };

  const handleSearch = async (overrideUnit?: UnitBrief) => {
    const unit = overrideUnit ?? selectedUnit;
    setIsSearching(true);
    setError(null);
    try {
      let res;
      const label =
        mode === 'passage'
          ? (unit!.reference_label ?? `Unit ${unit!.id}`)
          : textQuery.trim();

      if (mode === 'semantic') {
        res = await searchSemantic({ query: textQuery.trim(), limit: SEARCH_LIMIT });
      } else if (mode === 'keyword') {
        res = await searchKeyword({ query: textQuery.trim(), limit: SEARCH_LIMIT });
      } else {
        res = await searchPassage({ unit_id: unit!.id, limit: SEARCH_LIMIT, exclude_self: true });
      }

      const anchorId = mode === 'passage' ? unit!.id : undefined;
      commitResults(filterToProjection(res.results), mode, label, anchorId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleFindSimilar = async (result: SearchResult) => {
    // Build a UnitBrief-compatible object from the result
    const unit: UnitBrief = { ...result, depth: 0 };
    setMode('passage');
    setSelectedUnit(unit);
    setActiveResults(null);
    setActiveMode(null);
    setExpandedIds(new globalThis.Set());
    setError(null);
    // Reset parent map state immediately so constellation clears before new results arrive.
    onResults([], 'passage', '');
    setIsSearching(true);
    try {
      const res = await searchPassage({ unit_id: result.id, limit: SEARCH_LIMIT, exclude_self: true });
      const label = result.reference_label ?? `Unit ${result.id}`;
      commitResults(filterToProjection(res.results), 'passage', label, result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleHistoryClick = (entry: HistoryEntry) => {
    // Filter stale results from old projection runs to currently visible units.
    const results = filterToProjection(entry.results);
    if (results.length === 0) return; // entirely stale — silently skip
    setActiveResults(results);
    setActiveMode(entry.mode);
    setExpandedIds(new globalThis.Set());
    onResults(results, entry.mode, entry.label);
    setHistoryOpen(false);
  };

  const handleClearResults = () => {
    setActiveResults(null);
    setActiveMode(null);
    setExpandedIds(new globalThis.Set());
    onResults([], 'semantic', '');
  };

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new globalThis.Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const showScore = activeMode === 'semantic' || activeMode === 'passage';

  return (
    <div className={styles.panel}>
      {/* ── Search controls ── */}
      <div className={styles.searchArea}>
        <div className={styles.panelHeader}>Search</div>

        {/* Mode tabs */}
        <div className={styles.tabs}>
          {(['semantic', 'keyword', 'passage'] as SearchMode[]).map(m => (
            <button
              key={m}
              className={`${styles.tab} ${mode === m ? styles.tabActive : ''}`}
              onClick={() => handleModeChange(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className={styles.inputWrap}>
          {mode === 'passage' ? (
            <PassagePicker
              selected={selectedUnit}
              onSelect={setSelectedUnit}
              corpora={corpora}
              selectedCorpusIds={allCorpusIds}
              compact
            />
          ) : (
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              value={textQuery}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder={
                mode === 'semantic'
                  ? 'Find semantically similar passages…'
                  : 'Find passages containing this phrase…'
              }
              rows={2}
            />
          )}
        </div>

        <button
          className={styles.searchBtn}
          onClick={() => void handleSearch()}
          disabled={!canSearch}
        >
          {isSearching ? <span className={styles.spinner} aria-hidden /> : null}
          {isSearching ? 'Searching…' : 'Search'}
        </button>

        {error && <p className={styles.error}>{error}</p>}
      </div>

      {/* ── Results ── */}
      <div className={styles.content}>
        {activeResults && activeResults.length > 0 && (
          <section className={styles.resultsSection}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Results</span>
              <span className={styles.modeBadge}>{activeMode ? MODE_BADGE[activeMode] : ''}</span>
              <span className={styles.resultCount}>{activeResults.length}</span>
              <button className={styles.clearBtn} onClick={handleClearResults} title="Clear results">✕</button>
            </div>
            <div className={styles.resultList}>
              {activeResults.map((r, i) => (
                <ResultRow
                  key={r.id}
                  result={r}
                  showScore={showScore}
                  rank={i + 1}
                  expanded={expandedIds.has(r.id)}
                  onToggleExpand={() => toggleExpand(r.id)}
                  onHover={onResultHover ?? (() => {})}
                  onFindSimilar={handleFindSimilar}
                />
              ))}
            </div>
          </section>
        )}

        {activeResults && activeResults.length === 0 && (
          <p className={styles.empty}>No results found.</p>
        )}

        {/* ── History ── */}
        {history.length > 0 && (
          <section className={styles.historySection}>
            <button
              className={styles.historyToggle}
              onClick={() => setHistoryOpen(o => !o)}
            >
              <span className={styles.sectionTitle}>History</span>
              <span className={styles.historyCount}>{history.length}</span>
              <span className={`${styles.arrow} ${historyOpen ? styles.arrowOpen : ''}`}>▾</span>
            </button>
            {historyOpen && (
              <div className={styles.historyList}>
                {history.map(entry => (
                  <button
                    key={entry.id}
                    className={styles.historyEntry}
                    onClick={() => handleHistoryClick(entry)}
                  >
                    <span className={styles.historyMode}>{MODE_BADGE[entry.mode]}</span>
                    <span className={styles.historyLabel}>{entry.label}</span>
                    <span className={styles.historyTime}>{relativeTime(entry.timestamp)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
});
