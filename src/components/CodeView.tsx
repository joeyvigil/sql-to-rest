import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import type { Extension } from '@codemirror/state'
import type { GeneratedFile } from '../types'

interface Props {
  file: GeneratedFile | null
}

export function CodeView({ file }: Props) {
  if (!file) return <div className="code-view empty">No file selected.</div>
  const extensions: Extension[] = file.language === 'python' ? [python()] : []
  return (
    <div className="code-view">
      <div className="code-head">{file.path}</div>
      <CodeMirror
        value={file.content}
        extensions={extensions}
        theme={oneDark}
        height="100%"
        editable={false}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
      />
    </div>
  )
}
