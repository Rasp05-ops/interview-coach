import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_PATH = path.join(DATA_DIR, "coach.db");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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
if (!sessionColumns.some(column => column.name === "company_url")) db.exec("ALTER TABLE sessions ADD COLUMN company_url TEXT NOT NULL DEFAULT ''");
if (!sessionColumns.some(column => column.name === "company_context")) db.exec("ALTER TABLE sessions ADD COLUMN company_context TEXT NOT NULL DEFAULT ''");

export default db;

export const q = {
  session: {
    create: db.prepare(`INSERT INTO sessions (id,role,company,company_url,company_context,jd_text,resume_text) VALUES (@id,@role,@company,@company_url,@company_context,@jd_text,@resume_text)`),
    get:    db.prepare(`SELECT * FROM sessions WHERE id = ?`),
    list:   db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC LIMIT 100`),
    finish: db.prepare(`UPDATE sessions SET status='completed',total_score=@score,duration_s=@dur,verdict=@verdict,study_plan=@study_plan WHERE id=@id`),
    updateDocs: db.prepare(`UPDATE sessions SET jd_text=@jd,resume_text=@resume WHERE id=@id`),
  },
  turn: {
    create: db.prepare(`INSERT INTO turns (id,session_id,turn_index,question,question_type) VALUES (@id,@session_id,@turn_index,@question,@question_type)`),
    update: db.prepare(`
      UPDATE turns SET
        answer_text=@answer_text, answer_audio_s=@answer_audio_s, filler_count=@filler_count,
        filler_words=@filler_words, wpm=@wpm, score=@score, feedback=@feedback,
        strengths=@strengths, improvements=@improvements, star_breakdown=@star_breakdown,
        eot_probability=@eot_probability
      WHERE id=@id
    `),
    bySession: db.prepare(`SELECT * FROM turns WHERE session_id=? ORDER BY turn_index`),
    get:       db.prepare(`SELECT * FROM turns WHERE id=?`),
    count:     db.prepare(`SELECT COUNT(*) as n FROM turns WHERE session_id=?`),
  },
};

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
