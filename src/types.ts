// Shared schema model produced by the SQL parser and consumed by the generator.

export interface ForeignKey {
  /** Referenced table name (as written in SQL). */
  table: string
  /** Referenced column name. */
  column: string
  onDelete?: string
}

export interface Column {
  name: string
  /** Raw SQL type, e.g. "VARCHAR(255)". */
  sqlType: string
  /** SQLAlchemy column type expression, e.g. "String(255)". */
  saType: string
  /** Python type for Pydantic schemas, e.g. "str". */
  pyType: string
  nullable: boolean
  primaryKey: boolean
  autoIncrement: boolean
  unique: boolean
  /** Raw default expression as written in SQL, if any. */
  default?: string
  foreignKey?: ForeignKey
}

export interface Table {
  /** Original table name as written in SQL. */
  name: string
  columns: Column[]
}

export interface Schema {
  tables: Table[]
}

export interface GeneratedFile {
  path: string
  content: string
  language: 'python' | 'text' | 'markdown'
}

export interface ParseResult {
  schema: Schema
  warnings: string[]
}
