import type { Column, ForeignKey, ParseResult, Schema, Table } from '../types'

/**
 * A pragmatic CREATE TABLE parser. It is not a full SQL grammar, but handles the
 * common dialects (MySQL / PostgreSQL / SQLite) well enough to drive code gen:
 *   - column definitions with types and inline constraints
 *   - inline + table-level PRIMARY KEY
 *   - table-level FOREIGN KEY ... REFERENCES, and inline REFERENCES
 *   - NOT NULL, UNIQUE, DEFAULT, AUTO_INCREMENT / SERIAL / AUTOINCREMENT
 */
export function parseSql(input: string): ParseResult {
  const warnings: string[] = []
  const cleaned = stripComments(input)
  const statements = splitStatements(cleaned)

  const tables: Table[] = []
  for (const stmt of statements) {
    const match = /create\s+table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)\s*\(/i.exec(
      stmt,
    )
    if (!match) continue

    const rawName = unquoteIdent(match[1])
    const body = extractParenBody(stmt, match.index + match[0].length - 1)
    if (body === null) {
      warnings.push(`Could not find column list for table "${rawName}".`)
      continue
    }

    const defs = splitTopLevel(body)
    const columns: Column[] = []
    const pkColumns = new Set<string>()
    const uniqueColumns = new Set<string>()
    const tableForeignKeys: { columns: string[]; fk: ForeignKey }[] = []

    for (const def of defs) {
      const trimmed = def.trim()
      if (!trimmed) continue
      const kind = constraintKind(trimmed)

      if (kind === 'primary') {
        for (const c of extractParenColumns(trimmed)) pkColumns.add(c)
      } else if (kind === 'unique') {
        for (const c of extractParenColumns(trimmed)) uniqueColumns.add(c)
      } else if (kind === 'foreign') {
        const fk = parseTableForeignKey(trimmed)
        if (fk) tableForeignKeys.push(fk)
      } else if (kind === 'other') {
        // CONSTRAINT name CHECK(...), KEY, INDEX, etc. — ignored for codegen.
        continue
      } else {
        const col = parseColumn(trimmed, warnings)
        if (col) columns.push(col)
      }
    }

    // Apply table-level constraints back onto the columns.
    for (const col of columns) {
      if (pkColumns.has(col.name)) col.primaryKey = true
      if (uniqueColumns.has(col.name)) col.unique = true
      if (col.primaryKey) col.nullable = false
    }
    for (const { columns: fkCols, fk } of tableForeignKeys) {
      for (const cname of fkCols) {
        const col = columns.find((c) => c.name === cname)
        if (col && !col.foreignKey) col.foreignKey = fk
      }
    }

    if (!columns.some((c) => c.primaryKey)) {
      warnings.push(
        `Table "${rawName}" has no PRIMARY KEY; generated CRUD assumes a single-column key.`,
      )
    }

    tables.push({ name: rawName, columns })
  }

  const schema: Schema = { tables }
  return { schema, warnings }
}

// ---------------------------------------------------------------------------
// Tokenizing helpers
// ---------------------------------------------------------------------------

function stripComments(sql: string): string {
  // Remove block comments, then line comments (both -- and #).
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ')
}

/** Split on semicolons that are not inside quotes or parentheses. */
function splitStatements(sql: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let buf = ''
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (quote) {
      if (ch === quote) quote = null
      buf += ch
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      buf += ch
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ';' && depth === 0) {
      out.push(buf)
      buf = ''
    } else {
      buf += ch
    }
  }
  if (buf.trim()) out.push(buf)
  return out
}

/** Given a string and the index of an opening paren, return its inner body. */
function extractParenBody(s: string, openIdx: number): string | null {
  let depth = 0
  let quote: string | null = null
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return s.slice(openIdx + 1, i)
    }
  }
  return null
}

/** Split a definition list on top-level commas. */
function splitTopLevel(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let buf = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      if (ch === quote) quote = null
      buf += ch
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      buf += ch
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(buf)
      buf = ''
    } else {
      buf += ch
    }
  }
  if (buf.trim()) out.push(buf)
  return out
}

