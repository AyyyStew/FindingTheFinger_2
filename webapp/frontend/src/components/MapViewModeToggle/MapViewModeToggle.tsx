import type { MapViewMode } from '../MapCanvas/MapCanvas';
import { Tooltip } from '../Tooltip/Tooltip';
import styles from './MapViewModeToggle.module.css';

interface MapViewModeToggleProps {
  viewMode: MapViewMode;
  onChange: (mode: MapViewMode) => void;
  onZoomToFit: () => void;
}

export function MapViewModeToggle({
  viewMode,
  onChange,
  onZoomToFit,
}: MapViewModeToggleProps) {
  return (
    <div className={styles.panel} aria-label="Map view controls">
      <div className={styles.modeRow}>
        <Tooltip content="Use the flat projection view for selection, search, and density overlays.">
          <button
            type="button"
            className={`${styles.modeBtn} ${viewMode === '2d' ? styles.modeBtnActive : ''}`}
            onClick={() => onChange('2d')}
          >
            2D
          </button>
        </Tooltip>
        <Tooltip content="Use the rotatable projection view to inspect depth and component separation.">
          <button
            type="button"
            className={`${styles.modeBtn} ${viewMode === '3d' ? styles.modeBtnActive : ''}`}
            onClick={() => onChange('3d')}
          >
            3D
          </button>
        </Tooltip>
      </div>
      <Tooltip content="Reset the camera so the visible projection fits in view.">
        <button
          type="button"
          className={styles.fitBtn}
          onClick={onZoomToFit}
        >
          Zoom to fit
        </button>
      </Tooltip>
    </div>
  );
}
