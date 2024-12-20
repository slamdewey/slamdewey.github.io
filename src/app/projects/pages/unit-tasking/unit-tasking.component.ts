import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  OnDestroy,
} from '@angular/core';
import { BackdropComponent, EcsSceneBackdrop } from 'src/app/components/backdrop';
import { MapGeneratorService } from 'src/app/services/map-generator.service';
import { AxialCoordinate, Vector2 } from 'src/app/shapes/coordinate';
import { EcsEntity } from 'src/app/shapes/ecs';
import {
  MapGenerationRequest,
  MapGenerationResponse,
  NoiseVariables,
} from 'src/app/shapes/map-generation';
import { HexTileMap } from 'src/app/shapes/tilemap';
import { Unit } from 'src/app/shapes/unit-tasking';
import { SpecularHexMapGenerator } from 'src/app/util/map-generation';

/**
 * Scroll events are for some reason in delta intervals of 100
 */
export const ZoomScalar = 100;

@Component({
  selector: 'x-unit-tasking',
  templateUrl: './unit-tasking.component.html',
  styleUrls: ['./unit-tasking.component.scss'],
  standalone: true,
  imports: [BackdropComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnitTaskingComponent implements AfterViewInit, OnDestroy {
  private readonly mapService = inject(MapGeneratorService);

  public units: Unit[];
  public sceneBackdrop = new EcsSceneBackdrop();
  public tileMapEntity = new EcsEntity('HexMap');
  public tileMap: HexTileMap | undefined;

  constructor() {
    this.sceneBackdrop.scene.add(this.tileMapEntity);
  }

  ngAfterViewInit() {
    const req = {
      columns: 50,
      columnHeight: 50,
      algorithm: SpecularHexMapGenerator,
      noiseVariables: {} as NoiseVariables,
      waterPercentage: 0.5,
      onStatusChange: console.log,
      callback: this.setTileMap.bind(this),
      error: console.error,
    } as MapGenerationRequest<AxialCoordinate>;

    this.mapService.generateTileMap(req);

    window.onkeydown = this.onkeydown.bind(this);
    window.onkeyup = this.onkeyup.bind(this);
  }

  ngOnDestroy(): void {
    window.onkeydown = window.onkeyup = null;
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
