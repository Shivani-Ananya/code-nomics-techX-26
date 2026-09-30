import { integer, primaryKey, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  role: text("role", { enum: ["host", "participant"] }).notNull(),
  name: text("name").notNull(),
  college: text("college"),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  disqualified: integer("disqualified", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("idx_users_role").on(t.role)]);

export const rounds = sqliteTable("rounds", {
  id: text("id").primaryKey(),
  status: text("status", { enum: ["waiting", "active", "paused", "ended"] }).notNull().default("waiting"),
  durationSeconds: integer("duration_seconds").notNull(),
  startedAt: integer("started_at"),
  pausedAt: integer("paused_at"),
  accumulatedPauseSeconds: integer("accumulated_pause_seconds").notNull().default(0),
  resultsPublished: integer("results_published", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at").notNull(),
});

export const participants = sqliteTable("participants", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  quizSubmittedAt: integer("quiz_submitted_at"),
  quizCorrect: integer("quiz_correct").notNull().default(0),
  coins: integer("coins").notNull().default(0),
  codingScore: integer("coding_score").notNull().default(0),
  language: text("language", { enum: ["Python", "Java"] }),
  currentQuestion: integer("current_question").notNull().default(1),
  solved: integer("solved").notNull().default(0),
  helpsUsed: integer("helps_used").notNull().default(0),
  completionTime: integer("completion_time"),
  status: text("status").notNull().default("waiting"),
  lastSeen: integer("last_seen").notNull(),
});

export const quizQuestions = sqliteTable("quiz_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(),
  difficulty: text("difficulty", { enum: ["EASY", "MEDIUM", "HARD"] }).notNull(),
  prompt: text("prompt").notNull(),
  optionsJson: text("options_json").notNull(),
  correctIndex: integer("correct_index").notNull(),
  coinValue: integer("coin_value").notNull(),
});

export const quizAnswers = sqliteTable("quiz_answers", {
  participantId: text("participant_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  questionId: integer("question_id").notNull().references(() => quizQuestions.id, { onDelete: "cascade" }),
  answerIndex: integer("answer_index").notNull(),
  answeredAt: integer("answered_at").notNull(),
}, (t) => [primaryKey({ columns: [t.participantId, t.questionId] }), index("idx_quiz_answers_participant").on(t.participantId)]);

export const codingQuestions = sqliteTable("coding_questions", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  difficulty: text("difficulty").notNull(),
  points: integer("points").notNull(),
  statement: text("statement").notNull(),
  inputFormat: text("input_format").notNull(),
  outputFormat: text("output_format").notNull(),
  sampleInput: text("sample_input").notNull(),
  sampleOutput: text("sample_output").notNull(),
  hintsJson: text("hints_json").notNull(),
});

export const testCases = sqliteTable("test_cases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id").notNull().references(() => codingQuestions.id, { onDelete: "cascade" }),
  input: text("input").notNull(),
  expectedOutput: text("expected_output").notNull(),
  position: integer("position").notNull(),
}, (t) => [uniqueIndex("idx_test_cases_question_position").on(t.questionId, t.position)]);

export const submissions = sqliteTable("submissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  participantId: text("participant_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  questionId: integer("question_id").notNull().references(() => codingQuestions.id),
  language: text("language").notNull(),
  source: text("source").notNull(),
  passedCount: integer("passed_count").notNull().default(0),
  verdict: text("verdict").notNull(),
  judgeReference: text("judge_reference"),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("idx_submissions_participant_created").on(t.participantId, t.createdAt)]);

export const solvedProblems = sqliteTable("solved_problems", {
  participantId: text("participant_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  questionId: integer("question_id").notNull().references(() => codingQuestions.id),
  solvedAt: integer("solved_at").notNull(),
  pointsAwarded: integer("points_awarded").notNull(),
}, (t) => [primaryKey({ columns: [t.participantId, t.questionId] })]);

export const helpPurchases = sqliteTable("help_purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  participantId: text("participant_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  questionId: integer("question_id").notNull().references(() => codingQuestions.id),
  kind: text("kind").notNull(),
  cost: integer("cost").notNull(),
  language: text("language").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("idx_help_participant").on(t.participantId)]);

export const coinTransactions = sqliteTable("coin_transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  participantId: text("participant_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  description: text("description").notNull(),
  balanceBefore: integer("balance_before").notNull(),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("idx_coin_transactions_participant_created").on(t.participantId, t.createdAt)]);
