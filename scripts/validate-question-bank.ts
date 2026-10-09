import {
  codingQuestions,
  quizQuestions,
  validateQuestionBank,
} from "../lib/question-bank";

validateQuestionBank();

const referenceSolvers: Record<number, (input: string) => string> = {
  1: (input) => (Number(input.trim()) % 2 === 0 ? "Even" : "Odd"),
  2: (input) => {
    const values = input.trim().split(/\s+/).map(Number);
    return String(Math.max(values[0], values[1], values[2]));
  },
  3: (input) =>
    String(
      input.trim().split("").reduce((sum, digit) => sum + Number(digit), 0),
    ),
  4: (input) => {
    const value = input.trim();
    return value === value.split("").reverse().join("")
      ? "Palindrome"
      : "Not Palindrome";
  },
  5: (input) => {
    const values = input.trim().split(/\s+/).map(Number);
    const n = values[0];
    const actual = values.slice(1).reduce((sum, value) => sum + value, 0);
    return String((n * (n + 1)) / 2 - actual);
  },
};

for (const question of codingQuestions) {
  const solve = referenceSolvers[question.id];
  for (const [input, expectedOutput] of question.tests) {
    const actual = solve(input).trim();
    if (actual !== expectedOutput.trim())
      throw new Error(
        `${question.title} has an invalid expected output for input ${JSON.stringify(input)}: expected ${JSON.stringify(expectedOutput)}, reference solver returned ${JSON.stringify(actual)}`,
      );
  }
}

const quizBreakdown = Object.entries(
  quizQuestions.reduce<Record<string, number>>((counts, question) => {
    counts[question.difficulty] = (counts[question.difficulty] || 0) + 1;
    return counts;
  }, {}),
)
  .map(([difficulty, count]) => `${difficulty}: ${count}`)
  .join(", ");

console.log(`Round 1 validated: ${quizQuestions.length} unique questions (${quizBreakdown}).`);
console.log(
  `Round 2 validated: ${codingQuestions.length} questions and ${codingQuestions.reduce((total, question) => total + question.tests.length, 0)} hidden tests.`,
);
