import { useMemo, useState } from 'react'
import './App.css'
import { parseSql } from './lib/sqlParser'
import { generateProject } from './lib/generator'
import { SAMPLE_SQL } from './lib/sample'
import { copyToClipboard, downloadZip } from './lib/download'
import { DEFAULT_OPTIONS, type GenOptions, type GeneratedFile } from './types'
import { FileTree } from './components/FileTree'
import { CodeView } from './components/CodeView'
import { SchemaSummary } from './components/SchemaSummary'
import { ErDiagram } from './components/ErDiagram'
import { OptionsPanel } from './components/OptionsPanel'
import { SqlEditor } from './components/SqlEditor'

type SchemaView = 'tables' | 'diagram'

export default function App() {
  const [sql, setSql] = useState(SAMPLE_SQL)
  const [options, setOptions] = useState<GenOptions>(DEFAULT_OPTIONS)
  const [selected, setSelected] = useState<string | null>(null)
  const [schemaView, setSchemaView] = useState<SchemaView>('tables')
  const [copied, setCopied] = useState(false)

  const { schema, warnings, files, error } = useMemo(() => {
    try {
      const { schema, warnings } = parseSql(sql)
      const files = schema.tables.length ? generateProject(schema, options) : []
      return { schema, warnings, files, error: null as string | null }
    } catch (e) {
      return {
        schema: { tables: [] },
        warnings: [],
        files: [] as GeneratedFile[],
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }, [sql, options])

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
          <SqlEditor value={sql} onChange={setSql} />
          {error && <div className="banner error">Parser error: {error}</div>}
          {warnings.map((w, i) => (
            <div className="banner warn" key={i}>
              ⚠ {w}
            </div>
          ))}
          {schema.tables.length > 0 && (
            <div className="schema-section">
              <div className="schema-toolbar">
                <span className="schema-title">Detected schema</span>
                <div className="segmented">
                  <button
                    className={schemaView === 'tables' ? 'seg active' : 'seg'}
                    onClick={() => setSchemaView('tables')}
                  >
                    Tables
                  </button>
                  <button
                    className={schemaView === 'diagram' ? 'seg active' : 'seg'}
                    onClick={() => setSchemaView('diagram')}
                  >
                    Diagram
                  </button>
                </div>
              </div>
              <div className="schema-content">
                {schemaView === 'tables' ? (
                  <SchemaSummary schema={schema} />
                ) : (
                  <ErDiagram schema={schema} />
                )}
              </div>
            </div>
          )}
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
          <OptionsPanel options={options} onChange={setOptions} />
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
