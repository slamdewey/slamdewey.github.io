import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { ReactiveWebGLBackground } from './pages/fragmentwriter/ReactiveWebGLBackground';
import {
  MOUSE_POSITION_EXAMPLE,
  MOUSE_POSITION_NEWTONS_FRACTAL_SHADER,
  SHADER_TOY_UV,
  ShaderProgramData,
} from './pages/fragmentwriter/shader-programs';
import { PerlinNoiseBackdrop } from '../components/backdrop/PerlinNoiseBackdrop';
import { BackdropComponent } from '../components/backdrop/backdrop.component';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { ProjectTileData } from '../shapes/projects';

@Component({
  selector: 'x-projects',
  templateUrl: './projects.component.html',
  styleUrls: ['./projects.component.scss'],
  standalone: true,
  imports: [BackdropComponent, RouterOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsComponent implements OnInit {
  private readonly titleService = inject(Title);

  public bgAnimation = new PerlinNoiseBackdrop();
  public fragmentWriterTileBackdrop: ReactiveWebGLBackground;
  public projects: ProjectTileData[];

  private updateShaderCode(backdrop: ReactiveWebGLBackground, shaderProgram: ShaderProgramData) {
    backdrop.shaderProgramData = shaderProgram;
    backdrop.reInitialize();
  }

  constructor() {
    this.fragmentWriterTileBackdrop = new ReactiveWebGLBackground();
    this.fragmentWriterTileBackdrop.shaderProgramData = SHADER_TOY_UV;

    this.projects = [
      {
        routerLink: 'fragmentwriter',
        labelText: 'GLSL Editor',
        backdrop: this.fragmentWriterTileBackdrop,
        onMouseEnter: () => {
          this.updateShaderCode(this.fragmentWriterTileBackdrop, MOUSE_POSITION_EXAMPLE);
        },
        onMouseExit: () => {
          this.updateShaderCode(this.fragmentWriterTileBackdrop, SHADER_TOY_UV);
        },
      },
    ];
  }

  ngOnInit(): void {
    this.titleService.setTitle('Projects');
  }
}
