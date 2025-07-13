import { Vector2 } from '../coordinate';

export class EcsTransform {
  public position: Vector2 = new Vector2();
  public scale: number = 1;
  public rotation: number = 0;
  public parent: EcsTransform | undefined;
  private children: Set<EcsTransform> = new Set();

  public forward(): Vector2 {
    return new Vector2(Math.cos(this.rotation), Math.sin(this.rotation));
  }

  public addChild(child: EcsTransform) {
    this.children.add(child);
  }

  public removeChild(child: EcsTransform) {
    this.children.delete(child);
  }

  public onDestroy() {
    this.parent?.removeChild(this);
    this.children.forEach((child) => {
      child.parent = undefined;
    });
  }

  public getTransformationMatrix(): DOMMatrix {
    return new DOMMatrix()
      .translate(this.position.x, this.position.y)
      .rotate(0, 0, this.rotation)
      .scale(this.scale, this.scale, this.scale);
  }
}