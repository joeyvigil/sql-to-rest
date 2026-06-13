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

      <div className="option-group toggles">
        <Toggle
          label="Pagination"
          checked={options.pagination}
          onChange={(v) => onChange({ ...options, pagination: v })}
        />
        <Toggle
          label="Docker"
          checked={options.docker}
          onChange={(v) => onChange({ ...options, docker: v })}
        />
        <Toggle
          label="Tests"
          checked={options.tests}
          onChange={(v) => onChange({ ...options, tests: v })}
        />
      </div>
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className={checked ? 'toggle on' : 'toggle'}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-dot" />
      {label}
    </label>
  )
}
