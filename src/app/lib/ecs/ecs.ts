import { Vector2 } from '../coordinate';
import { EcsScene } from './scene';

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

export class EcsComponent {
  public scene: EcsScene<RenderingContext> | undefined;
  public entity: EcsEntity | undefined;
  public transform: EcsTransform | undefined;
  private _isActive: boolean = true;

  public isActive(): boolean {
    return this._isActive;
  }
  public setActive(state: boolean) {
    this._isActive = state;
    if (state) {
      this.onActivate();
    } else {
      this.onDeactivate();
    }
  }

  public onActivate(): void {}
  public onDeactivate(): void {}
  public onAddedToScene(): void {}
  public onRemovedFromScene(): void {}
  public onAddedToEntity(): void {}
  public onRemovedFromEntity(): void {}

  public update(deltaTime: number): void {}
  public lateUpdate(): void {}
  public onDestroy(): void {}
}

export abstract class EcsRenderableComponent extends EcsComponent {
  public abstract render(ctx: RenderingContext): void;
}

export class EcsEntity {
  public name: string;
  public transform: EcsTransform = new EcsTransform();
  public components: Set<EcsComponent> = new Set();
  public scene: EcsScene<RenderingContext> | undefined;
  private _isActive: boolean = true;

  constructor(name: string) {
    this.name = name;
  }

  public addComponent<T extends EcsComponent>(component: T): this {
    component.entity = this;
    component.transform = this.transform;
    this.components.add(component);
    this.scene?.add(component);
    component.onAddedToEntity();
    return this;
  }

  public removeComponent<T extends EcsComponent>(component: T): this {
    this.components.delete(component);
    this.scene?.remove(component);
    component.onRemovedFromEntity();
    component.entity = component.transform = undefined;
    return this;
  }

  public isActive(): boolean {
    return this._isActive;
  }

  public setActive(state: boolean) {
    this._isActive = state;
    this.components?.forEach((component) => {
      component.setActive(state);
    });
  }

  public getComponent<T extends EcsComponent>(type: new (...args: any[]) => T): T | undefined {
    const iterator = this.components.values();
    let component = iterator.next();
    while (component !== undefined) {
      if (component instanceof type) {
        return component as T;
      } else {
        component = iterator.next();
      }
    }
    return undefined;
  }

  public getComponents<T extends EcsComponent>(type: new (...args: any[]) => T): T[] {
    const iterator = this.components.values();
    let component = iterator.next()?.value;
    const result: T[] = [];
    while (component !== undefined) {
      if (component instanceof type) {
        result.push(component as T);
      }
      component = iterator.next()?.value;
    }
    return result;
  }

  public onDestroy() {
    const iterator = this.components.values();
    let component = iterator.next()?.value;
    while (component !== undefined) {
      component.onDestroy();
      component = iterator.next()?.value;
    }
    this.transform.onDestroy();
  }
}
