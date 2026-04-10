import type { SearchResult } from '../../api/types'
import styles from './ResultCard.module.css'

interface Props {
  result: SearchResult
  showScore: boolean
}

function scoreClass(score: number) {
  if (score >= 0.85) return styles.scoreHigh
  if (score >= 0.65) return styles.scoreMid
  return styles.scoreLow
}

export function ResultCard({ result, showScore }: Props) {
  const { reference_label, ancestor_path, corpus_name, corpus_version_name, text, score } = result

  const displayPath = ancestor_path ?? corpus_name

  return (
    <article className={styles.card}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h3 className={styles.reference}>{reference_label ?? `Unit ${result.id}`}</h3>
          {displayPath && <p className={styles.path}>{displayPath}</p>}
        </div>

        {showScore && (
          <div className={`${styles.scoreBadge} ${scoreClass(score)}`}>
            <span className={styles.scoreDot} aria-hidden />
            {Math.round(score * 100)}%
          </div>
        )}
      </div>

      <div className={styles.badges}>
        <span className={styles.badge}>{corpus_name}</span>
        {corpus_version_name && <span className={styles.badge}>{corpus_version_name}</span>}
      </div>

      {text && <p className={styles.text}>{text}</p>}
    </article>
  )
}