function unquoteIdent(ident: string): string {
  return ident.replace(/^["`[]|["`\]]$/g, '').replace(/^"|"$/g, '')
}

// ---------------------------------------------------------------------------
// Definition parsing
// ---------------------------------------------------------------------------

type ConstraintKind = 'primary' | 'unique' | 'foreign' | 'other' | 'column'

function constraintKind(def: string): ConstraintKind {
  const head = def.trim().toUpperCase()
  // A leading CONSTRAINT <name> prefix may precede the real keyword.
  const withoutConstraint = head.replace(/^CONSTRAINT\s+\S+\s+/, '')
  if (/^PRIMARY\s+KEY/.test(withoutConstraint)) return 'primary'
  if (/^FOREIGN\s+KEY/.test(withoutConstraint)) return 'foreign'
  if (/^UNIQUE\b/.test(withoutConstraint)) return 'unique'
  if (/^(KEY|INDEX|CHECK|FULLTEXT|SPATIAL)\b/.test(withoutConstraint))
    return 'other'
  if (/^CONSTRAINT\b/.test(head)) return 'other'
  return 'column'
}

function extractParenColumns(def: string): string[] {
  const open = def.indexOf('(')
  if (open === -1) return []
  const body = extractParenBody(def, open)
  if (body === null) return []
  return body
    .split(',')
    .map((c) => unquoteIdent(c.trim().split(/\s+/)[0]))
    .filter(Boolean)
}

function parseTableForeignKey(
  def: string,
): { columns: string[]; fk: ForeignKey } | null {
  const m =
    /foreign\s+key\s*\(([^)]+)\)\s*references\s+([^\s(]+)\s*\(([^)]+)\)(.*)$/i.exec(
      def,
    )
  if (!m) return null
  const localCols = m[1].split(',').map((c) => unquoteIdent(c.trim()))
  const refTable = unquoteIdent(m[2])
  const refCol = unquoteIdent(m[3].split(',')[0].trim())
  const tail = m[4] || ''
  const onDelete = /on\s+delete\s+(cascade|set\s+null|restrict|no\s+action)/i.exec(
    tail,
  )
  return {
    columns: localCols,
    fk: {
      table: refTable,
      column: refCol,
      onDelete: onDelete ? onDelete[1].toUpperCase().replace(/\s+/g, ' ') : undefined,
    },
  }
}

function parseColumn(def: string, warnings: string[]): Column | null {
  const trimmed = def.trim()
  // name may be quoted; type is everything up to the first constraint keyword.
  const nameMatch = /^("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)\s+(.*)$/s.exec(trimmed)
  if (!nameMatch) {
    warnings.push(`Skipped unrecognized definition: "${trimmed.slice(0, 60)}"`)
    return null
  }
  const name = unquoteIdent(nameMatch[1])
  const rest = nameMatch[2].trim()

  // The SQL type is the leading token, optionally with a (...) size/precision.
  const typeMatch = /^([A-Za-z_][A-Za-z0-9_]*(?:\s+(?:varying|precision))?)\s*(\([^)]*\))?/i.exec(
    rest,
  )
  const baseType = typeMatch ? typeMatch[1].trim() : 'TEXT'
  const typeArgs = typeMatch && typeMatch[2] ? typeMatch[2] : ''
  const sqlType = (baseType + typeArgs).trim()
  const afterType = typeMatch ? rest.slice(typeMatch[0].length) : rest
  const upper = afterType.toUpperCase()

  const { saType, pyType } = mapType(baseType, typeArgs)

  const notNull = /\bNOT\s+NULL\b/.test(upper)
  const explicitNull = /\bNULL\b/.test(upper) && !notNull
  const primaryKey = /\bPRIMARY\s+KEY\b/.test(upper)
  const unique = /\bUNIQUE\b/.test(upper)
  const autoIncrement =
    /\bAUTO_INCREMENT\b/.test(upper) ||
    /\bAUTOINCREMENT\b/.test(upper) ||
    /\bGENERATED\b.*\bIDENTITY\b/.test(upper) ||
    /\bSERIAL\b/i.test(baseType)

  const defaultMatch = /\bDEFAULT\s+('(?:[^']|'')*'|[^\s,]+)/i.exec(afterType)

  // Inline REFERENCES creates a foreign key on this column.
  let foreignKey: ForeignKey | undefined
  const refMatch = /\breferences\s+([^\s(]+)\s*\(([^)]+)\)/i.exec(afterType)
  if (refMatch) {
    foreignKey = {
      table: unquoteIdent(refMatch[1]),
      column: unquoteIdent(refMatch[2].split(',')[0].trim()),
    }
  }

  return {
    name,
    sqlType,
    saType,
    pyType,
    nullable: primaryKey ? false : explicitNull ? true : !notNull,
    primaryKey,
    autoIncrement,
    unique,
    default: defaultMatch ? defaultMatch[1] : undefined,
    foreignKey,
  }
}

// ---------------------------------------------------------------------------
// Type mapping: SQL -> (SQLAlchemy, Python)
// ---------------------------------------------------------------------------

function mapType(
  baseType: string,
  typeArgs: string,
): { saType: string; pyType: string } {
  const t = baseType.toLowerCase().replace(/\s+/g, ' ')
  const args = typeArgs.replace(/[()]/g, '').trim()

  const sized = (sa: string) => (args ? `${sa}(${args})` : sa)

  switch (t) {
    case 'int':
    case 'integer':
    case 'smallint':
    case 'tinyint':
    case 'mediumint':
    case 'serial':
    case 'int4':
    case 'int2':
      return { saType: 'Integer', pyType: 'int' }
    case 'bigint':
    case 'bigserial':
    case 'int8':
      return { saType: 'BigInteger', pyType: 'int' }
    case 'decimal':
    case 'numeric':
      return { saType: sized('Numeric'), pyType: 'Decimal' }
    case 'float':
    case 'real':
    case 'double':
    case 'double precision':
      return { saType: 'Float', pyType: 'float' }
    case 'bool':
    case 'boolean':
      return { saType: 'Boolean', pyType: 'bool' }
    case 'date':
      return { saType: 'Date', pyType: 'date' }
    case 'time':
      return { saType: 'Time', pyType: 'time' }
    case 'datetime':
    case 'timestamp':
    case 'timestamptz':
      return { saType: 'DateTime', pyType: 'datetime' }
    case 'char':
    case 'character':
    case 'varchar':
    case 'character varying':
    case 'nvarchar':
    case 'nchar':
      return { saType: sized('String'), pyType: 'str' }
    case 'text':
    case 'tinytext':
    case 'mediumtext':
    case 'longtext':
    case 'clob':
      return { saType: 'Text', pyType: 'str' }
    case 'uuid':
      return { saType: 'String(36)', pyType: 'str' }
    case 'json':
    case 'jsonb':
      return { saType: 'JSON', pyType: 'Any' }
    case 'blob':
    case 'bytea':
    case 'binary':
    case 'varbinary':
      return { saType: 'LargeBinary', pyType: 'bytes' }
    default:
      return { saType: 'String', pyType: 'str' }
  }
}
