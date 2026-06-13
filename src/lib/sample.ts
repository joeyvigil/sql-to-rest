export const SAMPLE_SQL = `CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         VARCHAR(255) UNIQUE NOT NULL,
    username      VARCHAR(80) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE authors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        VARCHAR(120) NOT NULL,
    email       VARCHAR(255) UNIQUE NOT NULL,
    bio         TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id   INTEGER NOT NULL,
    title       VARCHAR(200) NOT NULL,
    body        TEXT,
    published   BOOLEAN DEFAULT false,
    views       INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE
);

CREATE TABLE comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id     INTEGER NOT NULL REFERENCES posts(id),
    author_id   INTEGER REFERENCES authors(id),
    content     TEXT NOT NULL,
    rating      DECIMAL(2,1),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
`
