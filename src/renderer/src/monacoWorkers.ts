import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

self.MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'json') return new jsonWorker()
    return new editorWorker()
  }
}

// Basic TOML tokenizer (Monaco doesn't have built-in TOML support)
monaco.languages.register({ id: 'toml' })
monaco.languages.setMonarchTokensProvider('toml', {
  defaultToken: '',
  tokenizer: {
    root: [
      [/^\s*#.*$/, 'comment'],
      [/\[\[?[^\]]*\]\]?/, 'keyword.section'],
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/'(?:[^'\\]|\\.)*'/, 'string'],
      [/\b(true|false)\b/, 'keyword'],
      [/[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
      [/[a-zA-Z_][\w.-]*(?=\s*=)/, 'variable'],
      [/=/, 'delimiter'],
      [/[{}\[\],]/, 'delimiter.bracket'],
    ]
  }
})

monaco.languages.setLanguageConfiguration('toml', {
  comments: { lineComment: '#' },
  brackets: [['{', '}'], ['[', ']']],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
})

loader.config({ monaco })
