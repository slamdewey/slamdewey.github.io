import { EcsScene } from 'src/app/lib/ecs/scene';
import { Backdrop } from './backdrop';
import { Vector2 } from 'src/app/lib/coordinate';

export class EcsSceneBackdrop extends Backdrop {
  public scene: EcsScene<CanvasRenderingContext2D>;
  private origin: Vector2 = new Vector2(0, 0);
  private viewport: Vector2 = new Vector2(0, 0);

  constructor(scene: EcsScene<CanvasRenderingContext2D>) {
    super();
    this.scene = scene;
  }

  override setSize(width: number, height: number): void {
    this.viewport = new Vector2(width, height);
    this.origin = new Vector2(width / 2, height / 2);
    super.setSize(width, height);
  }

  update(deltaTime: number): void {
    this.scene.update(deltaTime);
    this.scene.lateUpdate();
  }

  override clear(): void {
    const camera = this.scene.camera;
    if (!camera) {
      super.clear()
      return;
    }
    
    const pos = camera.transform.position;
    this.ctx.clearRect(
      pos.x - this.origin.x,
      pos.y - this.origin.y,
      this.viewport.x,
      this.viewport.y
    );
  }

  draw(): void {
    const camera = this.scene.camera;
    if (camera) {
      this.ctx.setTransform(camera.getViewMatrix(this.origin));
    }
    this.scene.render(this.ctx);
  }
}
