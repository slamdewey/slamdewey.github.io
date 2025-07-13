import { EcsScene } from 'src/app/lib/ecs/scene';
import { Backdrop } from './backdrop';

export class EcsSceneBackdrop extends Backdrop {
  public scene: EcsScene<CanvasRenderingContext2D>;

  constructor(scene: EcsScene<CanvasRenderingContext2D>) {
    super();
    this.scene = scene;
  }

  update(deltaTime: number): void {
    this.scene.update(deltaTime);
    this.scene.lateUpdate();
  }

  draw(): void {
    this.scene.render(this.ctx);
  }
}
