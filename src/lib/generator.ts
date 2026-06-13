import type {
  Column,
  DbTarget,
  GeneratedFile,
  GenOptions,
  Schema,
  Table,
} from '../types'
import { DEFAULT_OPTIONS } from '../types'
import { className, pluralize, singularVar, snake } from './naming'

interface PreparedTable {
  table: Table
  cls: string // model class name
  module: string // snake table name / module name
  varName: string // singular variable name
  routePrefix: string // plural route segment
  pk: Column | null
}

export function generateProject(
  schema: Schema,
  options: GenOptions = DEFAULT_OPTIONS,
): GeneratedFile[] {
  const prepared: PreparedTable[] = schema.tables.map((table) => {
    const module = snake(table.name)
    return {
      table,
      cls: className(table.name),
      module,
      varName: singularVar(table.name),
      // Table names are conventionally already plural, so use as-is for the route.
      routePrefix: module,
      pk: table.columns.find((c) => c.primaryKey) ?? table.columns[0] ?? null,
    }
  })

  const files: GeneratedFile[] = []

  files.push({ path: 'requirements.txt', content: requirements(options), language: 'text' })
  files.push({ path: '.env.example', content: envExample(options), language: 'text' })
  files.push({ path: 'app/__init__.py', content: '', language: 'python' })
  files.push({ path: 'app/database.py', content: databasePy(options), language: 'python' })
  files.push({ path: 'app/models.py', content: modelsPy(prepared), language: 'python' })
  files.push({ path: 'app/schemas.py', content: schemasPy(prepared), language: 'python' })
  files.push({
    path: 'app/routers/__init__.py',
    content: '',
    language: 'python',
  })
  for (const pt of prepared) {
    files.push({
      path: `app/routers/${pt.module}.py`,
      content: routerPy(pt, options),
      language: 'python',
    })
  }
  files.push({ path: 'app/main.py', content: mainPy(prepared, options), language: 'python' })
  files.push({ path: 'README.md', content: readmeMd(prepared), language: 'markdown' })

  return files
}

// ---------------------------------------------------------------------------
// Static-ish files
// ---------------------------------------------------------------------------

/** Per-dialect driver package + default connection URL. */
function dbConfig(opts: GenOptions): { driver: string | null; url: string } {
  const table: Record<
    DbTarget,
    { sync: [string | null, string]; async: [string | null, string] }
  > = {
    sqlite: {
      sync: [null, 'sqlite:///./app.db'],
      async: ['aiosqlite>=0.19', 'sqlite+aiosqlite:///./app.db'],
    },
    postgres: {
      sync: [
        'psycopg[binary]>=3.1',
        'postgresql+psycopg://postgres:postgres@localhost:5432/app',
      ],
      async: [
        'asyncpg>=0.29',
        'postgresql+asyncpg://postgres:postgres@localhost:5432/app',
      ],
    },
    mysql: {
      sync: ['pymysql>=1.1', 'mysql+pymysql://root:root@localhost:3306/app'],
      async: ['aiomysql>=0.2', 'mysql+aiomysql://root:root@localhost:3306/app'],
    },
  }
  const [driver, url] = opts.async ? table[opts.db].async : table[opts.db].sync
  return { driver, url }
}

function requirements(opts: GenOptions): string {
  const lines = [
    'fastapi>=0.110',
    'uvicorn[standard]>=0.29',
    'sqlalchemy>=2.0',
    'pydantic>=2.6',
    'pydantic-settings>=2.2',
    'python-dotenv>=1.0',
  ]
  const { driver } = dbConfig(opts)
  if (driver) lines.push(driver)
  lines.push('')
  return lines.join('\n')
}

function envExample(opts: GenOptions): string {
  const { url } = dbConfig(opts)
  return [`# Override the default ${opts.db} connection here.`, `DATABASE_URL=${url}`, ''].join('\n')
}

function databasePy(opts: GenOptions): string {
  const { url } = dbConfig(opts)
  return opts.async ? databaseAsyncPy(url) : databaseSyncPy(url)
}

function databaseSyncPy(url: string): string {
  return `"""Database engine, session factory and declarative base."""
import os

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "${url}")

# check_same_thread is only needed for SQLite.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


if DATABASE_URL.startswith("sqlite"):
    # SQLite ignores foreign keys (and ON DELETE) unless explicitly enabled.
    @event.listens_for(Engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def get_db():
    """FastAPI dependency that yields a scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
`
}

