/// <reference types="vite/client" />

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
