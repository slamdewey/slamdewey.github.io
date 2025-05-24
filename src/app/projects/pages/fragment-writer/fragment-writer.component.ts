import {
  Component,
  AfterViewInit,
  inject,
  NgZone,
  ChangeDetectionStrategy,
  OnDestroy,
  DestroyRef,
  signal,
} from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatButtonModule } from '@angular/material/button';
import { BackdropComponent } from 'src/app/components/backdrop/backdrop.component';
import { ReactiveWebGLBackground } from './ReactiveWebGLBackground';
import {
  DEFAULT_SHADER_PROGRAMS,
  SHADER_HEADER,
  ShaderProgramData,
  UNIFORM_DEFS,
} from './shader-programs';
import { ActivatedRoute, Router } from '@angular/router';
import { FragmentWriterQueryParams, MonacoOptions } from 'src/app/lib/fragment-writer';
import { EditorComponent, NgxEditorModel } from 'ngx-monaco-editor-v2';
import { SkeletonLoaderComponent } from 'src/app/components/skeleton-loader/skeleton-loader.component';
import { DropdownItemData } from 'src/app/lib/dropdown';
import { DropdownMenuComponent } from 'src/app/components/dropdown-menu/dropdown-menu.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

const ALL_LOAD_POLICIES = ['This Tab', 'New Tab'] as const;
export type LoadPolicy = (typeof ALL_LOAD_POLICIES)[number];

const initialModel: NgxEditorModel = {
  value: SHADER_HEADER + UNIFORM_DEFS + DEFAULT_SHADER_PROGRAMS[0].fragmentShader,
  language: 'glsl',
  uri: '',
};

export const defaultMonacoOptions: MonacoOptions = {
  theme: 'vs-dark',
  language: 'glsl',
  autoIndent: true,
  formatOnPaste: true,
  formatOnType: true,
  model: { ...initialModel },
};

@Component({
  selector: 'x-fragment-writer',
  templateUrl: './fragment-writer.component.html',
  styleUrls: ['./fragment-writer.component.scss'],
  imports: [
    SkeletonLoaderComponent,
    BackdropComponent,
    DropdownMenuComponent,
    EditorComponent,
    MatButtonToggleModule,
    MatButtonModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FragmentWriterComponent implements AfterViewInit, OnDestroy {
  public reactiveWebGLBackground = new ReactiveWebGLBackground();
  public isWebGlEnabled: boolean = BackdropComponent.isWebGlEnabled;
  public defaultShaderLinks: DropdownItemData[] = DEFAULT_SHADER_PROGRAMS.map((p) => {
    return {
      key: p.key,
      label: p.name,
      url: '/projects/fragment-writer',
      queryParams: {
        shader: p.key,
      },
    };
  });
  public compilationErrors: string = '';
  public options: MonacoOptions = { ...defaultMonacoOptions };
  public model = this.options.model;

  private monacoEditorInstance: any;

  public selectedShaderProgram = signal<ShaderProgramData | undefined>(undefined);
  public ALL_LOAD_POLICIES = ALL_LOAD_POLICIES;
  public loadPolicy = signal<LoadPolicy>('This Tab');

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly zone = inject(NgZone);

  public tryShaderUpdate(): void {
    this.reactiveWebGLBackground.fragmentShaderOverride = this.options.model!.value;
    this.compilationErrors = '';
    try {
      this.reactiveWebGLBackground.attemptRecompileAndReinitialize();
    } catch (e) {
      this.compilationErrors = (e as Error).message ?? e;
    }
  }

  ngAfterViewInit() {
    this.isWebGlEnabled = BackdropComponent.isWebGlEnabled;
    this.activatedRoute.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const { shader } = params as FragmentWriterQueryParams;
        const shaderProgram = DEFAULT_SHADER_PROGRAMS.find((program) => program.key === shader);

        // always nullify the user provided content when navigating
        this.reactiveWebGLBackground.fragmentShaderOverride = undefined;

        if (shaderProgram) {
          this.selectedShaderProgram.set(shaderProgram);
          this.reactiveWebGLBackground.shaderProgramData = shaderProgram;
          const fragmentShaderCode = this.reactiveWebGLBackground.getFragmentShader();

          this.monacoEditorInstance?.setValue(fragmentShaderCode);
          this.options.model!.value = fragmentShaderCode;
          this.tryShaderUpdate();
        } else {
          this.selectedShaderProgram.set(undefined);
        }
      });
    window.addEventListener('keydown', this.onkeydown.bind(this));
  }

  ngOnDestroy() {
    window.removeEventListener('keydown', this.onkeydown.bind(this));
  }

  onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.key == 's') {
      e.preventDefault();
      this.tryShaderUpdate();
    }
  }

  onMonacoInit(editor: {
    _codeEditorService: {
      _onCodeEditorAdd: () => void;
    };
  }) {
    this.monacoEditorInstance = editor;
    this.monacoEditorInstance.setValue(this.options.model!.value);
    this.monacoEditorInstance.onDidChangeModelContent(() => {
      const value = this.monacoEditorInstance.getValue();
      // value is not propagated to parent when executing outside zone.
      this.zone.run(() => {
        this.options.model!.value = value;
        // this.tryShaderUpdate();
      });
    });
  }

  public loadShaderProgram(selectedItem: DropdownItemData | undefined) {
    if (!selectedItem) {
      return;
    }

    switch (this.loadPolicy()) {
      case 'This Tab':
        this.router.navigate([selectedItem.url], { queryParams: selectedItem.queryParams });
        break;
      case 'New Tab':
      default:
        const urlTree = this.router.createUrlTree([selectedItem.url], {
          queryParams: selectedItem.queryParams,
        });
        const url = this.router.serializeUrl(urlTree);
        window.open(url, '_blank');
        break;
    }
  }
}
