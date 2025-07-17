import { NgxEditorModel } from 'ngx-monaco-editor-v2';

export interface MonacoOptions {
  theme: 'vs-dark';
  language: 'glsl';
  autoIndent: true;
  formatOnPaste: true;
  formatOnType: true;
  model: NgxEditorModel | undefined;
}

export interface FragmentWriterQueryParams {
  shader: string;
}
