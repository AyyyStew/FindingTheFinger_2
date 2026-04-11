import { useRef } from 'react'
import type { CorpusInfo, UnitBrief } from '../../api/types'
import { PassagePicker } from '../PassagePicker/PassagePicker'
import styles from './SearchBar.module.css'

export type SearchMode = 'semantic' | 'keyword' | 'passage'

interface Props {
  mode: SearchMode
  onModeChange: (mode: SearchMode) => void
  textQuery: string
  onTextQueryChange: (q: string) => void
  selectedUnit: UnitBrief | null
  onSelectedUnitChange: (unit: UnitBrief | null) => void
  filtersOpen: boolean
  onFiltersToggle: () => void
  onSearch: () => void
  isSearching: boolean
  corpora: CorpusInfo[]
  selectedCorpusIds: number[]
}

const MODES: { value: SearchMode; label: string }[] = [
  { value: 'semantic', label: 'Semantic' },
  { value: 'keyword', label: 'Keyword' },
  { value: 'passage', label: 'Passage' },
]

export function SearchBar({
  mode,
  onModeChange,
  textQuery,
  onTextQueryChange,
  selectedUnit,
  onSelectedUnitChange,
  filtersOpen,
  onFiltersToggle,
  onSearch,
  isSearching,
  corpora,
  selectedCorpusIds,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleTextInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onTextQueryChange(e.target.value)
    // auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSearch) onSearch()
    }
  }

  const canSearch =
    !isSearching &&
    ((mode === 'semantic' || mode === 'keyword') ? textQuery.trim().length > 0 : selectedUnit !== null)

  const placeholder =
    mode === 'semantic'
      ? 'Enter text to find semantically similar passages…'
      : 'Enter keywords to search passage text…'

  return (
    <div className={styles.root}>
      <div className={styles.tabs} role="tablist">
        {MODES.map(({ value, label }) => (
          <button
            key={value}
            role="tab"
            aria-selected={mode === value}
            className={`${styles.tab} ${mode === value ? styles.tabActive : ''}`}
            onClick={() => onModeChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.inputWrap}>
        {mode === 'passage' ? (
          <PassagePicker
              selected={selectedUnit}
              onSelect={onSelectedUnitChange}
              corpora={corpora}
              selectedCorpusIds={selectedCorpusIds}
            />
        ) : (
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={textQuery}
            onChange={handleTextInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={3}
          />
        )}
      </div>

      <div className={styles.bottomRow}>
        <button
          className={`${styles.filterToggle} ${filtersOpen ? styles.filterToggleActive : ''}`}
          onClick={onFiltersToggle}
          aria-expanded={filtersOpen}
        >
          <svg className={styles.filterIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="4" cy="4" r="1.5" />
            <circle cx="12" cy="8" r="1.5" />
            <circle cx="4" cy="12" r="1.5" />
            <line x1="6" y1="4" x2="16" y2="4" />
            <line x1="0" y1="8" x2="10" y2="8" />
            <line x1="6" y1="12" x2="16" y2="12" />
          </svg>
          Filters
        </button>

        <button className={styles.searchBtn} onClick={onSearch} disabled={!canSearch}>
          {isSearching ? (
            <span className={styles.spinner} aria-hidden />
          ) : null}
          {isSearching ? 'Searching…' : 'Find Similar'}
        </button>
      </div>
    </div>
  )
}
