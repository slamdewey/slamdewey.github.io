import { ChangeDetectionStrategy, Component } from '@angular/core';
import { BannerComponent } from '@components/banner/banner.component';
import { CodeBlockComponent } from '@components/code-block/code-block.component';
import { VoronoiPlaygroundComponent } from '@components/voronoi-playground/voronoi-playground.component';
import { env } from 'src/environments/environment';

@Component({
  selector: 'x-voronoi-demo',
  templateUrl: './voronoi-demo.component.html',
  styleUrls: ['./voronoi-demo.component.scss'],
  imports: [BannerComponent, CodeBlockComponent, VoronoiPlaygroundComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VoronoiDemoComponent {
  readonly voronoiEdgesUrl = `${env.repoUrl}/blob/main/src/app/lib/voronoi-edges.ts`;

  readonly codeAdapterTypes = `// One set of edge types, shared across every surface.
export interface PlanarEdge {
  cellA: number;
  cellB: number;
  a: Vec2;
  b: Vec2;
  midpoint: Vec2;
}

export interface SphereEdge {
  cellA: number;
  cellB: number;
  a: Vec3;
  b: Vec3;
  midpoint: Vec3;
}

export interface PlanarVoronoi { cells: PlanarCell[]; edges: PlanarEdge[]; }
export interface SphereVoronoi { cells: SphereCell[]; edges: SphereEdge[]; }`;
}
