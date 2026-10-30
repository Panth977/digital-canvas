/** The mask brush: which tool is painting on which picture. The overlay itself is `editor/ImageBrush.svelte`. */
import type { BrushTool } from './tools.svelte.ts';

class Brush {
  /** The image element being painted on. */
  id = $state<string | null>(null);
  tool = $state<BrushTool>('blur');
  /** Painting in or taking away. */
  mode = $state<'add' | 'remove'>('add');
  /** On-screen brush width, CSS px. */
  size = $state(40);
  /** Blur strength, 0..100. */
  intensity = $state(60);
  /** Magic Edit's description. */
  prompt = $state('');
  /** Show the untouched picture (BG Remover). */
  showOriginal = $state(false);

  open(id: string, tool: BrushTool): void {
    this.id = id;
    this.tool = tool;
    this.mode = tool === 'bg' ? 'remove' : 'add';
    this.prompt = '';
    this.showOriginal = false;
  }

  close(): void {
    this.id = null;
  }
}

export const brush = new Brush();
