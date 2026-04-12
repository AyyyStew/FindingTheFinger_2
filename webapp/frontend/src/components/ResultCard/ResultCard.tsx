import type { SearchResult } from '../../api/types'
import { UnitCard } from '../UnitCard/UnitCard'

interface Props {
  result: SearchResult
  showScore: boolean
}

export function ResultCard({ result, showScore }: Props) {
  return (
    <UnitCard
      unit={result}
      variant="full"
      score={showScore ? result.score : undefined}
      readHref={`/read/${result.id}`}
    />
  )
}
