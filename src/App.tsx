import { useMemo, useState } from 'react'
import './App.css'
import { parseSql } from './lib/sqlParser'
import { generateProject } from './lib/generator'
import { SAMPLE_SQL } from './lib/sample'
import { copyToClipboard, downloadZip } from './lib/download'
import type { GeneratedFile } from './types'
import { FileTree } from './components/FileTree'
import { CodeView } from './components/CodeView'
import { SchemaSummary } from './components/SchemaSummary'

export default function App() {
  const [sql, setSql] = useState(SAMPLE_SQL)
  const [selected, setSelected] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { schema, warnings, files, error } = useMemo(() => {
    try {
      const { schema, warnings } = parseSql(sql)
      const files = schema.tables.length ? generateProject(schema) : []
      return { schema, warnings, files, error: null as string | null }
    } catch (e) {
      return {
        schema: { tables: [] },
        warnings: [],
        files: [] as GeneratedFile[],
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }, [sql])

  const activePath =
    selected && files.some((f) => f.path === selected)
      ? selected
      : (files[0]?.path ?? null)
  const activeFile = files.find((f) => f.path === activePath) ?? null

  async function handleCopy() {
    if (!activeFile) return
    await copyToClipboard(activeFile.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">⇄</span>
          <div>
            <h1>SQL → FastAPI REST</h1>
            <p>Paste <code>CREATE TABLE</code> statements, get a runnable FastAPI app.</p>
          </div>
        </div>
        <div className="actions">
          <button className="ghost" onClick={() => setSql(SAMPLE_SQL)}>
            Load sample
          </button>
          <button className="ghost" onClick={() => setSql('')}>
            Clear
          </button>
          <button
            className="primary"
            disabled={!files.length}
            onClick={() => downloadZip(files)}
          >
            ⬇ Download .zip
          </button>
        </div>
      </header>

      <div className="columns">
        <section className="pane input-pane">
          <div className="pane-head">
            <h2>SQL schema</h2>
            <span className="count">
              {schema.tables.length} table{schema.tables.length === 1 ? '' : 's'}
            </span>
          </div>
          <textarea
            className="mono sql-input"
            spellCheck={false}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder="CREATE TABLE users (&#10;  id INTEGER PRIMARY KEY,&#10;  email VARCHAR(255) NOT NULL UNIQUE&#10;);"
          />
          {error && <div className="banner error">Parser error: {error}</div>}
          {warnings.map((w, i) => (
            <div className="banner warn" key={i}>
              ⚠ {w}
            </div>
          ))}
          <SchemaSummary schema={schema} />
        </section>

        <section className="pane output-pane">
          <div className="pane-head">
            <h2>Generated FastAPI app</h2>
            {activeFile && (
              <button className="ghost small" onClick={handleCopy}>
                {copied ? '✓ Copied' : 'Copy file'}
              </button>
            )}
          </div>
          {files.length ? (
            <div className="output-body">
              <FileTree
                files={files}
                active={activePath}
                onSelect={setSelected}
              />
              <CodeView file={activeFile} />
            </div>
          ) : (
            <div className="empty">
              {error
                ? 'Fix the SQL above to generate code.'
                : 'Enter a CREATE TABLE statement to see generated code.'}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
