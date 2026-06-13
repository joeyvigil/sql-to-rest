import type { GeneratedFile } from '../types'

interface Props {
  file: GeneratedFile | null
}

export function CodeView({ file }: Props) {
  if (!file) return <div className="code-view empty">No file selected.</div>
  const lines = file.content.split('\n')
  return (
    <div className="code-view">
      <div className="code-head">{file.path}</div>
      <pre className="code-pre">
        <code>
          {lines.map((line, i) => (
            <span className="code-line" key={i}>
              <span className="gutter">{i + 1}</span>
              <span className="line-text">{line || ' '}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}
