import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { Pool } from "pg";

function getPostgresConnectionString(): string {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.PRISMA_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    ""
  );
}

export function isPersistentDbConfigured(): boolean {
  return Boolean(process.env.DB_PATH || getPostgresConnectionString());
}

export function getDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  return path.join(process.cwd(), ".data", "coach.db");
}

function buildSqliteDb() {
  const DATA_DIR = path.dirname(getDbPath());
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const DB_PATH = getDbPath();
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,
      owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      role         TEXT NOT NULL,
      company      TEXT NOT NULL DEFAULT '',
      company_url  TEXT NOT NULL DEFAULT '',
      company_context TEXT NOT NULL DEFAULT '',
      jd_text      TEXT NOT NULL DEFAULT '',
      resume_text  TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'active',
      total_score  REAL,
      duration_s   INTEGER DEFAULT 0,
      verdict      TEXT DEFAULT '',
      study_plan   TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS turns (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      turn_index      INTEGER NOT NULL,
      question        TEXT NOT NULL,
      question_type   TEXT NOT NULL DEFAULT 'behavioral',
      answer_text     TEXT NOT NULL DEFAULT '',
      answer_audio_s  REAL DEFAULT 0,
      filler_count    INTEGER DEFAULT 0,
      filler_words    TEXT DEFAULT '[]',
      wpm             INTEGER DEFAULT 0,
      score           REAL,
      feedback        TEXT,
      strengths       TEXT DEFAULT '[]',
      improvements    TEXT DEFAULT '[]',
      star_breakdown  TEXT DEFAULT '{}',
      eot_probability REAL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  if (!sessionColumns.some((column) => column.name === "owner_user_id")) db.exec("ALTER TABLE sessions ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE");
  if (!sessionColumns.some((column) => column.name === "company_url")) db.exec("ALTER TABLE sessions ADD COLUMN company_url TEXT NOT NULL DEFAULT ''");
  if (!sessionColumns.some((column) => column.name === "company_context")) db.exec("ALTER TABLE sessions ADD COLUMN company_context TEXT NOT NULL DEFAULT ''");

  return db;
}

function buildSqliteQueryBundle(db: Database.Database) {
  return {
    user: {
      create: { run: (v: Record<string, any>) => db.prepare(`INSERT INTO users (id,email,password_hash) VALUES (@id,@email,@password_hash)`).run(v) },
      getByEmail: { get: (email: string) => db.prepare(`SELECT * FROM users WHERE email=?`).get(email) },
    },
    session: {
      create: { run: (values: Record<string, any>) => db.prepare(`INSERT INTO sessions (id,owner_user_id,role,company,company_url,company_context,jd_text,resume_text) VALUES (@id,@owner_user_id,@role,@company,@company_url,@company_context,@jd_text,@resume_text)`).run(values) },
      get: { get: (id: string, userId: string) => db.prepare(`SELECT * FROM sessions WHERE id = ? AND owner_user_id = ?`).get(id, userId) },
      list: { all: (userId: string) => db.prepare(`SELECT * FROM sessions WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 100`).all(userId) },
      finish: { run: (v: Record<string, any>) => db.prepare(`UPDATE sessions SET status='completed',total_score=@score,duration_s=@dur,verdict=@verdict,study_plan=@study_plan WHERE id=@id AND owner_user_id=@owner_user_id`).run(v) },
      updateDocs: { run: (v: Record<string, any>) => db.prepare(`UPDATE sessions SET jd_text=@jd,resume_text=@resume WHERE id=@id AND owner_user_id=@owner_user_id`).run(v) },
    },
    turn: {
      create: { run: (values: Record<string, any>) => db.prepare(`INSERT INTO turns (id,session_id,turn_index,question,question_type) SELECT @id,@session_id,@turn_index,@question,@question_type WHERE EXISTS (SELECT 1 FROM sessions WHERE id=@session_id AND owner_user_id=@owner_user_id)`).run(values) },
      update: { run: (values: Record<string, any>) => db.prepare(`
        UPDATE turns SET
          answer_text=@answer_text, answer_audio_s=@answer_audio_s, filler_count=@filler_count,
          filler_words=@filler_words, wpm=@wpm, score=@score, feedback=@feedback,
          strengths=@strengths, improvements=@improvements, star_breakdown=@star_breakdown,
          eot_probability=@eot_probability
        WHERE id=@id AND EXISTS (SELECT 1 FROM sessions WHERE sessions.id=turns.session_id AND sessions.owner_user_id=@owner_user_id)
      `).run(values) },
      bySession: { all: (sid: string, uid: string) => db.prepare(`SELECT turns.* FROM turns JOIN sessions ON sessions.id=turns.session_id WHERE turns.session_id=? AND sessions.owner_user_id=? ORDER BY turn_index`).all(sid, uid) },
      get: { get: (id: string, uid: string) => db.prepare(`SELECT turns.* FROM turns JOIN sessions ON sessions.id=turns.session_id WHERE turns.id=? AND sessions.owner_user_id=?`).get(id, uid) },
      count: { get: (sid: string, uid: string) => db.prepare(`SELECT COUNT(*) as n FROM turns JOIN sessions ON sessions.id=turns.session_id WHERE turns.session_id=? AND sessions.owner_user_id=?`).get(sid, uid) },
    },
  } as const;
}

async function ensurePostgresSchema(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      role TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      company_url TEXT NOT NULL DEFAULT '',
      company_context TEXT NOT NULL DEFAULT '',
      jd_text TEXT NOT NULL DEFAULT '',
      resume_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      total_score DOUBLE PRECISION,
      duration_s INTEGER DEFAULT 0,
      verdict TEXT DEFAULT '',
      study_plan TEXT DEFAULT '[]'
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      turn_index INTEGER NOT NULL,
      question TEXT NOT NULL,
      question_type TEXT NOT NULL DEFAULT 'behavioral',
      answer_text TEXT NOT NULL DEFAULT '',
      answer_audio_s DOUBLE PRECISION DEFAULT 0,
      filler_count INTEGER DEFAULT 0,
      filler_words TEXT DEFAULT '[]',
      wpm INTEGER DEFAULT 0,
      score DOUBLE PRECISION,
      feedback TEXT,
      strengths TEXT DEFAULT '[]',
      improvements TEXT DEFAULT '[]',
      star_breakdown TEXT DEFAULT '{}',
      eot_probability DOUBLE PRECISION DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS company_url TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS company_context TEXT NOT NULL DEFAULT '';
  `);
}

function buildPostgresQueryBundle(pool: Pool) {
  return {
    user: {
      create: { run: async (v: Record<string, any>) => { await schemaReady; await pool.query(`INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)`, [v.id, v.email, v.password_hash]); } },
      getByEmail: { get: async (email: string) => { await schemaReady; return (await pool.query(`SELECT * FROM users WHERE email=$1`, [email])).rows[0] || null; } },
    },
    session: {
      create: { run: async (v: Record<string, any>) => { await schemaReady; await pool.query(`INSERT INTO sessions (id,owner_user_id,role,company,company_url,company_context,jd_text,resume_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [v.id, v.owner_user_id, v.role, v.company, v.company_url, v.company_context, v.jd_text, v.resume_text]); } },
      get: { get: async (id: string, uid: string) => { await schemaReady; return (await pool.query(`SELECT * FROM sessions WHERE id=$1 AND owner_user_id=$2`, [id, uid])).rows[0] || null; } },
      list: { all: async (uid: string) => { await schemaReady; return (await pool.query(`SELECT * FROM sessions WHERE owner_user_id=$1 ORDER BY created_at DESC LIMIT 100`, [uid])).rows; } },
      finish: { run: async (v: Record<string, any>) => { await schemaReady; await pool.query(`UPDATE sessions SET status='completed',total_score=$1,duration_s=$2,verdict=$3,study_plan=$4 WHERE id=$5 AND owner_user_id=$6`, [v.score, v.dur, v.verdict, v.study_plan, v.id, v.owner_user_id]); } },
      updateDocs: { run: async (v: Record<string, any>) => { await schemaReady; await pool.query(`UPDATE sessions SET jd_text=$1,resume_text=$2 WHERE id=$3 AND owner_user_id=$4`, [v.jd, v.resume, v.id, v.owner_user_id]); } },
    },
    turn: {
      create: { run: async (values: Record<string, any>) => { await schemaReady; await pool.query(`INSERT INTO turns (id,session_id,turn_index,question,question_type) SELECT $1,$2,$3,$4,$5 WHERE EXISTS (SELECT 1 FROM sessions WHERE id=$2 AND owner_user_id=$6)`, [values.id, values.session_id, values.turn_index, values.question, values.question_type, values.owner_user_id]); } },
      update: { run: async (values: Record<string, any>) => { await schemaReady; await pool.query(`
        UPDATE turns SET
          answer_text=$1, answer_audio_s=$2, filler_count=$3,
          filler_words=$4, wpm=$5, score=$6, feedback=$7,
          strengths=$8, improvements=$9, star_breakdown=$10,
          eot_probability=$11
        WHERE id=$12 AND EXISTS (SELECT 1 FROM sessions WHERE sessions.id=turns.session_id AND sessions.owner_user_id=$13)
      `, [values.answer_text, values.answer_audio_s, values.filler_count, values.filler_words, values.wpm, values.score, values.feedback, values.strengths, values.improvements, values.star_breakdown, values.eot_probability, values.id, values.owner_user_id]); } },
      bySession: { all: async (sid: string, uid: string) => { await schemaReady; return (await pool.query(`SELECT turns.* FROM turns JOIN sessions ON sessions.id=turns.session_id WHERE turns.session_id=$1 AND sessions.owner_user_id=$2 ORDER BY turn_index`, [sid, uid])).rows; } },
      get: { get: async (id: string, uid: string) => { await schemaReady; return (await pool.query(`SELECT turns.* FROM turns JOIN sessions ON sessions.id=turns.session_id WHERE turns.id=$1 AND sessions.owner_user_id=$2`, [id, uid])).rows[0] || null; } },
      count: { get: async (sid: string, uid: string) => { await schemaReady; return (await pool.query(`SELECT COUNT(*) as n FROM turns JOIN sessions ON sessions.id=turns.session_id WHERE turns.session_id=$1 AND sessions.owner_user_id=$2`, [sid, uid])).rows[0]; } },
    },
  } as const;
}

let dbHandle: Database.Database | null = null;
const connectionString = getPostgresConnectionString();
const defaultPool = connectionString ? new Pool({ connectionString }) : null;

const schemaReady = defaultPool ? ensurePostgresSchema(defaultPool) : Promise.resolve();
if (!defaultPool) {
  dbHandle = buildSqliteDb();
}

const defaultQueryBundle = defaultPool
  ? buildPostgresQueryBundle(defaultPool)
  : buildSqliteQueryBundle(dbHandle!);

export default defaultPool ?? dbHandle;
export const q = defaultQueryBundle;

export type SessionRow = {
  id: string; created_at: string; role: string; company: string; company_url: string; company_context: string;
  jd_text: string; resume_text: string; status: string;
  total_score: number | null; duration_s: number; verdict: string; study_plan: string;
};

export type TurnRow = {
  id: string; session_id: string; turn_index: number; question: string;
  question_type: string; answer_text: string; answer_audio_s: number;
  filler_count: number; filler_words: string; wpm: number;
  score: number | null; feedback: string | null;
  strengths: string; improvements: string; star_breakdown: string;
  eot_probability: number; created_at: string;
};
