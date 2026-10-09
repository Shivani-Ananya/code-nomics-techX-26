import {
  codingQuestions,
  quizQuestions,
  validateQuestionBank,
} from "../lib/question-bank";

validateQuestionBank();

const referenceSolvers: Record<number, (input: string) => string> = {
  1: (input) => {
    const values = input.trim().split(/\s+/).map(Number);
    const n = values[0];
    const shift = n ? values[1] % n : 0;
    const items = values.slice(2, 2 + n);
    return [...items.slice(n - shift), ...items.slice(0, n - shift)].join(" ");
  },
  2: (input) => {
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    const stack: string[] = [];
    for (const character of input.trim()) {
      if ("([{".includes(character)) stack.push(character);
      else if (stack.pop() !== pairs[character]) return "INVALID";
    }
    return stack.length ? "INVALID" : "VALID";
  },
  3: (input) => {
    const value = input.replace(/\r?\n$/, "");
    const lastSeen = new Map<string, number>();
    let left = 0;
    let best = 0;
    for (let right = 0; right < value.length; right += 1) {
      const previous = lastSeen.get(value[right]);
      if (previous !== undefined && previous >= left) left = previous + 1;
      lastSeen.set(value[right], right);
      best = Math.max(best, right - left + 1);
    }
    return String(best);
  },
  4: (input) => {
    const values = input.trim().split(/\s+/).map(Number);
    const count = values[0];
    const amount = values[1];
    const coins = values.slice(2, 2 + count);
    const dp = Array<number>(amount + 1).fill(Number.POSITIVE_INFINITY);
    dp[0] = 0;
    for (let current = 1; current <= amount; current += 1)
      for (const coin of coins)
        if (coin <= current) dp[current] = Math.min(dp[current], dp[current - coin] + 1);
    return Number.isFinite(dp[amount]) ? String(dp[amount]) : "-1";
  },
  5: (input) => {
    const values = input.trim().split(/\s+/).map(Number);
    const rows = values[0];
    const columns = values[1];
    const grid = Array.from({ length: rows }, (_, row) =>
      values.slice(2 + row * columns, 2 + (row + 1) * columns),
    );
    if (grid[0]?.[0] !== 0 || grid[rows - 1]?.[columns - 1] !== 0) return "-1";
    const queue: Array<[number, number, number]> = [[0, 0, 0]];
    const visited = new Set(["0,0"]);
    for (let head = 0; head < queue.length; head += 1) {
      const [row, column, distance] = queue[head];
      if (row === rows - 1 && column === columns - 1) return String(distance);
      for (const [rowStep, columnStep] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextRow = row + rowStep;
        const nextColumn = column + columnStep;
        const key = `${nextRow},${nextColumn}`;
        if (
          nextRow >= 0 &&
          nextRow < rows &&
          nextColumn >= 0 &&
          nextColumn < columns &&
          grid[nextRow][nextColumn] === 0 &&
          !visited.has(key)
        ) {
          visited.add(key);
          queue.push([nextRow, nextColumn, distance + 1]);
        }
      }
    }
    return "-1";
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
