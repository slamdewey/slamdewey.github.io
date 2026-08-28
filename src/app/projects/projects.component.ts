import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ReactiveWebGLBackground } from './pages/fragment-writer/ReactiveWebGLBackground';
import { MOUSE_POSITION_EXAMPLE, SHADER_TOY_UV, ShaderProgramData } from './pages/fragment-writer/shader-programs';
import { PerlinNoiseBackdrop } from '../components/backdrop/PerlinNoiseBackdrop';
import { BackdropComponent } from '../components/backdrop/backdrop.component';
import { RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { ProjectTileData } from '../lib/projects';
import { BannerComponent } from '../components/banner/banner.component';
import { Backdrop } from '../components/backdrop';
import { WorldGenPreviewBackdrop } from './pages/world-gen/rendering/world-gen-preview-backdrop';
import { VoronoiBackdrop } from './pages/voronoi-demo/voronoi-backdrop';
import { ScryBackdrop } from './pages/scry/scry-backdrop';
import { env } from 'src/environments/environment';

@Component({
  selector: 'x-projects',
  templateUrl: './projects.component.html',
  styleUrls: ['./projects.component.scss'],
  imports: [BackdropComponent, RouterLink, BannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsComponent implements OnInit {
  private readonly titleService = inject(Title);

  public bgAnimation = signal<Backdrop>(new PerlinNoiseBackdrop());
  public fragmentWriterTileBackdrop: ReactiveWebGLBackground;
  public projects: ProjectTileData[];

  private updateShaderCode(backdrop: ReactiveWebGLBackground, shaderProgram: ShaderProgramData) {
    backdrop.shaderProgramData = shaderProgram;
  }

  constructor() {
    this.fragmentWriterTileBackdrop = new ReactiveWebGLBackground();
    this.fragmentWriterTileBackdrop.shaderProgramData = SHADER_TOY_UV;

    this.projects = [
      {
        routerLink: 'fragment-writer',
        labelText: 'GLSL Editor',
        backdrop: this.fragmentWriterTileBackdrop,
        hovered: signal(false),
        focused: signal(false),
        onMouseEnter: () => {
          this.updateShaderCode(this.fragmentWriterTileBackdrop, MOUSE_POSITION_EXAMPLE);
        },
        onMouseExit: () => {
          this.updateShaderCode(this.fragmentWriterTileBackdrop, SHADER_TOY_UV);
        },
      },
      {
        routerLink: 'voronoi',
        labelText: 'Voronoi',
        backdrop: new VoronoiBackdrop(),
        hovered: signal(false),
        focused: signal(false),
      },
      {
        routerLink: 'scry',
        labelText: 'Scry',
        backdrop: new ScryBackdrop(),
        hovered: signal(false),
        focused: signal(false),
      },
    ];

    // World-gen is still under active development — hide its tile in
    // production builds until the underlying systems are ready to ship.
    // The route itself remains registered so direct URL access still works
    // for testing.
    if (env.enviornment !== 'prod') {
      this.projects.push({
        routerLink: 'world-gen',
        labelText: 'World Generation',
        backdrop: new WorldGenPreviewBackdrop(),
        hovered: signal(false),
        focused: signal(false),
      });
    }
  }

  ngOnInit(): void {
    this.titleService.setTitle('Projects');
  }
}
