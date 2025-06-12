import { Backdrop } from './backdrop';
import { Vector2 } from 'src/app/lib/coordinate';
import { EcsCamera, EcsScene, VirtualAxis } from 'src/app/lib/ecs';

export class ControllableCamera extends EcsCamera {
  private readonly panSpeed = 500;
  private downUpInput: VirtualAxis;
  private leftRightInput: VirtualAxis;

  public override onAddedToScene(): void {
    const scene = this.scene!;
    // positive y axis goes downward, so I simply invert input
    this.downUpInput = scene.registerVirtualAxis('w', 's');
    this.leftRightInput = scene.registerVirtualAxis('a', 'd');
  }

  public override update(deltaTime: number): void {
    const transform = this.transform!;
    const rawInput = new Vector2(this.leftRightInput.rawValue, this.downUpInput.rawValue);
    rawInput.normalize();
    const moveDelta = Vector2.scale(rawInput, (this.panSpeed / this.getZoom()) * deltaTime);
    transform.position = Vector2.plus(transform.position, moveDelta);
  }
}

export class EcsSceneBackdrop extends Backdrop {
  public scene: EcsScene<CanvasRenderingContext2D>;
  private origin: Vector2 = new Vector2(0, 0);
  private viewport: Vector2 = new Vector2(0, 0);

  constructor(scene: EcsScene<CanvasRenderingContext2D>) {
    super();
    this.scene = scene;
  }

  override setSize(width: number, height: number): void {
    this.viewport = new Vector2(width, height);
    this.origin = new Vector2(width / 2, height / 2);
    super.setSize(width, height);
  }

  update(deltaTime: number): void {
    this.scene.update(deltaTime);
    this.scene.lateUpdate();
  }

  private renderGrid() {
    const interval = 100;
    const dimension = 20;
    const uvGradient = this.ctx.createLinearGradient(
      -dimension * interval,
      -dimension * interval,
      dimension * interval,
      dimension * interval
    );
    uvGradient.addColorStop(0, 'green');
    uvGradient.addColorStop(1, 'red');
    for (let x = -dimension; x < dimension + 1; x++) {
      this.ctx.beginPath();
      this.ctx.strokeStyle = x == 0 ? 'white' : uvGradient;
      this.ctx.lineWidth = 1;
      this.ctx.moveTo(x * interval, -dimension * interval);
      this.ctx.lineTo(x * interval, dimension * interval);
      this.ctx.stroke();
    }

    for (let y = -dimension; y < dimension + 1; y++) {
      this.ctx.beginPath();
      this.ctx.strokeStyle = y == 0 ? 'white' : uvGradient;
      this.ctx.lineWidth = 1;
      this.ctx.moveTo(-dimension * interval, y * interval);
      this.ctx.lineTo(dimension * interval, y * interval);
      this.ctx.stroke();
    }
  }

  override clear(): void {
    const camera = this.scene.getCamera();
    if (camera && camera.transform) {
      const pos = camera.transform.position;
      this.ctx.clearRect(
        pos.x - this.origin.x,
        pos.y - this.origin.y,
        this.viewport.x,
        this.viewport.y
      );
    } else {
      super.clear();
    }
  }

  draw(): void {
    const camera = this.scene.getCamera();
    if (camera) {
      this.ctx.setTransform(camera.getViewMatrix(this.origin));
    }
    this.renderGrid();
    this.scene.render(this.ctx);
  }
}
