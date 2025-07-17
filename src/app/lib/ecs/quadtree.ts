import { Collider } from './collider';
import { Vector2 } from '../coordinate';
import { Bounds } from './scene';

export class Quadtree {
  private maxObjects = 10;
  private maxLevels = 4;

  private level: number;
  private bounds: Bounds;
  private objects: Collider[] = [];
  private nodes: Quadtree[] = [];

  constructor(level: number, bounds: Bounds) {
    this.level = level;
    this.bounds = bounds;
  }

  /*
   * Clears the quadtree
   */
  public clear(): void {
    this.objects = [];
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i]) {
        this.nodes[i].clear();
      }
    }
    this.nodes = [];
  }

  /*
   * Splits the node into 4 subnodes
   */
  private split(): void {
    const subWidth = this.bounds.width / 2;
    const subHeight = this.bounds.height / 2;
    const x = this.bounds.x;
    const y = this.bounds.y;

    // Top right node
    this.nodes[0] = new Quadtree(this.level + 1, { x: x + subWidth, y: y, width: subWidth, height: subHeight });
    // Top left node
    this.nodes[1] = new Quadtree(this.level + 1, { x: x, y: y, width: subWidth, height: subHeight });
    // Bottom left node
    this.nodes[2] = new Quadtree(this.level + 1, { x: x, y: y + subHeight, width: subWidth, height: subHeight });
    // Bottom right node
    this.nodes[3] = new Quadtree(this.level + 1, {
      x: x + subWidth,
      y: y + subHeight,
      width: subWidth,
      height: subHeight,
    });
  }

  /*
   * Determine which node the object belongs to.
   * -1 means object cannot completely fit within a child node and is part of the parent node
   */
  private getIndex(collider: Collider): number {
    let index = -1;
    const verticalMidpoint = this.bounds.x + this.bounds.width / 2;
    const horizontalMidpoint = this.bounds.y + this.bounds.height / 2;

    // Object can completely fit within the top quadrants
    const startX = collider.transform.position.x + collider.shape.project(new Vector2(1, 0), collider.transform).min;
    const endX = collider.transform.position.x + collider.shape.project(new Vector2(1, 0), collider.transform).max;
    const startY = collider.transform.position.y + collider.shape.project(new Vector2(0, 1), collider.transform).min;
    const endY = collider.transform.position.y + collider.shape.project(new Vector2(0, 1), collider.transform).max;

    const fitsTop = endY < horizontalMidpoint;
    const fitsBottom = startY > horizontalMidpoint;

    // Object can completely fit within the left quadrants
    if (endX < verticalMidpoint) {
      if (fitsTop) {
        index = 1;
      } else if (fitsBottom) {
        index = 2;
      }
    } else if (startX > verticalMidpoint) {
      // Object can completely fit within the right quadrants
      if (fitsTop) {
        index = 0;
      } else if (fitsBottom) {
        index = 3;
      }
    }

    return index;
  }

  /*
   * Inserts an object into the quadtree.
   * If the node exceeds the capacity, it will split and add all objects to their corresponding nodes.
   */
  public insert(collider: Collider): void {
    if (this.nodes.length) {
      const index = this.getIndex(collider);

      if (index !== -1) {
        this.nodes[index].insert(collider);
        return;
      }
    }

    this.objects.push(collider);

    if (this.objects.length > this.maxObjects && this.level < this.maxLevels) {
      if (!this.nodes.length) {
        this.split();
      }

      let i = 0;
      while (i < this.objects.length) {
        const index = this.getIndex(this.objects[i]);
        if (index !== -1) {
          this.nodes[index].insert(this.objects.splice(i, 1)[0]);
        } else {
          i++;
        }
      }
    }
  }

  /*
   * Return all objects that could collide with the given object
   */
  public retrieve(collider: Collider): Collider[] {
    const index = this.getIndex(collider);
    let returnObjects = this.objects;

    if (this.nodes.length) {
      if (index !== -1) {
        returnObjects = returnObjects.concat(this.nodes[index].retrieve(collider));
      } else {
        // If the object doesn't fit in a child node, check all child nodes
        for (let i = 0; i < this.nodes.length; i++) {
          returnObjects = returnObjects.concat(this.nodes[i].retrieve(collider));
        }
      }
    }

    return returnObjects;
  }
}
