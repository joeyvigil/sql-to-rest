import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'

interface Props {
  value: string
  onChange: (value: string) => void
}

export function SqlEditor({ value, onChange }: Props) {
  return (
    <div className="sql-editor">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={[sql()]}
        theme={oneDark}
        height="100%"
        placeholder="CREATE TABLE users (&#10;  id INTEGER PRIMARY KEY,&#10;  email VARCHAR(255) NOT NULL UNIQUE&#10;);"
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
      />
    </div>
  )
}
