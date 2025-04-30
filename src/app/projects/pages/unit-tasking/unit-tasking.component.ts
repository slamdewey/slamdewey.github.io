import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
} from '@angular/core';
import { BackdropComponent, EcsSceneBackdrop } from 'src/app/components/backdrop';
import { AxialCoordinate } from 'src/app/shapes/coordinate';
import { CanvasContext2DRenderer, EcsEntity, EcsScene } from 'src/app/shapes/ecs';
import {
  generateTileMap,
  MapGenerationRequest,
  MapGenerationResponse,
  NoiseVariables,
} from 'src/app/shapes/map-generation';
import { HexTileMap } from 'src/app/shapes/tilemap';
import { Unit } from 'src/app/shapes/unit-tasking';
import { SpecularHexMapGenerator } from 'src/app/util/map-generation';

/**
 * Scroll events are, for some reason, in delta intervals of 100
 */
export const ZoomScalar = 100;

class MyScene extends EcsScene<CanvasRenderingContext2D> {
  constructor() {
    super('EcsSceneBackdrop Scene', new CanvasContext2DRenderer());
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
  public units: Unit[];
  public sceneBackdrop = new EcsSceneBackdrop(new MyScene());
  public tileMapEntity = new EcsEntity('HexMap');
  public tileMap: HexTileMap | undefined;

  constructor() {
    this.sceneBackdrop.scene.add(this.tileMapEntity);

    afterNextRender(() => {
      const req = {
        columns: 50,
        columnHeight: 50,
        algorithm: SpecularHexMapGenerator,
        noiseVariables: {} as NoiseVariables,
        waterPercentage: 0.5,
        onStatusChange: console.log,
        onComplete: this.setTileMap.bind(this),
        error: console.error,
      } as MapGenerationRequest<AxialCoordinate>;

      generateTileMap(req);

      window.addEventListener('keydown', this.onkeydown.bind(this));
      window.addEventListener('keyup', this.onkeyup.bind(this));
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.onkeydown.bind(this));
    window.removeEventListener('keyup', this.onkeyup.bind(this));
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
    this.sceneBackdrop.scene.camera?.updateZoom((zoom) => zoom - e.deltaY / ZoomScalar);
  }

  setTileMap(res: MapGenerationResponse<AxialCoordinate>) {
    if (this.tileMap) {
      this.tileMapEntity.removeComponent(this.tileMap);
    }
    this.tileMapEntity.addComponent(res.tileMap);
    this.tileMap = res.tileMap as HexTileMap;
  }
}
