import { EcsTransform } from './transform';
import { Vector2 } from '../coordinate';
import { Collider } from './collider';

export abstract class Shape {
  public abstract getAxes(transform: EcsTransform): Vector2[];
  public abstract project(axis: Vector2, transform: EcsTransform): { min: number; max: number };
}

export class Rectangle extends Shape {
  constructor(
    public width: number,
    public height: number,
    public offset: Vector2 = new Vector2()
  ) {
    super();
  }

  public getAxes(transform: EcsTransform): Vector2[] {
    // For a rectangle, the axes are its normalized edge normals
    return [
      new Vector2(1, 0).rotate(transform.rotation), // Horizontal axis
      new Vector2(0, 1).rotate(transform.rotation), // Vertical axis
    ];
  }

  public project(axis: Vector2, transform: EcsTransform): { min: number; max: number } {
    const halfWidth = this.width / 2;
    const halfHeight = this.height / 2;

    const vertices = [
      new Vector2(-halfWidth, -halfHeight),
      new Vector2(halfWidth, -halfHeight),
      new Vector2(-halfWidth, halfHeight),
      new Vector2(halfWidth, halfHeight),
    ];

    // Transform the offset
    const transformedOffset = new Vector2(this.offset.x * transform.scale, this.offset.y * transform.scale).rotate(
      transform.rotation
    );

    let min = Infinity;
    let max = -Infinity;

    for (const vertex of vertices) {
      const transformedVertex = new Vector2(vertex.x * transform.scale, vertex.y * transform.scale).rotate(
        transform.rotation
      );

      const finalVertex = Vector2.plus(Vector2.plus(transformedVertex, transformedOffset), transform.position);

      const projection = Vector2.dot(finalVertex, axis);
      min = Math.min(min, projection);
      max = Math.max(max, projection);
    }

    return { min, max };
  }
}

export class SAT {
  public static intersects(colliderA: Collider, colliderB: Collider): boolean {
    const axes = [...colliderA.shape.getAxes(colliderA.transform), ...colliderB.shape.getAxes(colliderB.transform)];

    for (const axis of axes) {
      const projectionA = colliderA.shape.project(axis, colliderA.transform);
      const projectionB = colliderB.shape.project(axis, colliderB.transform);

      // Check for overlap
      if (projectionA.max < projectionB.min || projectionB.max < projectionA.min) {
        return false; // Separating axis found
      }
    }

    return true; // No separating axis found, shapes are colliding
  }
}
