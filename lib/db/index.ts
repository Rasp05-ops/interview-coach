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
    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,
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
  if (!sessionColumns.some((column) => column.name === "company_url")) db.exec("ALTER TABLE sessions ADD COLUMN company_url TEXT NOT NULL DEFAULT ''");
  if (!sessionColumns.some((column) => column.name === "company_context")) db.exec("ALTER TABLE sessions ADD COLUMN company_context TEXT NOT NULL DEFAULT ''");

  return db;
}

function buildSqliteQueryBundle(db: Database.Database) {
  return {
    session: {
      create: { run: (values: Record<string, any>) => db.prepare(`INSERT INTO sessions (id,role,company,company_url,company_context,jd_text,resume_text) VALUES (@id,@role,@company,@company_url,@company_context,@jd_text,@resume_text)`).run(values) },
      get: { get: (id: string) => db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) },
      list: { all: () => db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC LIMIT 100`).all() },
      finish: { run: (values: Record<string, any>) => db.prepare(`UPDATE sessions SET status='completed',total_score=@score,duration_s=@dur,verdict=@verdict,study_plan=@study_plan WHERE id=@id`).run(values) },
      updateDocs: { run: (values: Record<string, any>) => db.prepare(`UPDATE sessions SET jd_text=@jd,resume_text=@resume WHERE id=@id`).run(values) },
    },
    turn: {
      create: { run: (values: Record<string, any>) => db.prepare(`INSERT INTO turns (id,session_id,turn_index,question,question_type) VALUES (@id,@session_id,@turn_index,@question,@question_type)`).run(values) },
      update: { run: (values: Record<string, any>) => db.prepare(`
        UPDATE turns SET
          answer_text=@answer_text, answer_audio_s=@answer_audio_s, filler_count=@filler_count,
          filler_words=@filler_words, wpm=@wpm, score=@score, feedback=@feedback,
          strengths=@strengths, improvements=@improvements, star_breakdown=@star_breakdown,
          eot_probability=@eot_probability
        WHERE id=@id
      `).run(values) },
      bySession: { all: (sessionId: string) => db.prepare(`SELECT * FROM turns WHERE session_id=? ORDER BY turn_index`).all(sessionId) },
      get: { get: (id: string) => db.prepare(`SELECT * FROM turns WHERE id=?`).get(id) },
      count: { get: (sessionId: string) => db.prepare(`SELECT COUNT(*) as n FROM turns WHERE session_id=?`).get(sessionId) },
    },
  } as const;
}

async function ensurePostgresSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
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
      ADD COLUMN IF NOT EXISTS company_url TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS company_context TEXT NOT NULL DEFAULT '';
  `);
}

function buildPostgresQueryBundle(pool: Pool) {
  return {
    session: {
      create: {
        run: async (values: Record<string, any>) => {
          await pool.query(
            `INSERT INTO sessions (id,role,company,company_url,company_context,jd_text,resume_text) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [values.id, values.role, values.company, values.company_url, values.company_context, values.jd_text, values.resume_text],
          );
        },
      },
      get: { get: async (id: string) => (await pool.query(`SELECT * FROM sessions WHERE id = $1`, [id])).rows[0] || null },
      list: { all: async () => (await pool.query(`SELECT * FROM sessions ORDER BY created_at DESC LIMIT 100`)).rows },
      finish: { run: async (values: Record<string, any>) => { await pool.query(`UPDATE sessions SET status='completed',total_score=$1,duration_s=$2,verdict=$3,study_plan=$4 WHERE id=$5`, [values.score, values.dur, values.verdict, values.study_plan, values.id]); } },
      updateDocs: { run: async (values: Record<string, any>) => { await pool.query(`UPDATE sessions SET jd_text=$1,resume_text=$2 WHERE id=$3`, [values.jd, values.resume, values.id]); } },
    },
    turn: {
      create: { run: async (values: Record<string, any>) => { await pool.query(`INSERT INTO turns (id,session_id,turn_index,question,question_type) VALUES ($1,$2,$3,$4,$5)`, [values.id, values.session_id, values.turn_index, values.question, values.question_type]); } },
      update: { run: async (values: Record<string, any>) => { await pool.query(`
        UPDATE turns SET
          answer_text=$1, answer_audio_s=$2, filler_count=$3,
          filler_words=$4, wpm=$5, score=$6, feedback=$7,
          strengths=$8, improvements=$9, star_breakdown=$10,
          eot_probability=$11
        WHERE id=$12
      `, [values.answer_text, values.answer_audio_s, values.filler_count, values.filler_words, values.wpm, values.score, values.feedback, values.strengths, values.improvements, values.star_breakdown, values.eot_probability, values.id]); } },
      bySession: { all: async (sessionId: string) => (await pool.query(`SELECT * FROM turns WHERE session_id=$1 ORDER BY turn_index`, [sessionId])).rows },
      get: { get: async (id: string) => (await pool.query(`SELECT * FROM turns WHERE id=$1`, [id])).rows[0] || null },
      count: { get: async (sessionId: string) => (await pool.query(`SELECT COUNT(*) as n FROM turns WHERE session_id=$1`, [sessionId])).rows[0] },
    },
  } as const;
}

let dbHandle: Database.Database | null = null;
const connectionString = getPostgresConnectionString();
const defaultPool = connectionString ? new Pool({ connectionString }) : null;

if (defaultPool) {
  void ensurePostgresSchema(defaultPool).catch((error) => {
    console.error("Failed to initialize Postgres session tables:", error);
  });
} else {
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
