import { db } from "../lib/postgres";
import { codingQuestions, validateQuestionBank } from "../lib/question-bank";

if (process.env.CONFIRM_RESET_CODING_BANK !== "RESET")
  throw new Error("Set CONFIRM_RESET_CODING_BANK=RESET to replace the coding bank and clear Round 2 progress.");

validateQuestionBank();
const database = db();
await database.begin(async (tx) => {
  await tx`SELECT pg_advisory_xact_lock(hashtext('code-auction-coding-bank-reset'))`;
  await tx`DELETE FROM submissions`;
  await tx`DELETE FROM solved_problems`;
  await tx`DELETE FROM coding_question_scores`;
  await tx`DELETE FROM help_purchases`;
  await tx`DELETE FROM coin_transactions WHERE type='help_purchase'`;
  await tx`DELETE FROM coding_questions`;

  const questionRows = codingQuestions.map((question) => ({
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
    questionRows,
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

  const testRows = codingQuestions.flatMap((question) =>
    question.tests.map(([input, expectedOutput], index) => ({
      question_id: question.id,
      input,
      expected_output: expectedOutput,
      position: index + 1,
    })),
  );
  await tx`INSERT INTO test_cases ${tx(
    testRows,
    "question_id",
    "input",
    "expected_output",
    "position",
  )}`;

  await tx`UPDATE participants SET coins=COALESCE((SELECT sum(amount)::int FROM coin_transactions WHERE participant_id=participants.user_id AND type='quiz_award'), 0), coding_score=0, language=NULL, current_question=1, solved=0, helps_used=0, completion_time=NULL, coding_submitted_at=NULL, status='waiting'`;
  await tx`UPDATE rounds SET status='waiting', started_at=NULL, paused_at=NULL, accumulated_pause_seconds=0, results_published=false, updated_at=${Date.now()} WHERE id='round2'`;
});

await database.end();
console.log(`Installed ${codingQuestions.length} beginner coding questions and reset Round 2 progress.`);
