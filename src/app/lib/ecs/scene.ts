import { EcsCamera } from './camera';
import { EcsRenderer } from './renderer';
import { Collider } from './collider';
import { EcsComponent, EcsRenderableComponent } from './component';
import { EcsEntity } from './entity';
import { ActionListener, KeyEventType, KeyBinding, ActionKeyBinding, AxisKeyBinding } from './input';
import { SAT } from './geometry';
import { Quadtree } from './quadtree';

export interface Bounds { x: number; y: number; width: number; height: number }

/**
 * no lights, no problem!
 */
export class EcsScene<ctx extends RenderingContext> {
  public name: string;
  /**
   * must be manually assigned to the camera you wish to use
   */
  public camera: EcsCamera | undefined = undefined;
  public debug = false;

  protected readonly entities = new Set<EcsEntity>();
  protected readonly components = new Set<EcsComponent>();
  protected readonly renderables = new Set<EcsRenderableComponent>();
  protected readonly collidables = new Set<Collider>();
  protected readonly renderer: EcsRenderer<ctx>;
  protected readonly keyStateMap = new Map<string, KeyEventType>();
  public collisionMatrix = new Map<string, Set<string>>();

  protected readonly worldBounds: Bounds;
  protected readonly quadtree: Quadtree;

  private actionListeners = new Map<string, Set<ActionListener>>();
  private axisValues = new Map<string, number>();
  private keyBindings = new Map<string, KeyBinding[]>();

  constructor(name: string, renderer: EcsRenderer<ctx>, worldBounds: Bounds) {
    this.name = name;
    this.renderer = renderer;
    this.worldBounds = worldBounds;
    this.quadtree = new Quadtree(0, this.worldBounds);
  }

  public registerActionListener(action: string, listener: ActionListener): void {
    if (!this.actionListeners.has(action)) {
      this.actionListeners.set(action, new Set());
    }
    this.actionListeners.get(action)?.add(listener);
  }

  public deregisterActionListener(action: string, listener: ActionListener): void {
    this.actionListeners.get(action)?.delete(listener);
  }

  public getAxisValue(axis: string): number {
    return this.axisValues.get(axis) || 0;
  }

  public addKeyBinding(key: string, binding: KeyBinding): void {
    if (!this.keyBindings.has(key)) {
      this.keyBindings.set(key, []);
    }
    this.keyBindings.get(key)?.push(binding);
  }

  public addVirtualAxisBinding(negativeKey: string, positiveKey: string, axis: string, action?: string): void {
    this.addKeyBinding(negativeKey, { axis, axisDirection: -1, action });
    this.addKeyBinding(positiveKey, { axis, axisDirection: 1, action });
  }

  public handleInput(e: KeyboardEvent, type: KeyEventType) {
    const bindings = this.keyBindings.get(e.key);
    if (!bindings) {
      return;
    }

    e.preventDefault();

    // Prevent repeated events for held keys if not desired
    if (this.keyStateMap.has(e.key) && this.keyStateMap.get(e.key) === type) {
      return;
    }
    this.keyStateMap.set(e.key, type);

    bindings.forEach((binding) => {
      const axisBinding = binding as AxisKeyBinding;
      if (axisBinding.axis !== undefined && axisBinding.axisDirection !== undefined) {
        const currentValue = this.axisValues.get(axisBinding.axis) || 0;
        const polarity = type === 'down' ? 1 : -1;
        const newValue = currentValue + axisBinding.axisDirection * polarity;
        this.axisValues.set(axisBinding.axis, newValue);
      }

      const actionBinding = binding as ActionKeyBinding;
      if (type !== 'up' && actionBinding.action !== undefined) {
        this.actionListeners.get(actionBinding.action)?.forEach((listener) => listener());
      }
    });
  }

  public update(deltaTime: number): void {
    this.components.forEach((c) => c.update(deltaTime));
  }

  public lateUpdate() {
    this.components.forEach((c) => c.lateUpdate());

    this.quadtree.clear();
    for (const collider of this.collidables) {
      this.quadtree.insert(collider);
    }

    const checkedPairs = new Set<bigint>();

    for (const colliderA of this.collidables) {
      const potentialCollisions = this.quadtree.retrieve(colliderA);

      for (const colliderB of potentialCollisions) {
        if (colliderA === colliderB) {
          continue;
        }

        // Ensure each pair is checked only once
        const pairId = (BigInt(colliderA.id) << 32n) | BigInt(colliderB.id);
        if (checkedPairs.has(pairId)) {
          continue;
        }
        checkedPairs.add(pairId);

        // Check collision matrix
        if (!this.canCollide(colliderA.layer, colliderB.layer)) {
          continue;
        }

        // Perform SAT collision check
        if (SAT.intersects(colliderA, colliderB)) {
          colliderA.onCollision(colliderB.entity);
          colliderB.onCollision(colliderA.entity);
        }
      }
    }
  }

  private canCollide(layerA: string, layerB: string): boolean {
    const collidesWith = this.collisionMatrix.get(layerA);
    return collidesWith ? collidesWith.has(layerB) : false;
  }

  public render(ctx: ctx) {
    if (!this.camera) {
      throw new Error('Cannot render without camera');
    }
    this.renderer.render(ctx, this.components, this.camera, this.debug);
  }

  public createEntity<T extends EcsEntity, EntityArgs extends any[]>(
    entityType: new (scene: EcsScene<RenderingContext>, name: string, ...args: EntityArgs) => T,
    name: string,
    ...args: EntityArgs
  ): T {
    const entity = new entityType(this, name, ...args);
    this.addEntity(entity);
    return entity;
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
    if (c instanceof EcsRenderableComponent) {
      this.renderables.add(c);
    } else if (c instanceof Collider) {
      this.collidables.add(c);
    }
    c.onAddedToScene();
  }

  private addEntity<T extends EcsEntity>(e: T) {
    this.entities.add(e);
    e.components.forEach((c) => this.addComponent(c));
  }

  private removeComponent<T extends EcsComponent>(c: T): void {
    this.components.delete(c);
    if (c instanceof EcsRenderableComponent) {
      this.renderables.delete(c);
    } else if (c instanceof Collider) {
      this.collidables.delete(c);
    }
    c.onRemovedFromScene();
  }

  private removeEntity<T extends EcsEntity>(e: T) {
    this.entities.delete(e);
    e.components.forEach((c) => this.removeComponent(c));
  }
}
