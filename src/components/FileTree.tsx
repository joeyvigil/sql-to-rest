import type { GeneratedFile } from '../types'

interface Props {
  files: GeneratedFile[]
  active: string | null
  onSelect: (path: string) => void
}

export function FileTree({ files, active, onSelect }: Props) {
  return (
    <nav className="file-tree">
      <ul>
        {files.map((f) => (
          <li key={f.path}>
            <button
              className={f.path === active ? 'file active' : 'file'}
              onClick={() => onSelect(f.path)}
              title={f.path}
            >
              <span className="file-icon">{iconFor(f.path)}</span>
              <span className="file-path">{f.path}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function iconFor(path: string): string {
  if (path.endsWith('.py')) return '🐍'
  if (path.endsWith('.md')) return '📄'
  if (path.endsWith('.txt') || path.startsWith('.env')) return '⚙'
  return '•'
}
