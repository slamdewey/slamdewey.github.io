import { Backdrop } from './backdrop';
import { Vector2 } from 'src/app/shapes/coordinate';
import { EcsCamera, EcsEntity, EcsScene, VirtualAxis } from 'src/app/shapes/ecs';

class ControllableCamera extends EcsCamera {
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
  public cameraEntity: EcsEntity;
  private activeCamera: EcsCamera | undefined;

  constructor(scene: EcsScene<CanvasRenderingContext2D>) {
    super();
    this.scene = scene;
    this.cameraEntity = new EcsEntity('Main Camera');
    this.scene.add(this.cameraEntity);
  }

  override start(): void {
    /**
     * Every time we init here, we must re-create the camera, as the view port could have changed.
     * View port change is actually the most likely scenario to re-call this init.
     */
    const viewport = new Vector2(this.width, this.height);
    const newCamera = new ControllableCamera(viewport);

    if (this.activeCamera) {
      this.cameraEntity.removeComponent(this.activeCamera);
    }
    this.cameraEntity.addComponent(newCamera);
    this.activeCamera = newCamera;
    this.scene.camera = newCamera;
  }

  update(deltaTime: number): void {
    this.scene.update(deltaTime);
    this.scene.lateUpdate();
  }

  private renderGrid() {
    const interval = 100;
    const dimension = 5;
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

  /**
   * this override of clear does not allow for camera rotations!
   */
  public override clear(): void {
    if (this.scene.camera && this.scene.camera.transform) {
      const viewPort = this.scene.camera.viewPort;
      const pos = this.scene.camera.transform.position;
      this.ctx.clearRect(pos.x - viewPort.x / 2, pos.y - viewPort.y / 2, viewPort.x, viewPort.y);
    } else {
      super.clear();
    }
  }

  draw(): void {
    if (this.scene.camera) {
      this.ctx.setTransform(this.scene.camera.getViewMatrix());
    }
    this.renderGrid();
    this.scene.render(this.ctx);
  }
}
