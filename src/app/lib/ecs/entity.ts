import { EcsComponent } from './component';
import { EcsScene } from './scene';
import { EcsTransform } from './transform';
import { EcsObject } from './ecs-object';

export class EcsEntity extends EcsObject {
  public name: string;
  public transform: EcsTransform = new EcsTransform();
  public components = new Set<EcsComponent>();
  public readonly scene: EcsScene<RenderingContext>;

  constructor(scene: EcsScene<RenderingContext>, name: string) {
    super();
    this.name = name;
    this.scene = scene;
  }

  public createComponent<T extends EcsComponent, ComponentArgs extends any[]>(
    componentType: new (
      scene: EcsScene<RenderingContext>,
      entity: EcsEntity,
      transform: EcsTransform,
      ...args: ComponentArgs
    ) => T,
    ...args: ComponentArgs
  ): T {
    const component = new componentType(this.scene, this, this.transform, ...args);
    this.components.add(component);
    this.scene.add(component);
    component.onAddedToEntity();
    return component;
  }

  public removeComponent<T extends EcsComponent>(component: T): this {
    this.components.delete(component);
    this.scene.remove(component);
    component.onRemovedFromEntity();
    return this;
  }

  public getComponent<T extends EcsComponent>(type: new (...args: any[]) => T): T | undefined {
    for (const component of this.components) {
      if (component instanceof type) {
        return component as T;
      }
    }
    return undefined;
  }

  public getComponents<T extends EcsComponent>(type: new (...args: any[]) => T): T[] {
    const result: T[] = [];
    for (const component of this.components) {
      if (component instanceof type) {
        result.push(component as T);
      }
    }
    return result;
  }

  public override setActive(state: boolean) {
    super.setActive(state);
    this.components.forEach((component) => {
      component.setActive(state);
    });
  }

  public override onDestroy() {
    const iterator = this.components.values();
    let component = iterator.next()?.value;
    while (component !== undefined) {
      component.onDestroy();
      component = iterator.next()?.value;
    }
    this.transform.onDestroy();
  }
}
