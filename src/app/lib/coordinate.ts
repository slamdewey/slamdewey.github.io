export abstract class Coordinate {
  public abstract toArray(): number[];
  public abstract set(coords: number[]): this;

  public getHashCode(): number {
    return Coordinate.getHashCode(this);
  }

  public static getHashCode(coordinate: Coordinate) {
    const dimensions = coordinate.toArray();
    const bigNumber = 920140;
    let hash = 17;
    dimensions.forEach((val) => {
      hash = hash * bigNumber + val;
    });
    return hash;
  }

  public round() {
    const values = this.toArray();
    for (let i = 0; i < values.length; i++) {
      values[i] = Math.round(values[i]);
    }
    return this.set(values);
  }

  public static operate<T extends Coordinate>(
    x0: T,
    x1: T,
    operator: (x0: number, x1: number) => number,
    type: new (...args: any[]) => T
  ): T {
    const aCoords = x0.toArray();
    const bCoords = x1.toArray();
    const result: number[] = [];
    for (let i = 0; i < aCoords.length; i++) {
      result.push(operator(aCoords[i], bCoords[i]));
    }
    return new type().set(result) as T;
  }
}

export class Vector2 extends Coordinate {
  public x: number;
  public y: number;

  constructor(x?: number, y?: number) {
    super();
    [this.x, this.y] = [x ?? 0, y ?? 0];
  }

  public toArray() {
    return [this.x, this.y];
  }

  public set(coords: number[]): this {
    [this.x, this.y] = [coords[0], coords[1]];
    return this;
  }

  public magnitude(): number {
    return Math.sqrt(this.x ** 2 + this.y ** 2);
  }

  public normalize(): this {
    const magnitude = this.magnitude();
    if (!magnitude || magnitude === 0) {
      return this;
    }
    return this.set([this.x / magnitude, this.y / magnitude]);
  }

  public static plus<T extends Vector2>(x0: T, x1: T) {
    return Coordinate.operate(x0, x1, (a, b) => a + b, Vector2) as T;
  }

  public static minus<T extends Vector2>(x0: T, x1: T) {
    return Coordinate.operate(x0, x1, (a, b) => a - b, Vector2) as T;
  }

  public static scale<T extends Vector2>(x0: T, scalar: number) {
    return new Vector2().set([x0.x * scalar, x0.y * scalar]);
  }

  public static times<T extends Vector2>(x0: T, x1: T) {
    return Coordinate.operate(x0, x1, (a, b) => a * b, Vector2) as T;
  }

  public static dot<T extends Vector2>(x0: T, x1: T): number {
    const a = x0.toArray();
    const b = x1.toArray();
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  public rotate(angle: number): this {
    const x = this.x * Math.cos(angle) - this.y * Math.sin(angle);
    const y = this.x * Math.sin(angle) + this.y * Math.cos(angle);
    this.x = x;
    this.y = y;
    return this;
  }

  public static getAngle(x: number, y: number) {
    const normalized = new Vector2(x, y).normalize();
    return Math.atan2(normalized.y, normalized.x);
  }
}

export class AxialCoordinate extends Coordinate {
  public r: number;
  public q: number;

  constructor(q?: number, r?: number) {
    super();
    [this.q, this.r] = [q ?? 0, r ?? 0];
  }

  public toArray() {
    return [this.q, this.r];
  }

  public set(coords: number[]): this {
    [this.q, this.r] = [coords[0], coords[1]];
    return this;
  }

  public static plus<T extends AxialCoordinate>(x0: T, x1: T) {
    return Coordinate.operate(x0, x1, (a, b) => a + b, AxialCoordinate) as T;
  }

  public static minus<T extends AxialCoordinate>(x0: T, x1: T) {
    return Coordinate.operate(x0, x1, (a, b) => a - b, AxialCoordinate) as T;
  }
}

