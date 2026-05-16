import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input } from '@angular/core';

interface Token {
  type: 'keyword' | 'type' | 'string' | 'comment' | 'number' | 'operator' | 'punctuation' | 'text';
  value: string;
}

const KEYWORDS = new Set([
  'function',
  'const',
  'let',
  'var',
  'for',
  'if',
  'else',
  'return',
  'new',
  'this',
  'typeof',
  'instanceof',
  'import',
  'export',
  'class',
  'extends',
  'implements',
  'interface',
  'type',
  'enum',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'default',
  'throw',
  'try',
  'catch',
  'finally',
  'of',
  'in',
  'as',
]);

const TYPE_KEYWORDS = new Set([
  'number',
  'string',
  'boolean',
  'void',
  'null',
  'undefined',
  'true',
  'false',
  'any',
  'never',
  'unknown',
  'object',
]);

const OPERATORS = new Set([
  '=',
  '===',
  '!==',
  '==',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&&',
  '||',
  '!',
  '??',
  '&',
  '|',
  '^',
  '~',
  '<<',
  '>>',
  '>>>',
  '^=',
  '&=',
  '|=',
  '<<=',
  '>>=',
  '>>>=',
  '=>',
  '...',
  '?',
  ':',
]);

function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    // Line comments
    if (code[i] === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i);
      const slice = end === -1 ? code.slice(i) : code.slice(i, end);
      tokens.push({ type: 'comment', value: slice });
      i += slice.length;
      continue;
    }

    // Block comments
    if (code[i] === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const slice = end === -1 ? code.slice(i) : code.slice(i, end + 2);
      tokens.push({ type: 'comment', value: slice });
      i += slice.length;
      continue;
    }

    // Strings (single, double, backtick)
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const quote = code[i];
      let j = i + 1;
      while (j < code.length && code[j] !== quote) {
        if (code[j] === '\\') j++; // skip escaped char
        j++;
      }
      j++; // include closing quote
      tokens.push({ type: 'string', value: code.slice(i, j) });
      i = j;
      continue;
    }

    // Numbers (decimal, hex, binary)
    if (/\d/.test(code[i]) || (code[i] === '.' && i + 1 < code.length && /\d/.test(code[i + 1]))) {
      let j = i;
      if (code[j] === '0' && (code[j + 1] === 'x' || code[j + 1] === 'X')) {
        j += 2;
        while (j < code.length && /[\da-fA-F]/.test(code[j])) j++;
      } else if (code[j] === '0' && (code[j + 1] === 'b' || code[j + 1] === 'B')) {
        j += 2;
        while (j < code.length && /[01]/.test(code[j])) j++;
      } else {
        while (j < code.length && /[\d.]/.test(code[j])) j++;
        // Handle BigInt suffix
        if (j < code.length && code[j] === 'n') j++;
      }
      tokens.push({ type: 'number', value: code.slice(i, j) });
      i = j;
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_$]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[\w$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (KEYWORDS.has(word)) {
        tokens.push({ type: 'keyword', value: word });
      } else if (TYPE_KEYWORDS.has(word)) {
        tokens.push({ type: 'type', value: word });
      } else {
        tokens.push({ type: 'text', value: word });
      }
      i = j;
      continue;
    }

    // Multi-character operators
    if (/[=!<>+\-*/%&|^~?:.]/.test(code[i])) {
      // Try 3-char, then 2-char, then 1-char
      const three = code.slice(i, i + 3);
      const two = code.slice(i, i + 2);
      if (OPERATORS.has(three)) {
        tokens.push({ type: 'operator', value: three });
        i += 3;
      } else if (OPERATORS.has(two)) {
        tokens.push({ type: 'operator', value: two });
        i += 2;
      } else if (OPERATORS.has(code[i])) {
        tokens.push({ type: 'operator', value: code[i] });
        i++;
      } else {
        tokens.push({ type: 'text', value: code[i] });
        i++;
      }
      continue;
    }

    // Punctuation
    if (/[{}()[\];,]/.test(code[i])) {
      tokens.push({ type: 'punctuation', value: code[i] });
      i++;
      continue;
    }

    // Whitespace and other
    tokens.push({ type: 'text', value: code[i] });
    i++;
  }

  return tokens;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

@Component({
  selector: 'x-code-block',
  template: `<pre class="code-block"><code [innerHTML]="highlighted()"></code></pre>`,
  styleUrls: ['./code-block.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class CodeBlockComponent {
  code = input.required<string>();

  highlighted = computed(() => {
    const tokens = tokenize(this.code());
    return tokens
      .map((t) => {
        const escaped = escapeHtml(t.value);
        if (t.type === 'text') return escaped;
        return `<span class="cb-${t.type}">${escaped}</span>`;
      })
      .join('');
  });
}
