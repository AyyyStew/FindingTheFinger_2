// Type stubs for deck.gl v8 which ships without bundled TypeScript declarations.
// Replace with proper types if upgrading to deck.gl v9+.

declare module '@deck.gl/react' {
  import type { ComponentType } from 'react';
  const DeckGL: ComponentType<Record<string, unknown>>;
  export default DeckGL;
}

declare module '@deck.gl/core' {
  export class OrthographicView {
    constructor(props?: Record<string, unknown>);
  }
  export interface PickingInfo {
    picked: boolean;
    index: number;
    layer: { id: string } | null;
    x: number;
    y: number;
    coordinate?: number[];
    object?: unknown;
  }
  export type Layer = unknown;
}

declare module '@deck.gl/layers' {
  export class ScatterplotLayer {
    constructor(props: Record<string, unknown>);
  }
  export class LineLayer {
    constructor(props: Record<string, unknown>);
  }
  export class SolidPolygonLayer {
    constructor(props: Record<string, unknown>);
  }
  export class TextLayer {
    constructor(props: Record<string, unknown>);
  }
}
