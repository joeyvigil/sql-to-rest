import type { Schema } from '../types'
import { snake } from './naming'

/** Columns whose value should be hashed (treated as a password). */
export function isPasswordField(name: string): boolean {
  return /(password|passwd|pwd)/i.test(name)
}

/** Columns that must never be returned in a response (Read schema). */
export function isSensitiveField(name: string): boolean {
  return (
    isPasswordField(name) ||
    /(secret|token|api_?key|private_key|salt)/i.test(name)
  )
}

export interface AuthContext {
  /** Table used for login (raw name). */
  table: string
  /** Identity column used as the username (email / username / …). */
  identity: string
  /** Password column whose hash is verified at login. */
  password: string
}

const USERS_TABLE = /^(users|user|accounts|account|auth_users|members|member)$/i

/**
 * Pick the table that can drive JWT auth: it needs a password column and an
 * identity column (email / username / login / name). A users-like table name
 * wins ties.
 */
export function detectAuthTable(schema: Schema): AuthContext | null {
  const candidates = schema.tables
    .map((t) => {
      const pw = t.columns.find((c) => isPasswordField(c.name))
      if (!pw) return null
      const id =
        t.columns.find((c) => /email/i.test(c.name)) ??
        t.columns.find((c) => /(username|login)/i.test(c.name)) ??
        t.columns.find((c) => /name/i.test(c.name))
      if (!id) return null
      return { table: t.name, identity: id.name, password: pw.name }
    })
    .filter((c): c is AuthContext => c !== null)

  if (!candidates.length) return null
  return candidates.find((c) => USERS_TABLE.test(snake(c.table))) ?? candidates[0]
}
