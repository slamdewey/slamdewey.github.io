import { EcsScene } from '@ecs/ecs-scene';
import { Canvas2dBackdrop } from './backdrop';

export class EcsSceneBackdrop extends Canvas2dBackdrop {
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
