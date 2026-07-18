/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STATIC_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'd3-delaunay' {
  export class Delaunay<T> {
    static from<T>(
      data: T[],
      fx: (d: T) => number,
      fy: (d: T) => number,
    ): Delaunay<T>;
    voronoi(bounds: [number, number, number, number]): {
      cellPolygon(index: number): [number, number][] | null;
    };
  }
}
