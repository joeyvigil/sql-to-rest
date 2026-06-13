import type { Schema } from '../types'

interface Props {
  schema: Schema
}

export function SchemaSummary({ schema }: Props) {
  if (!schema.tables.length) return null
  return (
    <div className="schema-summary">
      {schema.tables.map((t) => (
        <div className="table-card" key={t.name}>
          <div className="table-name">{t.name}</div>
          <ul className="cols">
            {t.columns.map((c) => (
              <li key={c.name}>
                <span className="col-name">{c.name}</span>
                <span className="col-type">{c.sqlType}</span>
                <span className="badges">
                  {c.primaryKey && <span className="badge pk">PK</span>}
                  {c.foreignKey && (
                    <span className="badge fk">
                      → {c.foreignKey.table}.{c.foreignKey.column}
                    </span>
                  )}
                  {c.unique && !c.primaryKey && (
                    <span className="badge uniq">UNIQUE</span>
                  )}
                  {!c.nullable && !c.primaryKey && (
                    <span className="badge nn">NOT NULL</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
