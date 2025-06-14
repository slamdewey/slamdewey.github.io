import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
} from '@angular/core';
import { BackdropComponent, EcsSceneBackdrop } from 'src/app/components/backdrop';
import { ControllableCamera } from 'src/app/lib/ecs/camera';
import { EcsEntity } from 'src/app/lib/ecs/ecs';
import { CanvasContext2DRenderer } from 'src/app/lib/ecs/renderer';
import { EcsScene } from 'src/app/lib/ecs/scene';

/**
 * Scroll events are, for some reason, in delta intervals of 100
 */
export const ZoomScalar = 100;

class MyScene extends EcsScene<CanvasRenderingContext2D> {
  constructor() {
    const renderer = new CanvasContext2DRenderer();
    super('my scene', renderer);
    this.setCamera(new ControllableCamera());
  }
}

@Component({
  selector: 'x-unit-tasking',
  templateUrl: './unit-tasking.component.html',
  styleUrls: ['./unit-tasking.component.scss'],
  imports: [BackdropComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnitTaskingComponent implements OnDestroy {
  public sceneBackdrop = new EcsSceneBackdrop(new MyScene());
  public vesselEntity: EcsEntity;

  constructor() {
    afterNextRender(() => {
      this.sceneBackdrop.scene.add(this.vesselEntity);

      window.addEventListener('keydown', this.onkeydown.bind(this));
      window.addEventListener('keyup', this.onkeyup.bind(this));

      // Set canvas to take up full page width and height
      const canvasElement = document.getElementById('canvas');
      if (canvasElement) {
        canvasElement.style.width = '100%';
        canvasElement.style.height = '100vh';
      }
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.onkeydown.bind(this));
    window.removeEventListener('keyup', this.onkeyup.bind(this));
    this.sceneBackdrop.onDestroy();
  }

  onkeydown(e: KeyboardEvent) {
    this.sceneBackdrop.scene.handleInput(e, 'down');
  }

  onkeyup(e: KeyboardEvent) {
    this.sceneBackdrop.scene.handleInput(e, 'up');
  }

  @HostListener('mousewheel', ['$event'])
  public onSroll(e: WheelEvent) {
    e.preventDefault();
    const camera = this.sceneBackdrop.scene.getCamera() as ControllableCamera;
    camera?.updateZoom((zoom: number) => zoom - e.deltaY / ZoomScalar);
  }

  ngAfterViewInit() {
    this.vesselEntity = new EcsEntity('Vessel');
    this.sceneBackdrop.scene.add(this.vesselEntity);
  }
}
