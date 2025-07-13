import { afterNextRender, ChangeDetectionStrategy, Component, HostListener, OnDestroy, inject } from '@angular/core';
import { BackdropComponent, EcsSceneBackdrop } from 'src/app/components/backdrop';
import {
  CanvasContext2DRenderer,
  EcsScene,
  EcsEntity,
  TransformFollowCamera,
  DebugGridComponent,
  EcsCamera,
} from 'src/app/lib/ecs';
import { Player } from './player';
import { Enemy } from './enemy';
import { Vector2 } from 'src/app/lib/coordinate';
import { ScoreRenderable } from './score';
import { ShootingGameActions, ShootingGameAxes } from './game-input';

/**
 * Scroll events are, for some reason, in delta intervals of 100
 */
export const ZoomScalar = 100;

class MyScene extends EcsScene<CanvasRenderingContext2D> {
  public score: number = 0;

  private incrementScore = () => this.score++;

  constructor() {
    // setup scene
    const renderer = new CanvasContext2DRenderer();
    super('my scene', renderer);

    this.debug = true;

    // setup camera
    const cameraEntity = this.createEntity(EcsEntity, 'Main Camera');
    const camera = cameraEntity.createComponent(TransformFollowCamera);
    cameraEntity.createComponent(DebugGridComponent);
    this.camera = camera;

    // setup player
    this.createEntity(Player, 'Player');
    this.createEntity(Enemy, 'Enemy1', new Vector2(100, 100), this.incrementScore);
    this.createEntity(Enemy, 'Enemy2', new Vector2(-100, -100), this.incrementScore);
    const scoreEntity = this.createEntity(EcsEntity, 'Score');
    scoreEntity.createComponent(ScoreRenderable, () => this.score);

    // setup inputs
    this.addVirtualAxisBinding('w', 's', ShootingGameAxes.MoveY);
    this.addVirtualAxisBinding('a', 'd', ShootingGameAxes.MoveX);

    this.addVirtualAxisBinding('ArrowUp', 'ArrowDown', ShootingGameAxes.AimY, ShootingGameActions.Shoot);
    this.addVirtualAxisBinding('ArrowLeft', 'ArrowRight', ShootingGameAxes.AimX, ShootingGameActions.Shoot);
  }
}

@Component({
  selector: 'x-shooting-game',
  templateUrl: './shooting-game.component.html',
  styleUrls: ['./shooting-game.component.scss'],
  imports: [BackdropComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShootingGameComponent implements OnDestroy {
  public sceneBackdrop = new EcsSceneBackdrop(new MyScene());

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
    const camera = this.sceneBackdrop.scene.camera;
    if (!camera) {
      return;
    }
    e.preventDefault();
    camera.updateZoom((zoom: number) => zoom - e.deltaY / ZoomScalar);
  }
}

