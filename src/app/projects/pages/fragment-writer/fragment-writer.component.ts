import {
  Component,
  AfterViewInit,
  inject,
  NO_ERRORS_SCHEMA,
  NgZone,
  ChangeDetectionStrategy,
  OnDestroy,
} from '@angular/core';
import { BackdropComponent } from 'src/app/components/backdrop/backdrop.component';
import { ReactiveWebGLBackground } from './ReactiveWebGLBackground';
import { DEFAULT_SHADER_PROGRAMS, SHADER_HEADER, UNIFORM_DEFS } from './shader-programs';
import { ActivatedRoute } from '@angular/router';
import { DropdownLinkSelectorComponent } from 'src/app/components/dropdown-link-selector/dropdown-link-selector.component';
import { MonacoOptions } from 'src/app/shapes/fragment-writer';
import { EditorComponent, NgxEditorModel } from 'ngx-monaco-editor-v2';
import { SkeletonLoaderComponent } from 'src/app/components/skeleton-loader/skeleton-loader.component';
import { DropdownItemData } from 'src/app/shapes/dropdown';

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
        DropdownLinkSelectorComponent,
        EditorComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class FragmentWriterComponent implements AfterViewInit, OnDestroy {
  public bgAnimation = new ReactiveWebGLBackground();
  public isWebGlEnabled: boolean = BackdropComponent.isWebGlEnabled;
  public defaultShaderLinks: DropdownItemData[] = DEFAULT_SHADER_PROGRAMS.map((p) => {
    return {
      text: p.name,
      url: '/projects/fragment-writer',
      queryParams: {
        shader: p.url,
      },
    };
  });
  public compilationErrors: string = '';
  public options: MonacoOptions = { ...defaultMonacoOptions };
  public model = this.options.model;

  private monacoEditorInstance: any;

  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly zone = inject(NgZone);

  public tryShaderUpdate(): void {
    this.bgAnimation.fragmentShaderOverride = this.options.model?.value;
    try {
      this.bgAnimation.attemptRecompileAndReinitialize();
    } catch (e) {
      const err = e as Error;
      console.log(err.message);
      this.compilationErrors = err.message;
      return;
    }
    this.compilationErrors = '';
  }

  onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.key == 's') {
      e.preventDefault();
      this.tryShaderUpdate();
    }
  }

  ngAfterViewInit(): void {
    this.isWebGlEnabled = BackdropComponent.isWebGlEnabled;
    this.activatedRoute.queryParams.subscribe((params) => {
      const shader = params['shader'];
      const shaderProgram = DEFAULT_SHADER_PROGRAMS.find((program) => program.url === shader);
      this.bgAnimation.fragmentShaderOverride = undefined;
      if (shaderProgram) {
        this.bgAnimation.shaderProgramData = shaderProgram;
        this.options.model!.value = this.bgAnimation.getFragmentShader();
        this.monacoEditorInstance?.setValue(this.options.model?.value);
        this.tryShaderUpdate();
      }
    });
    window.onkeydown = this.onkeydown.bind(this);
  }

  ngOnDestroy() {
    window.onkeydown = null;
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
      });
    });
    this.tryShaderUpdate();
  }
}
