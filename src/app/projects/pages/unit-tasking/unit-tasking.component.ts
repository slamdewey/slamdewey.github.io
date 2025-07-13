import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
} from '@angular/core';
import { BackdropComponent, EcsSceneBackdrop } from 'src/app/components/backdrop';
import { DebugGridComponent, EcsEntity } from 'src/app/lib/ecs';
import { ControllableCamera } from 'src/app/lib/ecs/camera';
import { CanvasContext2DRenderer } from 'src/app/lib/ecs/renderer';
import { EcsScene } from 'src/app/lib/ecs/scene';

/**
 * Scroll events are, for some reason, in delta intervals of 100
 */
export const ZoomScalar = 100;

class ShootingGameScene extends EcsScene<CanvasRenderingContext2D> {
  constructor() {
    const renderer = new CanvasContext2DRenderer();
    super('my scene', renderer);
    const cameraEntity = this.createEntity(EcsEntity, "Main Camera");
    const camera = cameraEntity.createComponent(ControllableCamera);
    cameraEntity.createComponent(DebugGridComponent);
    this.camera = camera;
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
  public sceneBackdrop = new EcsSceneBackdrop(new ShootingGameScene());

  ngOnDestroy(): void {
    this.sceneBackdrop.onDestroy();
  }

  @HostListener('window:keydown', ['$event'])
  onkeydown(e: KeyboardEvent) {
    this.sceneBackdrop.scene.handleInput(e, 'down');
  }

  @HostListener('window:keyup', ['$event'])
  onkeyup(e: KeyboardEvent) {
    this.sceneBackdrop.scene.handleInput(e, 'up');
  }

  @HostListener('mousewheel', ['$event'])
  public onSroll(e: WheelEvent) {
    e.preventDefault();
    const camera = this.sceneBackdrop.scene.camera;

    if (!camera) {
      return;
    }

    camera.updateZoom((zoom: number) => zoom - e.deltaY / ZoomScalar);
  }
}
