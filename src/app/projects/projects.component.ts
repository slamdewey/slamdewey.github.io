import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ReactiveWebGLBackground } from './pages/fragment-writer/ReactiveWebGLBackground';
import {
  MOUSE_POSITION_EXAMPLE,
  SHADER_TOY_UV,
  ShaderProgramData,
} from './pages/fragment-writer/shader-programs';
import { PerlinNoiseBackdrop } from '../components/backdrop/PerlinNoiseBackdrop';
import { BackdropComponent } from '../components/backdrop/backdrop.component';
import { RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { ProjectTileData } from '../shapes/projects';
import { BannerComponent } from '../components/banner/banner.component';
import { Backdrop } from '../components/backdrop';

@Component({
  selector: 'x-projects',
  templateUrl: './projects.component.html',
  styleUrls: ['./projects.component.scss'],
  standalone: true,
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
    backdrop.reInitialize();
  }

  constructor() {
    this.fragmentWriterTileBackdrop = new ReactiveWebGLBackground();
    this.fragmentWriterTileBackdrop.shaderProgramData = SHADER_TOY_UV;

    this.projects = [
      {
        routerLink: 'fragment-writer',
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
