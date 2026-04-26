import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import Editor from '@monaco-editor/react'

// Runs once when this lazy chunk is first loaded
;(() => {
  self.MonacoEnvironment = {
    getWorker(_: string, label: string) {
      if (label === 'json') return new jsonWorker()
      return new editorWorker()
    }
  }

  monaco.languages.register({ id: 'toml' })
  monaco.languages.setMonarchTokensProvider('toml', {
    defaultToken: '',
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/\[\[?[^\]]*\]\]?/, 'keyword'],
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
      { open: '{', close: '}' }, { open: '[', close: ']' },
      { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
  })

  loader.config({ monaco })
})()

interface Props {
  language: string
  value: string
  onChange: (value: string) => void
  onMount: (editor: any, monacoInstance: any) => void
  loadingNode: React.ReactNode
}

const EDITOR_OPTIONS = {
  fontSize: 13,
  fontFamily: "'Cascadia Code','JetBrains Mono','Consolas','Courier New',monospace",
  fontLigatures: true,
  lineNumbers: 'on' as const,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'on' as const,
  formatOnType: true,
  formatOnPaste: true,
  autoIndent: 'full' as const,
  tabSize: 2,
  insertSpaces: true,
  renderWhitespace: 'selection' as const,
  bracketPairColorization: { enabled: true },
  quickSuggestions: { strings: true, comments: false, other: true },
  padding: { top: 10, bottom: 10 },
  scrollbar: { useShadows: false, verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  cursorBlinking: 'smooth' as const,
  cursorSmoothCaretAnimation: 'on' as const,
  smoothScrolling: true,
  renderLineHighlight: 'gutter' as const,
  selectionHighlight: true,
  suggest: { showWords: true, showSnippets: true },
}

export default function ConfigFileEditor({ language, value, onChange, onMount, loadingNode }: Props) {
  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      theme="vs-dark"
      onChange={v => onChange(v ?? '')}
      onMount={onMount}
      options={EDITOR_OPTIONS}
      loading={loadingNode}
    />
  )
}
