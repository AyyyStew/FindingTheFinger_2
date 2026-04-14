import type { SearchResult } from '../../api/types'
import { UnitCard } from '../UnitCard/UnitCard'

interface Props {
  result: SearchResult
  showScore: boolean
}

export function ResultCard({ result, showScore }: Props) {
  const readUnitId = result.primary_unit_id ?? result.start_unit_id ?? result.support_unit_ids?.[0] ?? result.id
  return (
    <UnitCard
      unit={result}
      variant="full"
      score={showScore ? result.score : undefined}
      readHref={`/read/${readUnitId}`}
    />
  )
}
