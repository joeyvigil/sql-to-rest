import type { DbTarget, GenOptions } from '../types'

interface Props {
  options: GenOptions
  onChange: (next: GenOptions) => void
}

const DBS: { value: DbTarget; label: string }[] = [
  { value: 'sqlite', label: 'SQLite' },
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
]

export function OptionsPanel({ options, onChange }: Props) {
  return (
    <div className="options-panel">
      <div className="option-group">
        <span className="option-label">Database</span>
        <div className="segmented">
          {DBS.map((d) => (
            <button
              key={d.value}
              className={options.db === d.value ? 'seg active' : 'seg'}
              onClick={() => onChange({ ...options, db: d.value })}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="option-group">
        <span className="option-label">Mode</span>
        <div className="segmented">
          <button
            className={!options.async ? 'seg active' : 'seg'}
            onClick={() => onChange({ ...options, async: false })}
          >
            Sync
          </button>
          <button
            className={options.async ? 'seg active' : 'seg'}
            onClick={() => onChange({ ...options, async: true })}
          >
            Async
          </button>
        </div>
      </div>
    </div>
  )
}
