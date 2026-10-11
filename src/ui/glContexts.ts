/** What releasing needs of a canvas (an `HTMLCanvasElement` is one). */
export interface GlCanvas {
  isConnected: boolean;
  getContext(type: 'webgl' | 'webgl2'): { getExtension(name: string): unknown } | null;
}

/**
 * Releases the WebGL context of every given canvas that is no longer on the page (`which` = 'detached': the scenes
 * a redraw dropped), or of all of them ('all': the chart is going away). Returns how many were released.
 *
 * The charting library removes a 3D scene's canvas but leaves its context to the garbage collector. A browser allows
 * only a few live contexts (16 in Chromium), so after some changes of the 3D layout it warns "Too many active WebGL
 * contexts" and takes the oldest one away, which can belong to a scene that is on screen.
 */
export function releaseGlContexts(canvases: Iterable<GlCanvas>, which: 'detached' | 'all' = 'detached'): number {
  let released = 0;
  for (const canvas of canvases) {
    if (which === 'detached' && canvas.isConnected) continue;
    try {
      // A canvas that has a context answers only for its kind (null otherwise): this finds a scene's context, it makes none.
      const gl = canvas.getContext('webgl') ?? canvas.getContext('webgl2');
      const lose = gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null | undefined;
      if (!lose) continue;
      lose.loseContext();
      released++;
    } catch {
      // Nothing to release.
    }
  }
  return released;
}

/** The canvases inside a chart now: one per 3D scene (none in a 2D chart, which is drawn as SVG). */
export const canvasesOf = (el: ParentNode): GlCanvas[] => Array.from(el.querySelectorAll('canvas')) as unknown as GlCanvas[];
