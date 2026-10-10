import { hashPassword, randomSalt } from "./event-auth";
import { db } from "./postgres";
import {
  codingQuestions,
  quizQuestions,
  validateQuestionBank,
} from "./question-bank";

validateQuestionBank();

export { db };

let databaseSeedReady: Promise<void> | null = null;

async function seedDatabase() {
  const database = db();
  await database.begin(async (tx) => {
    // Disable timeouts for cold-start seeding — inserts many rows against remote Supabase
    await tx`SET LOCAL statement_timeout = 0`;
    await tx`SET LOCAL lock_timeout = 60000`;
    await tx`SET LOCAL idle_in_transaction_session_timeout = 0`;
    await tx`SELECT pg_advisory_xact_lock(hashtext('code-auction-seed'))`;
    const [{ host_count: hostCount }] = await tx<{ host_count: number }[]>`SELECT count(*) FILTER (WHERE role='host')::int AS host_count FROM users`;
    const hostPassword = process.env.EVENT_HOST_PASSWORD;
    if (!hostPassword || hostPassword.length < 12) throw new Error("EVENT_HOST_PASSWORD must contain at least 12 characters");
    const now = Date.now();
    const hostSalt = randomSalt();
    const hostHash = await hashPassword(hostPassword, hostSalt);
    if (hostCount === 0) {
      await tx`INSERT INTO users (id, role, name, college, password_hash, password_salt, created_at) VALUES ('HOST-01', 'host', 'Host Admin', 'TECHX Madras 26', ${hostHash}, ${hostSalt}, ${now})`;
    } else {
      await tx`UPDATE users SET password_hash=${hostHash}, password_salt=${hostSalt} WHERE id='HOST-01'`;
    }

    await tx`INSERT INTO rounds (id, status, duration_seconds, updated_at)
      VALUES ('round1', 'waiting', 1800, ${now}), ('round2', 'waiting', 7200, ${now})
      ON CONFLICT (id) DO NOTHING`;

    const [quizState] = await tx<{ total: number; unique_prompts: number; answer_count: number }[]>`
      SELECT
        (SELECT count(*)::int FROM quiz_questions) AS total,
        (SELECT count(DISTINCT lower(trim(prompt)))::int FROM quiz_questions) AS unique_prompts,
        (SELECT count(*)::int FROM quiz_answers) AS answer_count`;
    const replaceQuiz =
      quizState.total === 0 ||
      (quizState.answer_count === 0 &&
        (quizState.total !== quizQuestions.length ||
          quizState.unique_prompts !== quizQuestions.length));
    if (replaceQuiz) {
      await tx`DELETE FROM quiz_questions`;
      const quizRows = quizQuestions.map((question) => ({
        category: question.category,
        difficulty: question.difficulty,
        prompt: question.prompt,
        options_json: tx.json([...question.options]),
        correct_index: question.correctIndex,
        coin_value: question.coinValue,
      }));
      await tx`INSERT INTO quiz_questions ${tx(
        quizRows,
        "category",
        "difficulty",
        "prompt",
        "options_json",
        "correct_index",
        "coin_value",
      )}`;
    }

    const codingRows = await tx<{ id: number; title: string }[]>`SELECT id, title FROM coding_questions ORDER BY id`;
    const [{ activity_count: codingActivity }] = await tx<{ activity_count: number }[]>`
      SELECT (
        (SELECT count(*) FROM submissions) +
        (SELECT count(*) FROM submission_jobs) +
        (SELECT count(*) FROM solved_problems) +
        (SELECT count(*) FROM coding_question_scores) +
        (SELECT count(*) FROM help_purchases)
      )::int AS activity_count`;
    const replaceableCodingBanks = [
      [
        "Count Vowels",
        "Find the Largest Number",
        "Remove Duplicate Elements",
        "Check for Anagram",
        "First Non-Repeating Character",
      ],
      [
        "Rotate Array Right",
        "Valid Bracket Sequence",
        "Longest Unique Substring",
        "Minimum Coins",
        "Shortest Path in a Grid",
      ],
    ];
    const isLegacyCodingBank = replaceableCodingBanks.some(
      (titles) =>
        codingRows.length === titles.length &&
        codingRows.every(
          (row, index) => row.id === index + 1 && row.title === titles[index],
        ),
    );
    if (isLegacyCodingBank && codingActivity > 0) {
      await tx`DELETE FROM submissions`;
      await tx`DELETE FROM solved_problems`;
      await tx`DELETE FROM coding_question_scores`;
      await tx`DELETE FROM help_purchases`;
      await tx`DELETE FROM coin_transactions WHERE type='help_purchase'`;
      await tx`UPDATE participants SET coins=COALESCE((SELECT sum(amount)::int FROM coin_transactions WHERE participant_id=participants.user_id AND type='quiz_award'), 0), coding_score=0, language=NULL, current_question=1, solved=0, helps_used=0, completion_time=NULL, coding_submitted_at=NULL, status='waiting'`;
      await tx`UPDATE rounds SET status='waiting', started_at=NULL, paused_at=NULL, accumulated_pause_seconds=0, results_published=false, updated_at=${now} WHERE id='round2'`;
    }
    if (codingRows.length === 0 || isLegacyCodingBank) {
      await tx`DELETE FROM coding_questions`;
      const codingQuestionRows = codingQuestions.map((question) => ({
        id: question.id,
        title: question.title,
        difficulty: question.difficulty,
        points: question.points,
        statement: question.statement,
        input_format: question.input,
        output_format: question.output,
        sample_input: question.sampleIn,
        sample_output: question.sampleOut,
        hints_json: tx.json([...question.hints]),
      }));
      await tx`INSERT INTO coding_questions ${tx(
        codingQuestionRows,
        "id",
        "title",
        "difficulty",
        "points",
        "statement",
        "input_format",
        "output_format",
        "sample_input",
        "sample_output",
        "hints_json",
      )}`;
      const testCaseRows = codingQuestions.flatMap((question) =>
        question.tests.map(([input, expectedOutput], index) => ({
          question_id: question.id,
          input,
          expected_output: expectedOutput,
          position: index + 1,
        })),
      );
      await tx`INSERT INTO test_cases ${tx(
        testCaseRows,
        "question_id",
        "input",
        "expected_output",
        "position",
      )}`;
    }
  });
}

export function ensureSeeded() {
  if (!databaseSeedReady)
    databaseSeedReady = seedDatabase().catch((error) => {
      databaseSeedReady = null;
      throw error;
    });
  return databaseSeedReady;
}

export function remaining(round: { status: string; duration_seconds: number; started_at: number | null; paused_at: number | null; accumulated_pause_seconds: number }) {
  if (!round.started_at) return round.duration_seconds;
  const end = round.status === "paused" && round.paused_at ? round.paused_at : Date.now();
  return Math.max(0, round.duration_seconds - Math.floor((end - round.started_at) / 1000) + round.accumulated_pause_seconds);
}