function databaseAsyncPy(url: string): string {
  return `"""Async database engine, session factory and declarative base."""
import os

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "${url}")

connect_args = {"check_same_thread": False} if "sqlite" in DATABASE_URL else {}

engine = create_async_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


if "sqlite" in DATABASE_URL:
    # SQLite ignores foreign keys (and ON DELETE) unless explicitly enabled.
    @event.listens_for(Engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


async def get_db():
    """FastAPI dependency that yields an async session."""
    async with SessionLocal() as session:
        yield session
`
}

// ---------------------------------------------------------------------------
// models.py
// ---------------------------------------------------------------------------

function modelsPy(prepared: PreparedTable[]): string {
  const usedSa = new Set<string>(['Column'])
  for (const pt of prepared) {
    for (const col of pt.table.columns) {
      usedSa.add(baseSaType(col.saType))
      if (col.foreignKey) usedSa.add('ForeignKey')
    }
  }
  const saImports = Array.from(usedSa).sort().join(', ')

  // Map referenced-table name -> prepared (to wire relationships).
  const byTableName = new Map<string, PreparedTable>()
  for (const pt of prepared) {
    byTableName.set(pt.table.name.toLowerCase(), pt)
    byTableName.set(pt.module, pt)
  }

  // Collect relationships: child.<parent> and parent.<children>.
  const childRels = new Map<string, string[]>() // module -> lines
  const parentRels = new Map<string, string[]>()
  for (const pt of prepared) {
    for (const col of pt.table.columns) {
      if (!col.foreignKey) continue
      const parent = byTableName.get(col.foreignKey.table.toLowerCase())
      if (!parent) continue
      const childAttr = relAttrName(col.name)
      addTo(
        childRels,
        pt.module,
        `    ${childAttr} = relationship("${parent.cls}", back_populates="${pluralize(
          pt.varName,
        )}", foreign_keys=[${col.name}])`,
      )
      // passive_deletes defers parent-delete behavior to the DB's ON DELETE
      // rule instead of SQLAlchemy nulling children (which breaks NOT NULL FKs).
      const cascade = col.foreignKey.onDelete === 'CASCADE' ? ', cascade="all, delete-orphan"' : ''
      addTo(
        parentRels,
        parent.module,
        `    ${pluralize(pt.varName)} = relationship("${pt.cls}", back_populates="${childAttr}", foreign_keys="[${pt.cls}.${col.name}]", passive_deletes=True${cascade})`,
      )
    }
  }

  const blocks = prepared.map((pt) => {
    const lines: string[] = []
    lines.push(`class ${pt.cls}(Base):`)
    lines.push(`    __tablename__ = "${pt.table.name}"`)
    lines.push('')
    for (const col of pt.table.columns) {
      lines.push(`    ${col.name} = Column(${columnArgs(col)})`)
    }
    const rels = [
      ...(childRels.get(pt.module) ?? []),
      ...(parentRels.get(pt.module) ?? []),
    ]
    if (rels.length) {
      lines.push('')
      lines.push(...rels)
    }
    return lines.join('\n')
  })

  const hasRelationship = childRels.size > 0 || parentRels.size > 0
  const ormImport = hasRelationship ? 'from sqlalchemy.orm import relationship\n' : ''

  return `"""SQLAlchemy ORM models generated from the input schema."""
from sqlalchemy import ${saImports}
${ormImport}
from .database import Base


${blocks.join('\n\n\n')}
`
}

function columnArgs(col: Column): string {
  const parts: string[] = [col.saType]
  if (col.foreignKey) {
    const onDelete = col.foreignKey.onDelete
      ? `, ondelete="${col.foreignKey.onDelete}"`
      : ''
    parts.push(
      `ForeignKey("${col.foreignKey.table}.${col.foreignKey.column}"${onDelete})`,
    )
  }
  if (col.primaryKey) parts.push('primary_key=True')
  if (col.autoIncrement && !col.primaryKey) parts.push('autoincrement=True')
  if (col.unique && !col.primaryKey) parts.push('unique=True')
  if (!col.nullable && !col.primaryKey) parts.push('nullable=False')
  if (col.nullable && !col.primaryKey) parts.push('nullable=True')
  if (col.primaryKey) parts.push('index=True')
  const def = pyDefault(col)
  if (def !== null) parts.push(`default=${def}`)
  return parts.join(', ')
}

