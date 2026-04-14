import { useCallback, useEffect, useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { OrbitView, OrthographicView } from "@deck.gl/core";
import { TextLayer } from "@deck.gl/layers";
// deck.gl v8 runtime exports this path, but package typings do not declare it.
// @ts-expect-error - missing declaration file for deep import
import OrbitViewport from "@deck.gl/core/dist/esm/viewports/orbit-viewport";
import type { Layer, PickingInfo } from "@deck.gl/core";
import type { StandardRunData } from "../../utils/projectionLoader";
import {
  buildAllLayers,
  buildHighlightLayer,
  buildConstellationLayer,
  DEFAULT_OVERLAY_OPTIONS,
  type MapVisibility,
  type MapOverlayOptions,
  type CorpusColorMap,
  type CorpusLabelMap,
} from "../../utils/mapLayers";
import styles from "./MapCanvas.module.css";

export interface HoverInfo {
  resultType: "unit" | "span";
  unitId: number;
  spanId?: number;
  /** Height is no longer emitted by projection layers. */
  height: -1;
  /** Depth field is reserved for search integration (-1 when unknown). */
  depth: number;
  corpusId: number;
  screenX: number;
  screenY: number;
}

export interface FlyToTarget {
  target: [number, number, number];
  /** Omit to keep the current zoom level and only pan. */
  zoom?: number;
}

export type MapViewMode = "2d" | "3d";
const MIN_3D_ZOOM = -30;
const MAX_3D_ZOOM = 14;
const ORBIT_AXIS: "Y" | "Z" = "Z";
const ORBIT_FOVY = 50;
const ORBIT_NEAR_Z_MULTIPLIER = 0.02;
const ORBIT_FAR_Z_MULTIPLIER = 10;
const INITIAL_3D_ZOOM_OFFSET = 0.85;

interface DeckViewState {
  target: [number, number, number];
  zoom: number;
  rotationX: number;
  rotationOrbit: number;
  width?: number;
  height?: number;
  transitionDuration?: number;
}

interface MapCanvasProps {
  data: StandardRunData;
  visibility: MapVisibility;
  colorMap: CorpusColorMap;
  corpusLabelMap: CorpusLabelMap;
  onHover: (info: HoverInfo | null) => void;
  onClick?: (info: HoverInfo) => void;
  /** Positions (up to 10) of search result units. Index 0 = hub/anchor. */
  resultPositions?: [number, number, number][] | null;
  /** Selected comparison unit IDs shown in tools mode. */
  selectedUnitIds?: Set<number> | null;
  /** Selected comparison positions rendered above the scatterplot. */
  selectedPositions?: [number, number, number][] | null;
  /** Selected comparison position currently hovered in the tools table. */
  selectedHoverPosition?: [number, number, number] | null;
  /** When set, shows a pulsing highlight ring at this map position (result card hover). */
  highlightPos?: [number, number, number] | null;
  /** When this changes reference, the map animates to the target position. */
  flyTo?: FlyToTarget | null;
  /** Optional derived views drawn against the current visible point layer(s). */
  overlays?: MapOverlayOptions;
  /** 2D (orthographic) or 3D (orbit) map camera mode. */
  viewMode?: MapViewMode;
  /** Increment to trigger a zoom-to-fit reset. */
  fitToBoundsToken?: number;
  /** Whether planar-only overlays (Voronoi/KDE) are enabled for this view mode. */
  enablePlanarDerivedOverlays?: boolean;
  /** Axis labels for orientation gizmo in 3D mode. */
  axisLabels?: [string, string, string];
}

function flattenPositionsTo2D(positions: Float32Array): Float32Array {
  const flat = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    flat[i] = positions[i];
    flat[i + 1] = positions[i + 1];
    flat[i + 2] = 0;
  }
  return flat;
}

