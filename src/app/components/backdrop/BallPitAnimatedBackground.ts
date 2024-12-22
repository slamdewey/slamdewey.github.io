import { Vector2 } from 'src/app/shapes/coordinate';
import { Backdrop } from './backdrop';

const COLORS = [
  //'#fb8537',
  //'#fb9550'
  '#353535',
  '#282828',
];
const CIRCLE_SPAWN_DENSITY = 8_000;
const MIN_RADIUS = 10;
const MAX_RADIUS = 25;
const MAX_GROW_MULTIPLIER = 3;
const MAX_SPAWN_VELOCITY = 20;
const MAX_GROW_RANGE = 300;
const MIN_GROW_RANGE = 30;

function randomRange(min: number, max: number) {
  return Math.random() * (max - min) + min;
}
function lerp(start: number, end: number, percentage: number) {
  return (1 - percentage) * start + percentage * end;
}

class Circle {
  public position: Vector2;
  public velocity: Vector2;
  public radius: number;
  public radiusMultiplier: number;
  public color: number;

  constructor(x: number, y: number, vx: number, vy: number, radius: number, color: number) {
    this.position = new Vector2(x, y);
    this.velocity = new Vector2(vx, vy);
    this.radius = radius;
    this.radiusMultiplier = 1;
    this.color = color;
  }

  update(deltaTime: number, mousePosition: Vector2) {
    this.position.x += this.velocity.x * deltaTime;
    this.position.y += this.velocity.y * deltaTime;

    if (mousePosition === undefined) return;
    const dif: Vector2 = new Vector2(
      mousePosition.x - this.position.x,
      mousePosition.y - this.position.y
    );
    const length: number = Math.sqrt(dif.x * dif.x + dif.y * dif.y);

    // make the circles grow when in range of cursor
    if (length > MAX_GROW_RANGE) this.radiusMultiplier = 1;
    else if (length < MIN_GROW_RANGE) this.radiusMultiplier = MAX_GROW_MULTIPLIER;
    else {
      const distanceAsPercentage = (MAX_GROW_RANGE - length) / (MAX_GROW_RANGE - MIN_GROW_RANGE);
      this.radiusMultiplier = lerp(
        1,
        MAX_GROW_MULTIPLIER,
        distanceAsPercentage * distanceAsPercentage * distanceAsPercentage
      );
      if (this.radiusMultiplier < 1) console.log('err');
    }
  }

  draw(c: CanvasRenderingContext2D) {
    c.beginPath();
    c.arc(this.position.x, this.position.y, this.radius * this.radiusMultiplier, 0, Math.PI * 2);
    c.fillStyle = COLORS[this.color];
    c.fill();
  }
}

export class BallPitAnimatedBackground extends Backdrop {
  circles: Circle[];

  override start(): void {
    this.circles = [];
    const NUM_CIRCLES = Math.round((this.width * this.height) / CIRCLE_SPAWN_DENSITY);
    for (let i = 0; i < NUM_CIRCLES; i++) {
      const radius = randomRange(MIN_RADIUS, MAX_RADIUS);
      const xSpawn = randomRange(0, this.width);
      const ySpawn = randomRange(0, this.height);
      const xSpawnVel = randomRange(-MAX_SPAWN_VELOCITY, MAX_SPAWN_VELOCITY);
      const ySpawnVel = randomRange(-MAX_SPAWN_VELOCITY, MAX_SPAWN_VELOCITY);

      this.circles.push(
        new Circle(xSpawn, ySpawn, xSpawnVel, ySpawnVel, radius, i % COLORS.length)
      );
    }
  }

  update(deltaTime: number): void {
    const swappedAxisMousePosition = new Vector2(
      this.mousePosition.x,
      this.height - this.mousePosition.y
    );
    this.circles.forEach((circle) => {
      circle.update(deltaTime, swappedAxisMousePosition);
      if (
        (circle.position.x <= 0 && circle.velocity.x < 0) ||
        (circle.position.x >= this.width && circle.velocity.x > 0)
      )
        circle.velocity.x = -circle.velocity.x;
      if (
        (circle.position.y <= 0 && circle.velocity.y < 0) ||
        (circle.position.y >= this.height && circle.velocity.y > 0)
      )
        circle.velocity.y = -circle.velocity.y;
    });
  }
  draw(): void {
    this.circles.forEach((circle) => {
      circle.draw(this.ctx);
    });
  }
}
