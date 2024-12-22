import { NgxMonacoEditorConfig } from 'ngx-monaco-editor-v2';
import { UNIFORM_NAMES } from '../projects/pages/fragment-writer/shader-programs';
import parsedOpenGlDocs from './parsedOpenGlDocs';

export const monacoConfig: NgxMonacoEditorConfig = {
  baseUrl: 'assets',
  onMonacoLoad: configureMonaco,
  defaultOptions: { scrollBeyondLastLine: false },
  requireConfig: { preferScriptTags: true },
};

export function configureMonaco() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monaco = (<any>window).monaco;
  if (!monaco) {
    return;
  }
  monaco.languages.register({ id: 'glsl' });
  monaco.languages.setLanguageConfiguration('glsl', {
    wordPattern:
      /(-?(?:(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)[fF]?)|([^`~!@%^&*()\-=+[{]\}\\\|;:'",\.<>\/\?\s]+)/g,
    comments: {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    folding: {
      markers: {
        start: /^ *# *pragma +region\b/,
        end: /^ *# *pragma +endregion\b/,
      },
    },
  });
  monaco.languages.setMonarchTokensProvider('glsl', {
    keywords: [
      'uniform',
      'const',
      'break',
      'continue',
      'do',
      'for',
      'while',
      'if',
      'else',
      'switch',
      'case',
      'default',
      'in',
      'out',
      'inout',
      'true',
      'false',
      'invariant',
      'discard',
      'return',
      'struct',
      'precision',
      'highp',
      'mediump',
      'lowp',
      'layout',
      'centroid',
      'flat',
      'smooth',
    ],
    builtinFunctions: Object.keys(parsedOpenGlDocs).filter((k) => !k.startsWith('gl_')),
    builtinVars: Object.keys(parsedOpenGlDocs).filter((k) => k.startsWith('gl_')),
    pseudoTypeKeywords: [
      'genType',
      'genIType',
      'genUType',
      'genBType',
      'vec',
      'ivec',
      'uvec',
      'bvec',
      'mat',
      'gvec',
      'gvec4',
      'gSampler2D',
      'gsampler2D',
      'gSampler3D',
      'gsampler3D',
      'sampler2DShadow',
      'gsampler2DArray',
      'sampler2DArrayShadow',
      'gsamplerCube',
      'samplerCubeShadow',
    ],
    typeKeywords: [
      'bool',
      'bvec2',
      'bvec3',
      'bvec4',

      'int',
      'ivec2',
      'ivec3',
      'ivec4',

      'mat2',
      'mat2x2',
      'mat2x3',
      'mat2x4',
      'mat3',
      'mat3x2',
      'mat3x3',
      'mat3x4',
      'mat4',
      'mat4x2',
      'mat4x3',
      'mat4x4',

      'sampler2D',
      'sampler3D',
      'samplerCube',
      'sampler2DShadow',
      'samplerCubeShadow',
      'sampler2DArray',
      'sampler2DArrayShadow',
      'isampler2D',
      'isampler3D',
      'isamplerCube',
      'isampler2DArray',
      'usampler2D',
      'usampler3D',
      'usamplerCube',
      'usampler2DArray',

      'uint',
      'uvec2',
      'uvec3',
      'uvec4',

      'float',
      'vec2',
      'vec3',
      'vec4',
      'void',
    ],
    uniforms: UNIFORM_NAMES,
    operators: [
      '=',
      '>',
      '<',
      '!',
      '~',
      '?',
      ':',
      '==',
      '<=',
      '>=',
      '!=',
      '&&',
      '||',
      '++',
      '--',
      '+',
      '-',
      '*',
      '/',
      '&',
      '|',
      '^',
      '%',
      '<<',
      '>>',
      '>>>',
      '+=',
      '-=',
      '*=',
      '/=',
      '&=',
      '|=',
      '^=',
      '%=',
      '<<=',
      '>>=',
      '>>>=',
    ],
    tokenizer: {
      root: [
        [/\bmain\b/, 'meta.scss'],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@typeKeywords': 'type',
              '@builtinFunctions': 'predefined.sql',
              '@builtinVars': 'string.sql',
              '@uniforms': 'keyword.json',
              '@default': 'identifier',
            },
          },
        ],
        [/^ *# */, 'directive', '@directive'],
        { include: '@whitespace' },
        { include: '@numbers' },
        [/(\.)([a-zA-Z_]\w*)/, ['operator', 'attribute.value']],
        [/[{}()[\]]/, '@brackets'],
        { include: '@symbols' },
        [/[;,.]/, 'delimiter'],
      ],

      numbers: [
        [/(?:(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)[fF]?/, 'number.float'],
        [/0[xX][0-9a-fA-F]+[uU]?/, 'number.hex'],
        [/0[0-7]+[uU]?/, 'number.octal'],
        [/\d+[uU]?/, 'number'],
      ],

      symbols: [
        [
          /[=><!~?:&|+\-*/^%]+/,
          {
            cases: {
              '@operators': 'operator',
              '@default': '',
            },
          },
        ],
      ],

      commentDecorators: [
        [/ *\u0040todo/i, 'comment.todo'],
        [/ *\u0040note/i, 'comment.note'],
      ],

      blockComment: [
        { include: '@commentDecorators' },

        [/[^/*]+/, 'comment'],
        [/\/\*/, 'comment', '@push'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],

      lineComment: [
        [/^/, '@rematch', '@pop'],
        { include: '@commentDecorators' },
        [/.*/, 'comment'],
      ],

      whitespace: [
        [/\s+/, 'white'],
        [/\/\*/, 'comment', '@blockComment'],
        [/\/\//, 'comment', '@lineComment'],
      ],

      defineDirective: [
        [/^/, '@rematch', '@popall'],
        ['defined', 'directive.defined'],
        { include: '@whitespace' },
        { include: '@symbols' },
        { include: '@numbers' },
        [/\w+/, 'directive.macro'],
      ],

      directive: [
        [/^/, '@rematch', '@pop'],
        [/define|undef|if(?:n?def)?|elif/, 'directive', '@defineDirective'],
        [/\b((?:end)?region)( +)(.+)/, ['directive', 'whitespace', 'string']],
        [/\b(?:es)\b/, 'string'],
        { include: '@numbers' },
        { include: '@whitespace' },
        [/\w+/, 'directive'],
        [/"|</, { token: 'string.quote', bracket: '@open', next: '@string' }],
      ],

      string: [
        [/[^">]+/, 'string'],
        [/"|>/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
      ],
    },
  });
}