function computeInitialViewState(
  bounds: StandardRunData["bounds"],
  viewMode: MapViewMode,
): DeckViewState {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  if (viewMode === "2d") {
    const rangeX = bounds.maxX - bounds.minX;
    const rangeY = bounds.maxY - bounds.minY;
    const maxRange = Math.max(rangeX, rangeY, 0.1);
    const viewportSize = Math.min(window.innerWidth, window.innerHeight) * 0.7;
    const zoom = Math.log2(viewportSize / maxRange);
    return { target: [cx, cy, 0], zoom, rotationX: 0, rotationOrbit: 0 };
  }

  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const rangeX = bounds.maxX - bounds.minX;
  const rangeY = bounds.maxY - bounds.minY;
  const rangeZ = bounds.maxZ - bounds.minZ;
  const maxRange = Math.max(rangeX, rangeY, rangeZ, 0.1);
  const viewportSize = Math.min(window.innerWidth, window.innerHeight) * 0.7;
  const zoom = Math.log2(viewportSize / maxRange) + INITIAL_3D_ZOOM_OFFSET;
  return { target: [cx, cy, cz], zoom, rotationX: 35, rotationOrbit: 20 };
}

type Vec3 = [number, number, number];

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-8) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function negate(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]];
}

export function MapCanvas({
  data,
  visibility,
  colorMap,
  corpusLabelMap,
  onHover,
  onClick,
  resultPositions,
  selectedUnitIds,
  selectedPositions,
  selectedHoverPosition,
  highlightPos,
  flyTo,
  overlays = DEFAULT_OVERLAY_OPTIONS,
  viewMode = "2d",
  fitToBoundsToken = 0,
  enablePlanarDerivedOverlays = true,
  axisLabels = ["X", "Y", "Z"],
}: MapCanvasProps) {
  const [viewState, setViewState] = useState<DeckViewState>(() =>
    computeInitialViewState(data.bounds, viewMode),
  );

  const [selectedHoverFillAlpha, setSelectedHoverFillAlpha] = useState(0);

  const renderData = useMemo<StandardRunData>(() => {
    if (viewMode === "3d") return data;

    const corpusVersionLayers = new Map<
      number,
      typeof data.corpusVersionLayers extends Map<number, infer T> ? T : never
    >();
    for (const [corpusVersionId, layer] of data.corpusVersionLayers) {
      corpusVersionLayers.set(corpusVersionId, {
        ...layer,
        positions: flattenPositionsTo2D(layer.positions),
      } as typeof layer);
    }

    return {
      ...data,
      corpusVersionLayers,
      spanLayer: data.spanLayer
        ? {
            ...data.spanLayer,
            positions: flattenPositionsTo2D(data.spanLayer.positions),
          }
        : null,
      bounds: {
        ...data.bounds,
        minZ: 0,
        maxZ: 0,
      },
    };
  }, [data, viewMode]);

  // Refit when the dataset (projection) changes.
  useEffect(() => {
    setViewState(computeInitialViewState(renderData.bounds, viewMode));
  }, [renderData, viewMode]);

  // Explicit zoom-to-fit trigger from parent controls.
  useEffect(() => {
    setViewState(computeInitialViewState(renderData.bounds, viewMode));
  }, [fitToBoundsToken, renderData.bounds, viewMode]);

  // Pan (and optionally zoom) when flyTo changes.
  useEffect(() => {
    if (!flyTo) return;
    const target: [number, number, number] =
      viewMode === "3d" ? flyTo.target : [flyTo.target[0], flyTo.target[1], 0];
    setViewState((prev) => ({
      ...prev,
      target,
      ...(flyTo.zoom != null ? { zoom: flyTo.zoom } : {}),
      transitionDuration: 250,
    }));
  }, [flyTo, viewMode]);

  useEffect(() => {
    if (!selectedHoverPosition) {
      setSelectedHoverFillAlpha(0);
      return;
    }

    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const phase = ((now - startedAt) / 1950) * Math.PI * 2;
      setSelectedHoverFillAlpha(Math.round((Math.cos(phase) + 1) * 87.5));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [selectedHoverPosition]);

  const handleViewStateChange = useCallback(
    ({ viewState: vs }: { viewState: object }) => {
      const { transitionDuration: _td, ...rest } = vs as DeckViewState & {
        transitionDuration?: number;
      };
      void _td;
      const next = rest as DeckViewState;
      if (viewMode === "2d") {
        setViewState({ ...next, rotationX: 0, rotationOrbit: 0 });
        return;
      }
      setViewState(next);
    },
    [viewMode],
  );

  const axisVectors2D = useMemo(() => {
    if (viewMode !== "3d") return null;
    const orbit = (viewState.rotationOrbit * Math.PI) / 180;
    const tilt = (viewState.rotationX * Math.PI) / 180;
    const cosO = Math.cos(orbit);
    const sinO = Math.sin(orbit);
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);

    const rotate = (vx: number, vy: number, vz: number): [number, number] => {
      const x1 = vx * cosO - vy * sinO;
      const y1 = vx * sinO + vy * cosO;
      const z1 = vz;
      const y2 = y1 * cosT - z1 * sinT;
      return [x1, -y2];
    };

    return [rotate(1, 0, 0), rotate(0, 1, 0), rotate(0, 0, 1)] as [
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
    ];
  }, [viewMode, viewState.rotationOrbit, viewState.rotationX]);

  useEffect(() => {
    if (viewMode !== "3d") return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const forwardIntent =
        key === "w" || key === "pageup"
          ? 1
          : key === "s" || key === "pagedown"
            ? -1
            : 0;
      const strafeIntent = key === "d" ? 1 : key === "a" ? -1 : 0;
      const verticalIntent = key === "q" ? 1 : key === "e" ? -1 : 0;
      if (forwardIntent === 0 && strafeIntent === 0 && verticalIntent === 0)
        return;

      event.preventDefault();
      const maxRange = Math.max(
        renderData.bounds.maxX - renderData.bounds.minX,
        renderData.bounds.maxY - renderData.bounds.minY,
        renderData.bounds.maxZ - renderData.bounds.minZ,
        0.1,
      );
      const baseStep = Math.max(maxRange / 120, 0.03);
      const step = baseStep * (event.shiftKey ? 3 : 1);
      setViewState((prev) => ({
        ...prev,
        target: (() => {
          const viewportWidth = Math.max(1, prev.width ?? window.innerWidth);
          const viewportHeight = Math.max(1, prev.height ?? window.innerHeight);
          const viewport = new OrbitViewport({
            width: viewportWidth,
            height: viewportHeight,
            target: prev.target,
            zoom: prev.zoom,
            rotationOrbit: prev.rotationOrbit,
            rotationX: prev.rotationX,
            orbitAxis: ORBIT_AXIS,
            fovy: ORBIT_FOVY,
          });

          const cameraPos = viewport.cameraPosition as Vec3;
          const look = normalize(sub(prev.target, cameraPos));

          const projectedTarget = viewport.project(prev.target);
          const centerX = viewportWidth / 2;
          const centerY = viewportHeight / 2;
          const depth = projectedTarget[2];
          const center = viewport.unproject([centerX, centerY, depth]) as Vec3;
          const centerRight = viewport.unproject([
            centerX + 1,
            centerY,
            depth,
          ]) as Vec3;
          const centerUp = viewport.unproject([
            centerX,
            centerY - 1,
            depth,
          ]) as Vec3;

          const rightRaw = normalize(sub(centerRight, center));
          const upRaw = normalize(sub(centerUp, center));
          const basisForward = normalize(cross(rightRaw, upRaw));

          // Keep movement forward aligned with where the camera is looking.
          const forward =
            dot(basisForward, look) >= 0 ? basisForward : negate(basisForward);
          const right = normalize(
            sub(rightRaw, scale(forward, dot(rightRaw, forward))),
          );
          let up = normalize(cross(forward, right));
          if (dot(up, upRaw) < 0) {
            up = negate(up);
          }

          const movement = add(
            add(scale(forward, forwardIntent), scale(right, strafeIntent)),
            scale(up, verticalIntent),
          );

          return add(prev.target, scale(movement, step));
        })(),
      }));
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    renderData.bounds.maxX,
    renderData.bounds.minX,
    renderData.bounds.maxY,
    renderData.bounds.minY,
    renderData.bounds.maxZ,
    renderData.bounds.minZ,
    viewMode,
  ]);

  // ── Layers ─────────────────────────────────────────────────────────────────

  const baseLayers = useMemo(() => {
    return buildAllLayers(
      renderData,
      visibility,
      colorMap,
      corpusLabelMap,
      selectedUnitIds,
      overlays,
      enablePlanarDerivedOverlays,
    );
  }, [
    renderData,
    visibility,
    colorMap,
    corpusLabelMap,
    selectedUnitIds,
    overlays,
    enablePlanarDerivedOverlays,
  ]);

  const layers = useMemo(() => {
    const normalizePos = (
      p: [number, number, number],
    ): [number, number, number] => (viewMode === "2d" ? [p[0], p[1], 0] : p);
    const extras: Layer[] = [];
    if (resultPositions && resultPositions.length > 0) {
      const cl = buildConstellationLayer(resultPositions.map(normalizePos));
      if (cl) extras.push(cl);
    }
    if (selectedPositions && selectedPositions.length > 0) {
      const sl = buildHighlightLayer(
        selectedPositions.map(normalizePos),
        "selected-comparison-highlight",
        9,
      );
      if (sl) extras.push(sl);
    }
    if (selectedHoverPosition) {
      const shl = buildHighlightLayer(
        [normalizePos(selectedHoverPosition)],
        "selected-comparison-hover-highlight",
        9,
        selectedHoverFillAlpha,
      );
      if (shl) extras.push(shl);
    }
    if (highlightPos) {
      const hl = buildHighlightLayer([normalizePos(highlightPos)]);
      if (hl) extras.push(hl);
    }
    if (viewMode === "3d") {
      extras.push(
        new TextLayer({
          id: "orbit-focus-crosshair-outline",
          data: [{ position: viewState.target }],
          getPosition: (d: { position: [number, number, number] }) =>
            d.position,
          getText: () => "+",
          getSize: 34,
          sizeUnits: "pixels",
          billboard: true,
          pickable: false,
          getColor: [0, 0, 0, 240],
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          fontWeight: 900,
          characterSet: ["+"],
          parameters: { depthTest: false },
        }),
      );
      extras.push(
        new TextLayer({
          id: "orbit-focus-crosshair",
          data: [{ position: viewState.target }],
          getPosition: (d: { position: [number, number, number] }) =>
            d.position,
          getText: () => "+",
          getSize: 24,
          sizeUnits: "pixels",
          billboard: true,
          pickable: false,
          getColor: [255, 255, 255, 200],
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          fontWeight: 700,
          characterSet: ["+"],
          parameters: { depthTest: false },
        }),
      );
    }
    return [...baseLayers, ...extras];
  }, [
    baseLayers,
    selectedPositions,
    selectedHoverPosition,
    selectedHoverFillAlpha,
    resultPositions,
    highlightPos,
    viewMode,
    viewState.target,
  ]);

  // ── Pick handler ───────────────────────────────────────────────────────────

  const resolvePickInfo = useCallback(
    (info: PickingInfo): HoverInfo | null => {
      if (!info.picked || info.index < 0) return null;
      const layerId = info.layer?.id ?? "";
      const corpusVersionMatch = layerId.match(/^scatter-cv(\d+)$/);
      const spanMatch = layerId === "scatter-spans";
      if (corpusVersionMatch) {
        const corpusVersionId = parseInt(corpusVersionMatch[1], 10);
        const layer = data.corpusVersionLayers.get(corpusVersionId);
        if (!layer) return null;
        return {
          resultType: "unit",
          unitId: layer.unitIds[info.index],
          height: -1,
          depth: -1,
          corpusId: layer.corpusIds[info.index],
          screenX: info.x,
          screenY: info.y,
        };
      } else if (spanMatch) {
        const layer = data.spanLayer;
        if (!layer) return null;
        return {
          resultType: "span",
          spanId: layer.spanIds[info.index],
          unitId: layer.primaryUnitIds[info.index],
          height: -1,
          depth: -1,
          corpusId: layer.corpusIds[info.index],
          screenX: info.x,
          screenY: info.y,
        };
      }
      return null;
    },
    [data],
  );

  const handleHover = useCallback(
    (info: PickingInfo) => {
      onHover(resolvePickInfo(info));
    },
    [onHover, resolvePickInfo],
  );

  const handleClick = useCallback(
    (info: PickingInfo) => {
      if (!onClick) return;
      const resolved = resolvePickInfo(info);
      if (resolved) onClick(resolved);
    },
    [onClick, resolvePickInfo],
  );

  return (
    <div
      className={styles.canvas}
      onContextMenu={(event) => event.preventDefault()}
    >
      <DeckGL
        views={
          viewMode === "3d"
            ? new OrbitView({
                id: "map",
                // Reduce close-range clipping in dense point clouds.
                nearZMultiplier: ORBIT_NEAR_Z_MULTIPLIER,
                farZMultiplier: ORBIT_FAR_Z_MULTIPLIER,
                orbitAxis: ORBIT_AXIS,
                fovy: ORBIT_FOVY,
              })
            : new OrthographicView({ id: "map", flipY: false })
        }
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        controller={
          viewMode === "3d"
            ? { inertia: true, minZoom: MIN_3D_ZOOM, maxZoom: MAX_3D_ZOOM }
            : true
        }
        layers={layers}
        onHover={handleHover}
        onClick={handleClick}
        getCursor={({ isDragging }: { isDragging: boolean }) =>
          isDragging ? "grabbing" : "crosshair"
        }
      />
      {viewMode === "3d" && (
        <div className={styles.controlsBar} aria-label="3D map controls">
          <span className={styles.controlsLabel}>3D controls</span>
          <span className={styles.controlItem}>
            <kbd>Drag</kbd> rotate
          </span>
          <span className={styles.controlItem}>
            <kbd>Right-drag</kbd> pan
          </span>
          <span className={styles.controlItem}>
            <kbd>Shift</kbd> + <kbd>Drag</kbd> pan
          </span>
          <span className={styles.controlItem}>
            <kbd>Scroll</kbd> zoom
          </span>
          <span className={styles.controlItem}>
            <kbd>W</kbd>/<kbd>S</kbd>forward/back
          </span>
          <span className={styles.controlItem}>
            <kbd>A</kbd>/<kbd>D</kbd>left/right
          </span>
          <span className={styles.controlItem}>
            <kbd>Q</kbd>/<kbd>E</kbd>up/down
          </span>
          <span className={styles.controlItem}>
            <kbd>Double-click</kbd> zoom in
          </span>
        </div>
      )}
      {viewMode === "3d" && axisVectors2D && (
        <div className={styles.axisGizmo} aria-hidden="true">
          <svg viewBox="-30 -30 60 60" className={styles.axisSvg}>
            {axisVectors2D.map(([vx, vy], idx) => {
              const scale = 18;
              const x2 = vx * scale;
              const y2 = vy * scale;
              const tx = vx * 24;
              const ty = vy * 24;
              const color =
                idx === 0 ? "#ff6b6b" : idx === 1 ? "#4cd48a" : "#6ca8ff";
              return (
                <g key={axisLabels[idx]}>
                  <line
                    x1={0}
                    y1={0}
                    x2={x2}
                    y2={y2}
                    stroke={color}
                    strokeWidth={2}
                  />
                  <text x={tx} y={ty} fill={color} className={styles.axisLabel}>
                    {axisLabels[idx]}
                  </text>
                </g>
              );
            })}
            <circle cx={0} cy={0} r={2.4} fill="#c9d3e8" />
          </svg>
        </div>
      )}
    </div>
  );
}
