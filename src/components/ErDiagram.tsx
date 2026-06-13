import { useMemo } from 'react'
import type { Schema } from '../types'
import { snake } from '../lib/naming'

interface Props {
  schema: Schema
}

const BW = 230 // box width
const HH = 32 // header height
const RH = 24 // row height
const GAP_X = 80
const GAP_Y = 44
const PAD = 24

interface Box {
  name: string
  x: number
  y: number
  w: number
  h: number
  rows: { name: string; type: string; pk: boolean; fk: boolean }[]
  rowIndex: Map<string, number>
}

export function ErDiagram({ schema }: Props) {
  const { boxes, edges, width, height } = useMemo(() => {
    const n = schema.tables.length
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
    const colY = new Array(cols).fill(PAD)
    const boxes: Box[] = []
    const byName = new Map<string, Box>()

    schema.tables.forEach((t, i) => {
      const col = i % cols
      const x = PAD + col * (BW + GAP_X)
      const y = colY[col]
      const rows = t.columns.map((c) => ({
        name: c.name,
        type: c.sqlType,
        pk: c.primaryKey,
        fk: !!c.foreignKey,
      }))
      const rowIndex = new Map(t.columns.map((c, idx) => [c.name, idx]))
      const h = HH + rows.length * RH
      const box: Box = { name: t.name, x, y, w: BW, h, rows, rowIndex }
      boxes.push(box)
      byName.set(snake(t.name), box)
      colY[col] = y + h + GAP_Y
    })

    const edges: { d: string; key: string }[] = []
    schema.tables.forEach((t) => {
      const child = byName.get(snake(t.name))!
      t.columns.forEach((c) => {
        if (!c.foreignKey) return
        const parent = byName.get(snake(c.foreignKey.table))
        if (!parent) return
        const childRow = child.rowIndex.get(c.name) ?? 0
        const parentRow = parent.rowIndex.get(c.foreignKey.column) ?? 0
        const cy = child.y + HH + childRow * RH + RH / 2
        const py = parent.y + HH + parentRow * RH + RH / 2

        const sameCol = Math.abs(child.x - parent.x) < 1
        let cx: number
        let px: number
        let cDir: number
        let pDir: number
        if (sameCol) {
          cx = child.x + BW
          px = parent.x + BW
          cDir = 1
          pDir = 1
        } else if (child.x < parent.x) {
          cx = child.x + BW
          px = parent.x
          cDir = 1
          pDir = -1
        } else {
          cx = child.x
          px = parent.x + BW
          cDir = -1
          pDir = 1
        }
        const off = sameCol ? 60 : Math.max(40, Math.abs(px - cx) * 0.4)
        const d = `M ${cx} ${cy} C ${cx + cDir * off} ${cy}, ${px + pDir * off} ${py}, ${px} ${py}`
        edges.push({ d, key: `${t.name}.${c.name}` })
      })
    })

    const width = PAD + cols * BW + (cols - 1) * GAP_X + PAD
    const height = Math.max(...colY, PAD * 2)
    return { boxes, edges, width, height }
  }, [schema])

  if (!schema.tables.length) return null

  return (
    <div className="er-diagram">
      <svg width={width} height={height} role="img" aria-label="Entity relationship diagram">
        <defs>
          <marker
            id="er-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
          </marker>
        </defs>

        {edges.map((e) => (
          <path
            key={e.key}
            d={e.d}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            markerEnd="url(#er-arrow)"
            opacity={0.8}
          />
        ))}

        {boxes.map((b) => (
          <g key={b.name} transform={`translate(${b.x}, ${b.y})`}>
            <rect
              width={b.w}
              height={b.h}
              rx={8}
              fill="var(--panel)"
              stroke="var(--border)"
              strokeWidth={1}
            />
            <rect width={b.w} height={HH} rx={8} fill="var(--panel-2)" />
            <rect width={b.w} height={HH / 2} y={HH / 2} fill="var(--panel-2)" />
            <text x={12} y={HH / 2 + 5} className="er-title">
              {b.name}
            </text>
            <line x1={0} y1={HH} x2={b.w} y2={HH} stroke="var(--border)" />
            {b.rows.map((r, i) => {
              const ry = HH + i * RH
              return (
                <g key={r.name} transform={`translate(0, ${ry})`}>
                  <text x={12} y={RH / 2 + 4} className={`er-col${r.pk ? ' pk' : ''}`}>
                    {r.pk ? '🔑 ' : r.fk ? '↗ ' : ''}
                    {r.name}
                  </text>
                  <text x={b.w - 12} y={RH / 2 + 4} className="er-type" textAnchor="end">
                    {r.type}
                  </text>
                </g>
              )
            })}
          </g>
        ))}
      </svg>
    </div>
  )
}
