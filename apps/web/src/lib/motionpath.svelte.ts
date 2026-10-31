/** Canva's "Create an animation": the element whose path is being drawn on the stage. */
class MotionDraw {
  id = $state<string | null>(null);
  start(id: string): void { this.id = id; }
  stop(): void { this.id = null; }
}
export const motionDraw = new MotionDraw();