/** Translate a simple SQL default into a Python literal where it is safe. */
function pyDefault(col: Column): string | null {
  if (!col.default) return null
  const d = col.default.trim()
  const lower = d.toLowerCase()
  if (lower === 'null') return null
  // Function defaults (CURRENT_TIMESTAMP, NOW(), nextval...) are left to the DB.
  if (/[a-z_]+\s*\(/i.test(d) || lower === 'current_timestamp') return null
  if (/^'.*'$/.test(d)) return `"${d.slice(1, -1).replace(/''/g, "'")}"`
  if (/^-?\d+(\.\d+)?$/.test(d)) return d
  if (lower === 'true') return 'True'
  if (lower === 'false') return 'False'
  return null
}

function baseSaType(saType: string): string {
  return saType.replace(/\(.*\)$/, '')
}

// ---------------------------------------------------------------------------
// schemas.py
// ---------------------------------------------------------------------------

function schemasPy(prepared: PreparedTable[]): string {
  const typingImports = new Set<string>(['Optional'])
  const extraImports = new Set<string>()
  for (const pt of prepared) {
    for (const col of pt.table.columns) {
      collectPyTypeImports(col.pyType, extraImports)
      if (col.pyType === 'Any') typingImports.add('Any')
    }
  }

  const blocks = prepared.map((pt) => {
    const cols = pt.table.columns
    const baseFields = cols.filter((c) => !(c.primaryKey && c.autoIncrement))

    const baseLines = baseFields.map((c) => `    ${schemaField(c, c.nullable)}`)
    const createLines = baseLines.length ? baseLines : ['    pass']

    const updateLines = cols
      .filter((c) => !(c.primaryKey && c.autoIncrement))
      .map((c) => `    ${schemaField(c, true)}`)

    const readLines = cols.map((c) => `    ${schemaField(c, c.nullable)}`)

    return `class ${pt.cls}Base(BaseModel):
${createLines.join('\n')}


class ${pt.cls}Create(${pt.cls}Base):
    pass


class ${pt.cls}Update(BaseModel):
${updateLines.length ? updateLines.join('\n') : '    pass'}


class ${pt.cls}Read(BaseModel):
${readLines.join('\n')}

    model_config = ConfigDict(from_attributes=True)`
  })

  const typingLine = `from typing import ${Array.from(typingImports).sort().join(', ')}`
  const extraLines = Array.from(extraImports).sort().join('\n')

  return `"""Pydantic v2 request/response schemas."""
${typingLine}
${extraLines ? extraLines + '\n' : ''}
from pydantic import BaseModel, ConfigDict


${blocks.join('\n\n\n')}
`
}

function schemaField(col: Column, optional: boolean): string {
  const pyType = col.pyType
  if (optional) {
    return `${col.name}: Optional[${pyType}] = None`
  }
  return `${col.name}: ${pyType}`
}

function collectPyTypeImports(pyType: string, into: Set<string>): void {
  if (pyType === 'Decimal') into.add('from decimal import Decimal')
  if (pyType === 'date') into.add('from datetime import date')
  if (pyType === 'time') into.add('from datetime import time')
  if (pyType === 'datetime') into.add('from datetime import datetime')
}

// ---------------------------------------------------------------------------
// routers/<table>.py
// ---------------------------------------------------------------------------

function routerPy(pt: PreparedTable, opts: GenOptions): string {
  const pk = pt.pk
  const pkName = pk ? pk.name : 'id'
  const pkType = pk ? pk.pyType : 'int'
  const cls = pt.cls
  const v = pt.varName

  if (opts.async) {
    return `"""CRUD endpoints for ${pt.table.name}."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import ${cls}
from ..schemas import ${cls}Create, ${cls}Read, ${cls}Update

router = APIRouter(prefix="/${pt.routePrefix}", tags=["${pt.routePrefix}"])


@router.get("", response_model=List[${cls}Read])
async def list_${pt.routePrefix}(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    result = await db.scalars(select(${cls}).offset(skip).limit(limit))
    return result.all()


@router.get("/{${pkName}}", response_model=${cls}Read)
async def get_${v}(${pkName}: ${pkType}, db: AsyncSession = Depends(get_db)):
    obj = await db.get(${cls}, ${pkName})
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="${cls} not found")
    return obj


@router.post("", response_model=${cls}Read, status_code=status.HTTP_201_CREATED)
async def create_${v}(payload: ${cls}Create, db: AsyncSession = Depends(get_db)):
    obj = ${cls}(**payload.model_dump(exclude_unset=True))
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.put("/{${pkName}}", response_model=${cls}Read)
async def update_${v}(${pkName}: ${pkType}, payload: ${cls}Update, db: AsyncSession = Depends(get_db)):
    obj = await db.get(${cls}, ${pkName})
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="${cls} not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/{${pkName}}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_${v}(${pkName}: ${pkType}, db: AsyncSession = Depends(get_db)):
    obj = await db.get(${cls}, ${pkName})
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="${cls} not found")
    await db.delete(obj)
    await db.commit()
    return None
`
  }

  return `"""CRUD endpoints for ${pt.table.name}."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ${cls}
from ..schemas import ${cls}Create, ${cls}Read, ${cls}Update

router = APIRouter(prefix="/${pt.routePrefix}", tags=["${pt.routePrefix}"])


@router.get("", response_model=List[${cls}Read])
def list_${pt.routePrefix}(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.scalars(select(${cls}).offset(skip).limit(limit)).all()


@router.get("/{${pkName}}", response_model=${cls}Read)
def get_${v}(${pkName}: ${pkType}, db: Session = Depends(get_db)):
    obj = db.get(${cls}, ${pkName})
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="${cls} not found")
    return obj


@router.post("", response_model=${cls}Read, status_code=status.HTTP_201_CREATED)
def create_${v}(payload: ${cls}Create, db: Session = Depends(get_db)):
    obj = ${cls}(**payload.model_dump(exclude_unset=True))
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{${pkName}}", response_model=${cls}Read)
def update_${v}(${pkName}: ${pkType}, payload: ${cls}Update, db: Session = Depends(get_db)):
    obj = db.get(${cls}, ${pkName})
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="${cls} not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{${pkName}}", status_code=status.HTTP_204_NO_CONTENT)
def delete_${v}(${pkName}: ${pkType}, db: Session = Depends(get_db)):
    obj = db.get(${cls}, ${pkName})
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="${cls} not found")
    db.delete(obj)
    db.commit()
    return None
`
}

// ---------------------------------------------------------------------------
// main.py
// ---------------------------------------------------------------------------

function mainPy(prepared: PreparedTable[], opts: GenOptions): string {
  const imports = prepared
    .map((pt) => `from .routers import ${pt.module}`)
    .join('\n')
  const includes = prepared
    .map((pt) => `app.include_router(${pt.module}.router)`)
    .join('\n')

  if (opts.async) {
    return `"""FastAPI application entry point."""
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .database import Base, engine
from . import models  # noqa: F401  (ensure models are registered)
${imports}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup. For real projects use Alembic migrations instead.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(title="Generated REST API", version="1.0.0", lifespan=lifespan)

${includes}


@app.get("/")
def root():
    return {"status": "ok", "docs": "/docs"}
`
  }

  return `"""FastAPI application entry point."""
from fastapi import FastAPI

from .database import Base, engine
from . import models  # noqa: F401  (ensure models are registered)
${imports}

# Create tables on startup. For real projects use Alembic migrations instead.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Generated REST API", version="1.0.0")

${includes}


@app.get("/")
def root():
    return {"status": "ok", "docs": "/docs"}
`
}

// ---------------------------------------------------------------------------
// README.md
// ---------------------------------------------------------------------------

function readmeMd(prepared: PreparedTable[]): string {
  const endpoints = prepared
    .map((pt) => {
      const pk = pt.pk ? pt.pk.name : 'id'
      return `### \`${pt.routePrefix}\`

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET    | \`/${pt.routePrefix}\` | List (skip/limit) |
| GET    | \`/${pt.routePrefix}/{${pk}}\` | Retrieve one |
| POST   | \`/${pt.routePrefix}\` | Create |
| PUT    | \`/${pt.routePrefix}/{${pk}}\` | Update |
| DELETE | \`/${pt.routePrefix}/{${pk}}\` | Delete |`
    })
    .join('\n\n')

  return `# Generated FastAPI REST API

This project was generated by **sql-to-rest** from your \`CREATE TABLE\` schema.

## Run it

\`\`\`bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
\`\`\`

Then open the interactive docs at http://127.0.0.1:8000/docs

By default it uses a local SQLite database (\`app.db\`). Set \`DATABASE_URL\`
(see \`.env.example\`) to point at Postgres/MySQL instead.

## Endpoints

${endpoints}

## Layout

\`\`\`
app/
  database.py     # engine, session, Base, get_db dependency
  models.py       # SQLAlchemy ORM models
  schemas.py      # Pydantic request/response models
  routers/        # one CRUD router per table
  main.py         # FastAPI app wiring
requirements.txt
\`\`\`
`
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function addTo(map: Map<string, string[]>, key: string, value: string): void {
  const arr = map.get(key)
  if (arr) arr.push(value)
  else map.set(key, [value])
}

/** "author_id" -> "author"; otherwise append "_ref" to avoid clashing. */
function relAttrName(colName: string): string {
  if (/_id$/i.test(colName)) return colName.replace(/_id$/i, '')
  return colName + '_ref'
}
