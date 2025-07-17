import { EcsEntity } from './entity';
import { Vector2 } from '../coordinate';

export type EntityFactory<T extends EcsEntity> = (position: Vector2, rotation: number) => T;

export class ObjectPool<T extends EcsEntity> {
  private pool: T[] = [];
  private createFn: EntityFactory<T>;

  constructor(createFn: EntityFactory<T>, initialSize = 0) {
    this.createFn = createFn;
    for (let i = 0; i < initialSize; i++) {
      const obj = this.createFn(new Vector2(), 0);
      obj.setActive(false);
      this.pool.push(obj);
    }
  }

  public instantiate(position: Vector2, rotation: number): T {
    let obj: T;
    if (this.pool.length > 0) {
      obj = this.pool.pop()!;
    } else {
      obj = this.createFn(position, rotation);
    }
    obj.transform.position = position;
    obj.transform.rotation = rotation;
    obj.setActive(true);
    return obj;
  }

  public release(obj: T): void {
    obj.setActive(false);
    this.pool.push(obj);
  }
}
