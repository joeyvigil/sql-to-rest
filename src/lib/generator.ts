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
import {
  detectAuthTable,
  isPasswordField,
  isSensitiveField,
  type AuthContext,
} from './sensitive'

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

  // Auth context: only active when requested AND a suitable users table exists.
  const authCtx = options.auth ? detectAuthTable(schema) : null
  // Hashing is on when explicitly requested, or implicitly required by auth.
  const hashing = options.hashPasswords || authCtx !== null
  const authModule = authCtx ? snake(authCtx.table) : null

  const files: GeneratedFile[] = []

  files.push({ path: 'requirements.txt', content: requirements(options, hashing, authCtx), language: 'text' })
  files.push({ path: '.env.example', content: envExample(options, authCtx), language: 'text' })
  files.push({ path: 'app/__init__.py', content: '', language: 'python' })
  files.push({ path: 'app/database.py', content: databasePy(options), language: 'python' })
  files.push({ path: 'app/models.py', content: modelsPy(prepared), language: 'python' })
  files.push({ path: 'app/schemas.py', content: schemasPy(prepared), language: 'python' })
  if (options.pagination) {
    files.push({ path: 'app/pagination.py', content: paginationPy(), language: 'python' })
  }
  if (hashing) {
    files.push({ path: 'app/security.py', content: securityPy(), language: 'python' })
  }
  if (authCtx) {
    files.push({ path: 'app/auth.py', content: authPy(authCtx, options), language: 'python' })
  }
  files.push({
    path: 'app/routers/__init__.py',
    content: '',
    language: 'python',
  })
  for (const pt of prepared) {
    files.push({
      path: `app/routers/${pt.module}.py`,
      content: routerPy(pt, options, hashing, authCtx),
      language: 'python',
    })
  }
  if (authCtx) {
    files.push({
      path: 'app/routers/auth.py',
      content: authRouterPy(authCtx, options),
      language: 'python',
    })
  }
  files.push({ path: 'app/main.py', content: mainPy(prepared, options, authModule), language: 'python' })

  if (options.docker) {
    files.push({ path: 'Dockerfile', content: dockerfile(), language: 'text' })
    files.push({ path: '.dockerignore', content: dockerignore(), language: 'text' })
    files.push({
      path: 'docker-compose.yml',
      content: dockerCompose(options),
      language: 'text',
    })
  }
  if (options.tests) {
    files.push({ path: 'tests/__init__.py', content: '', language: 'python' })
    files.push({ path: 'tests/conftest.py', content: conftestPy(options), language: 'python' })
    files.push({
      path: 'tests/test_api.py',
      content: testApiPy(prepared, options, authCtx !== null),
      language: 'python',
    })
  }

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

function requirements(opts: GenOptions, hashing: boolean, authCtx: AuthContext | null): string {
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
  if (hashing) lines.push('pwdlib[bcrypt]>=0.2')
  if (authCtx) {
    lines.push('pyjwt>=2.8')
    lines.push('python-multipart>=0.0.9') // OAuth2PasswordRequestForm
  }
  if (opts.tests) {
    // The generated tests run against a throwaway SQLite database.
    lines.push('pytest>=8.0')
    lines.push('httpx>=0.27')
    if (opts.async) lines.push('aiosqlite>=0.19')
  }
  lines.push('')
  return lines.join('\n')
}

function envExample(opts: GenOptions, authCtx: AuthContext | null): string {
  const lines = [`# Override the default ${opts.db} connection here.`, `DATABASE_URL=${url(opts)}`]
  if (authCtx) {
    lines.push('')
    lines.push('# Auth — generate a strong key, e.g. `openssl rand -hex 32`.')
    lines.push('# The app refuses to start in production while this is the default.')
    lines.push('SECRET_KEY=change-me-in-production')
    lines.push('ACCESS_TOKEN_EXPIRE_MINUTES=30')
  }
  lines.push('')
  return lines.join('\n')
}

