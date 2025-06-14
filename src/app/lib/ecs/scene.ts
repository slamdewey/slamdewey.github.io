import { EcsCamera } from './camera';
import { EcsEntity, EcsComponent, EcsRenderableComponent } from './ecs';
import { EcsRenderer } from './renderer';

export type InputCallback = (e: KeyboardEvent) => void;

export type KeyEventType = 'down' | 'up';

export type VirtualAxis = {
  negativeKey: string;
  positiveKey: string;
  rawValue: number;
  incrementRawValue: () => void;
  decrementRawValue: () => void;
};

const buildInputCode = (key: string, type: KeyEventType) => {
  return `${key}-${type}`;
};
/**
 * no lights, no collision detection, no problem!
 */
export class EcsScene<ctx extends RenderingContext> {
  public name: string;
  /**
   * must be manually assigned to the camera you wish to use
   */
  private camera: EcsCamera | undefined = undefined;
  private cameraEntity: EcsEntity = new EcsEntity('Main Camera');

  protected readonly entities: Set<EcsEntity> = new Set();
  protected readonly components: Set<EcsComponent> = new Set();
  protected readonly renderables: Set<EcsRenderableComponent> = new Set();
  protected readonly renderer: EcsRenderer<ctx>;
  protected readonly inputMap = new Map<string, InputCallback[]>();
  protected readonly keyStateMap = new Map<string, KeyEventType>();
  protected readonly virtualAxes = new Set<VirtualAxis>();

  constructor(name: string, renderer: EcsRenderer<ctx>) {
    this.name = name;
    this.renderer = renderer;
    this.addEntity(this.cameraEntity);
  }

  public setCamera(camera: EcsCamera): void {
    const oldCamera = this.camera;
    this.cameraEntity.addComponent(camera);
    this.camera = camera;
    if (oldCamera) {
      this.cameraEntity.removeComponent(oldCamera);
    }
  }

  public getCamera: () => EcsCamera | undefined = () => this.camera;

  public registerInputCallback(key: string, type: KeyEventType, callback: InputCallback): void {
    const inputCode = buildInputCode(key, type);
    const registeredCallbacks = this.inputMap.get(inputCode);
    if (!registeredCallbacks) {
      this.inputMap.set(inputCode, [callback]);
    } else {
      registeredCallbacks.push(callback);
    }
  }

  public deleteInputCallback(key: string, type: KeyEventType, callback: InputCallback): void {
    const inputCode = buildInputCode(key, type);
    const registeredCallbacks = this.inputMap.get(inputCode);
    if (!registeredCallbacks) {
      return;
    }
    registeredCallbacks.filter((cb) => cb !== callback);
  }

  public registerVirtualAxis(negativeKey: string, positiveKey: string): VirtualAxis {
    const virtualAxis: VirtualAxis = {
      negativeKey,
      positiveKey,
      rawValue: 0,
      incrementRawValue: () => {
        virtualAxis.rawValue++;
      },
      decrementRawValue: () => {
        virtualAxis.rawValue--;
      },
    };
    this.virtualAxes.add(virtualAxis);
    this.registerInputCallback(negativeKey, 'down', virtualAxis.decrementRawValue);
    this.registerInputCallback(negativeKey, 'up', virtualAxis.incrementRawValue);
    this.registerInputCallback(positiveKey, 'down', virtualAxis.incrementRawValue);
    this.registerInputCallback(positiveKey, 'up', virtualAxis.decrementRawValue);

    return virtualAxis;
  }

  public deleteVirtualAxis(virtualAxis: VirtualAxis) {
    this.deleteInputCallback(virtualAxis.negativeKey, 'down', virtualAxis.decrementRawValue);
    this.deleteInputCallback(virtualAxis.negativeKey, 'up', virtualAxis.incrementRawValue);
    this.deleteInputCallback(virtualAxis.positiveKey, 'down', virtualAxis.incrementRawValue);
    this.deleteInputCallback(virtualAxis.positiveKey, 'up', virtualAxis.decrementRawValue);
  }

  public handleInput(e: KeyboardEvent, type: KeyEventType) {
    const inputCode = buildInputCode(e.key, type);
    // do we have a callback for this event type?
    if (!this.inputMap.has(inputCode)) {
      return;
    }
    // we have input for this event, so ignore default
    e.preventDefault();
    // now we check if we should actually process this event
    if (this.keyStateMap.has(e.key) && this.keyStateMap.get(e.key) === type) {
      // this key is being held down; ignore this event
      return;
    }
    // update keystate and execute callbacks
    this.keyStateMap.set(e.key, type);
    this.inputMap.get(inputCode)!.forEach((cb) => cb(e));
  }

  public update(deltaTime: number): void {
    this.components.forEach((c) => c.update(deltaTime));
  }

  public lateUpdate() {
    this.components.forEach((c) => c.lateUpdate());
  }

  public render(ctx: ctx) {
    this.renderer.render(ctx, this.renderables);
  }

  public add(item: EcsComponent | EcsEntity): void {
    if (item instanceof EcsEntity) {
      this.addEntity(item);
    } else {
      this.addComponent(item);
    }
  }
  public remove(item: EcsComponent | EcsEntity): void {
    if (item instanceof EcsEntity) {
      this.removeEntity(item);
    } else {
      this.removeComponent(item);
    }
  }

  private addComponent<T extends EcsComponent>(c: T): void {
    this.components.add(c);
    c.scene = this;
    if (c instanceof EcsRenderableComponent) {
      this.renderables.add(c);
    }
    c.onAddedToScene();
  }
  private addEntity<T extends EcsEntity>(e: T) {
    this.entities.add(e);
    e.scene = this;
    e.components.forEach((c) => this.addComponent(c));
  }

  private removeComponent<T extends EcsComponent>(c: T): void {
    this.components.delete(c);
    c.scene = undefined;
    if (c instanceof EcsRenderableComponent) {
      this.renderables.delete(c);
    }
    c.onRemovedFromScene();
  }
  private removeEntity<T extends EcsEntity>(e: T) {
    this.entities.delete(e);
    e.scene = undefined;
    e.components.forEach((c) => this.removeComponent(c));
  }
}