function url(opts: GenOptions): string {
  return dbConfig(opts).url
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

    // Sensitive columns (passwords, tokens, secrets) are never returned.
    const readCols = cols.filter((c) => !isSensitiveField(c.name))
    const readLines = readCols.length
      ? readCols.map((c) => `    ${schemaField(c, c.nullable)}`)
      : ['    pass']

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

function routerPy(
  pt: PreparedTable,
  opts: GenOptions,
  hashing: boolean,
  authCtx: AuthContext | null,
): string {
  const pk = pt.pk
  const pkName = pk ? pk.name : 'id'
  const pkType = pk ? pk.pyType : 'int'
  const cls = pt.cls
  const v = pt.varName

  const sess = opts.async ? 'AsyncSession' : 'Session'
  const aw = opts.async ? 'await ' : ''
  const adef = opts.async ? 'async def' : 'def'

  const pwCols = hashing
    ? pt.table.columns.filter((c) => isPasswordField(c.name)).map((c) => c.name)
    : []

  // Protect every endpoint when auth is on, except the users-table create,
  // which stays open so the first account can be registered.
  const protect = authCtx !== null
  const isAuthTable = authCtx !== null && snake(authCtx.table) === pt.module
  const dep = ', _user=Depends(get_current_user)'
  const protAll = protect ? dep : ''
  const protCreate = protect && !isAuthTable ? dep : ''

  const sessionImport = opts.async
    ? 'from sqlalchemy.ext.asyncio import AsyncSession'
    : 'from sqlalchemy.orm import Session'
  const selectImport = opts.pagination
    ? 'from sqlalchemy import func, select'
    : 'from sqlalchemy import select'
  const pageImport = opts.pagination ? `\nfrom ..pagination import Page` : ''
  const securityImport = pwCols.length ? '\nfrom ..security import hash_password' : ''
  const authImport = protect ? '\nfrom ..auth import get_current_user' : ''
  const listModel = opts.pagination ? `Page[${cls}Read]` : `List[${cls}Read]`
  const typingBlock = opts.pagination ? '' : 'from typing import List\n\n'

  const listBody = opts.pagination
    ? `    total = ${aw}db.scalar(select(func.count()).select_from(${cls}))
    result = ${aw}db.scalars(select(${cls}).offset(skip).limit(limit))
    return Page(items=list(result.all()), total=total or 0, skip=skip, limit=limit)`
    : `    result = ${aw}db.scalars(select(${cls}).offset(skip).limit(limit))
    return result.all()`

  const hashSnippet = pwCols
    .map((c) => `    if "${c}" in data:\n        data["${c}"] = hash_password(data["${c}"])`)
    .join('\n')

  const createBody = pwCols.length
    ? `    data = payload.model_dump(exclude_unset=True)
${hashSnippet}
    obj = ${cls}(**data)
    db.add(obj)
    ${aw}db.commit()
    ${aw}db.refresh(obj)
    return obj`
    : `    obj = ${cls}(**payload.model_dump(exclude_unset=True))
    db.add(obj)
    ${aw}db.commit()
    ${aw}db.refresh(obj)
    return obj`

  const updateAssign = pwCols.length
    ? `    data = payload.model_dump(exclude_unset=True)
${hashSnippet}
    for field, value in data.items():
        setattr(obj, field, value)`
    : `    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)`

  return `"""CRUD endpoints for ${pt.table.name}."""
${typingBlock}from fastapi import APIRouter, Depends, HTTPException, status
${selectImport}
${sessionImport}

from ..database import get_db
from ..models import ${cls}
from ..schemas import ${cls}Create, ${cls}Read, ${cls}Update${pageImport}${securityImport}${authImport}

router = APIRouter(prefix="/${pt.routePrefix}", tags=["${pt.routePrefix}"])


@router.get("", response_model=${listModel})
${adef} list_${pt.routePrefix}(skip: int = 0, limit: int = 100, db: ${sess} = Depends(get_db)${protAll}):
${listBody}


@router.get("/{${pkName}}", response_model=${cls}Read)
${adef} get_${v}(${pkName}: ${pkType}, db: ${sess} = Depends(get_db)${protAll}):
    obj = ${aw}db.get(${cls}, ${pkName})
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="${cls} not found")
    return obj


@router.post("", response_model=${cls}Read, status_code=status.HTTP_201_CREATED)
${adef} create_${v}(payload: ${cls}Create, db: ${sess} = Depends(get_db)${protCreate}):
${createBody}


@router.put("/{${pkName}}", response_model=${cls}Read)
${adef} update_${v}(${pkName}: ${pkType}, payload: ${cls}Update, db: ${sess} = Depends(get_db)${protAll}):
    obj = ${aw}db.get(${cls}, ${pkName})
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="${cls} not found")
${updateAssign}
    ${aw}db.commit()
    ${aw}db.refresh(obj)
    return obj


@router.delete("/{${pkName}}", status_code=status.HTTP_204_NO_CONTENT)
${adef} delete_${v}(${pkName}: ${pkType}, db: ${sess} = Depends(get_db)${protAll}):
    obj = ${aw}db.get(${cls}, ${pkName})
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="${cls} not found")
    ${aw}db.delete(obj)
    ${aw}db.commit()
    return None
`
}

// ---------------------------------------------------------------------------
// main.py
// ---------------------------------------------------------------------------

function mainPy(
  prepared: PreparedTable[],
  opts: GenOptions,
  authModule: string | null,
): string {
  const routerModules = prepared.map((pt) => pt.module)
  // The auth (login) router is imported under an alias to avoid clashing with a
  // table whose own module is named "auth".
  const authImport = authModule ? 'from .routers import auth as auth_router\n' : ''
  const authInclude = authModule ? 'app.include_router(auth_router.router)\n' : ''
  const imports = routerModules.map((m) => `from .routers import ${m}`).join('\n')
  const includes =
    authInclude + routerModules.map((m) => `app.include_router(${m}.router)`).join('\n')

  if (opts.async) {
    return `"""FastAPI application entry point."""
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .database import Base, engine
from . import models  # noqa: F401  (ensure models are registered)
${authImport}${imports}


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
${authImport}${imports}

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
// pagination.py
// ---------------------------------------------------------------------------

function paginationPy(): string {
  return `"""Generic pagination envelope for list endpoints."""
from typing import Generic, List, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: List[T]
    total: int
    skip: int
    limit: int
`
}

// ---------------------------------------------------------------------------
// security.py  (Tier 1: password hashing)
// ---------------------------------------------------------------------------

function securityPy(): string {
  return `"""Password hashing helpers (bcrypt via pwdlib)."""
from pwdlib import PasswordHash
from pwdlib.hashers.bcrypt import BcryptHasher

_hasher = PasswordHash((BcryptHasher(),))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return _hasher.verify(password, hashed)
`
}

// ---------------------------------------------------------------------------
// auth.py + routers/auth.py  (Tier 2: JWT auth)
// ---------------------------------------------------------------------------

function authPy(authCtx: AuthContext, opts: GenOptions): string {
  const userCls = className(authCtx.table)
  const sess = opts.async ? 'AsyncSession' : 'Session'
  const sessionImport = opts.async
    ? 'from sqlalchemy.ext.asyncio import AsyncSession'
    : 'from sqlalchemy.orm import Session'
  const adef = opts.async ? 'async def' : 'def'
  const aw = opts.async ? 'await ' : ''

  return `"""JWT authentication: token creation and the get_current_user dependency."""
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
${sessionImport}

from .database import get_db
from .models import ${userCls}

SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
if SECRET_KEY == "change-me-in-production" and os.getenv("ENVIRONMENT", "").lower() in {
    "prod",
    "production",
}:
    raise RuntimeError("SECRET_KEY must be set when ENVIRONMENT is production")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": subject, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


${adef} get_current_user(token: str = Depends(oauth2_scheme), db: ${sess} = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        subject = payload.get("sub")
        if subject is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
    user = ${aw}db.scalar(select(${userCls}).where(${userCls}.${authCtx.identity} == subject))
    if user is None:
        raise credentials_exception
    return user
`
}

function authRouterPy(authCtx: AuthContext, opts: GenOptions): string {
  const userCls = className(authCtx.table)
  const sess = opts.async ? 'AsyncSession' : 'Session'
  const sessionImport = opts.async
    ? 'from sqlalchemy.ext.asyncio import AsyncSession'
    : 'from sqlalchemy.orm import Session'
  const adef = opts.async ? 'async def' : 'def'
  const aw = opts.async ? 'await ' : ''

  return `"""Authentication routes: obtain a token and read the current user."""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
${sessionImport}

from ..auth import create_access_token, get_current_user
from ..database import get_db
from ..models import ${userCls}
from ..schemas import ${userCls}Read
from ..security import verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/token")
${adef} login(form_data: OAuth2PasswordRequestForm = Depends(), db: ${sess} = Depends(get_db)):
    user = ${aw}db.scalar(
        select(${userCls}).where(${userCls}.${authCtx.identity} == form_data.username)
    )
    if user is None or not verify_password(form_data.password, user.${authCtx.password}):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(form_data.username)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=${userCls}Read)
${adef} read_me(current_user=Depends(get_current_user)):
    return current_user
`
}

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

function dockerfile(): string {
  return `FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
`
}

function dockerignore(): string {
  return ['__pycache__/', '*.pyc', '.venv/', 'venv/', '*.db', '.env', '.git/', ''].join('\n')
}

function dockerCompose(opts: GenOptions): string {
  const composeUrl = dbConfig(opts).url.replace('@localhost', '@db')
  const api = `  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: ${composeUrl}`

  if (opts.db === 'postgres') {
    return `services:
${api}
    depends_on:
      - db
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
`
  }
  if (opts.db === 'mysql') {
    return `services:
${api}
    depends_on:
      - db
  db:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: app
    ports:
      - "3306:3306"
    volumes:
      - mysqldata:/var/lib/mysql

volumes:
  mysqldata:
`
  }
  // SQLite: single service, no database container needed.
  return `services:
  api:
    build: .
    ports:
      - "8000:8000"
`
}

// ---------------------------------------------------------------------------
// tests/
// ---------------------------------------------------------------------------

function conftestPy(opts: GenOptions): string {
  const url = opts.async ? 'sqlite+aiosqlite:///./test_app.db' : 'sqlite:///./test_app.db'
  return `"""Pytest fixtures. Tests run against a throwaway SQLite database."""
import os

# Point the app at a disposable SQLite DB before it is imported.
os.environ["DATABASE_URL"] = "${url}"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    # The context manager runs startup/shutdown (creates tables).
    with TestClient(app) as c:
        yield c
`
}

function testApiPy(
  prepared: PreparedTable[],
  opts: GenOptions,
  authActive: boolean,
): string {
  const lines: string[] = ['"""Smoke tests for the generated API."""', '', '']
  lines.push('def test_root(client):')
  lines.push('    resp = client.get("/")')
  lines.push('    assert resp.status_code == 200')
  lines.push('')
  for (const pt of prepared) {
    lines.push('')
    lines.push(`def test_list_${pt.routePrefix}(client):`)
    lines.push(`    resp = client.get("/${pt.routePrefix}")`)
    if (authActive) {
      // Every list endpoint requires a bearer token when auth is enabled.
      lines.push('    assert resp.status_code == 401')
    } else if (opts.pagination) {
      lines.push('    assert resp.status_code == 200')
      lines.push('    body = resp.json()')
      lines.push('    assert "items" in body and "total" in body')
    } else {
      lines.push('    assert resp.status_code == 200')
      lines.push('    assert isinstance(resp.json(), list)')
    }
    lines.push('')
    lines.push('')
    lines.push(`def test_get_missing_${pt.varName}(client):`)
    lines.push(`    resp = client.get("/${pt.routePrefix}/999999")`)
    if (authActive) {
      lines.push('    assert resp.status_code == 401')
    } else {
      // String PKs would 422 rather than 404 for a numeric-looking id.
      lines.push('    assert resp.status_code in (404, 422)')
    }
    lines.push('')
  }
  if (authActive) {
    lines.push('')
    lines.push('def test_login_requires_credentials(client):')
    lines.push('    resp = client.post("/auth/token", data={})')
    lines.push('    assert resp.status_code == 422')
    lines.push('')
  }
  return lines.join('\n').replace(/\n+$/, '\n')
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
