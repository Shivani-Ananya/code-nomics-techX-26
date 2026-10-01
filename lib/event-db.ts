import { env } from "cloudflare:workers";
import { hashPassword, randomSalt } from "./event-auth";

export function db() {
  const value = (env as unknown as { DB?: D1Database }).DB;
  if (!value) throw new Error("D1 binding DB is unavailable");
  return value;
}

const baseQuiz = [
  ["Data Structures", "Which data structure follows FIFO?", ["Stack", "Queue", "Tree", "Graph"], 1],
  ["Algorithms", "What is the time complexity of binary search?", ["O(n)", "O(log n)", "O(n²)", "O(1)"], 1],
  ["Networks", "Which protocol securely transfers web pages?", ["HTTP", "FTP", "HTTPS", "SMTP"], 2],
  ["DBMS", "Which normal form removes partial dependency?", ["1NF", "2NF", "3NF", "BCNF"], 1],
  ["Operating Systems", "What does an operating system scheduler select?", ["A file", "The next process", "A network route", "A database row"], 1],
  ["Programming", "Which symbol commonly starts a single-line Python comment?", ["//", "#", "--", "/*"], 1],
  ["Logical Reasoning", "What is the next number: 2, 4, 8, 16?", ["18", "24", "30", "32"], 3],
  ["Basic Technology", "What does CPU stand for?", ["Central Processing Unit", "Computer Primary Utility", "Core Program Unit", "Central Program User"], 0],
] as const;

const coding = [
  { id: 1, title: "Count Vowels", difficulty: "EASY", points: 300, statement: "Given a string, count how many vowels (a, e, i, o, u) it contains.", input: "A single line containing the input string.", output: "Print the total number of vowels.", sampleIn: "hello world", sampleOut: "3", hints: ["Scan each character once.", "Use a set containing a, e, i, o and u.", "Increment a counter when the lowercased character is in the vowel set."], tests: [["hello world","3"],["rhythm","0"],["AEIOU","5"],["OpenAI","4"],["a","1"]] },
  { id: 2, title: "Find the Largest Number", difficulty: "EASY", points: 300, statement: "Given N numbers, find the largest without using a built-in max function.", input: "N followed by N space-separated integers.", output: "Print the largest number.", sampleIn: "5\n10 25 7 42 18", sampleOut: "42", hints: ["Keep the largest value seen so far.", "Initialize from the first number.", "Compare every remaining value with the current largest."], tests: [["5\n10 25 7 42 18","42"],["3\n-5 -2 -9","-2"],["1\n7","7"],["4\n0 0 0 0","0"],["6\n1 99 5 44 98 2","99"]] },
  { id: 3, title: "Remove Duplicate Elements", difficulty: "MEDIUM", points: 500, statement: "Remove duplicate array values while keeping their original order.", input: "N followed by N space-separated integers.", output: "Print unique elements in original order.", sampleIn: "7\n1 2 2 3 1 4 3", sampleOut: "1 2 3 4", hints: ["Track values already seen.", "Append only the first occurrence.", "A set gives constant-time membership checks."], tests: [["7\n1 2 2 3 1 4 3","1 2 3 4"],["5\n5 5 5 5 5","5"],["4\n1 2 3 4","1 2 3 4"],["6\n-1 -1 0 1 0 2","-1 0 1 2"],["0\n",""]] },
  { id: 4, title: "Check for Anagram", difficulty: "MEDIUM", points: 500, statement: "Determine whether two strings contain the same characters with the same frequencies.", input: "Two lines, one string per line.", output: "Print Anagram or Not Anagram.", sampleIn: "listen\nsilent", sampleOut: "Anagram", hints: ["Normalize both strings consistently.", "Count each character in both strings.", "The frequency maps must match exactly."], tests: [["listen\nsilent","Anagram"],["hello\nworld","Not Anagram"],["triangle\nintegral","Anagram"],["aabb\nabab","Anagram"],["abc\nabcd","Not Anagram"]] },
  { id: 5, title: "First Non-Repeating Character", difficulty: "HARD", points: 800, statement: "Find the first character that appears exactly once, or print -1.", input: "A single line containing the string.", output: "Print the first non-repeating character or -1.", sampleIn: "aabbcdde", sampleOut: "c", hints: ["First count all characters.", "Then scan the original string again.", "Return the first character whose count equals one."], tests: [["aabbcdde","c"],["aabbcc","-1"],["z","z"],["swiss","w"],["aAbBABac","b"]] },
];

export async function ensureSeeded() {
  const database = db();
  const existing = await database.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  if ((existing?.count || 0) > 0) return;
  const now = Date.now();
  const userStatements: D1PreparedStatement[] = [];
  const identities = [
    ["HOST-01", "host", "Host Admin", "TECHX Madras 26"],
    ...Array.from({ length: 10 }, (_, i) => ["CA-" + String(1001 + i), "participant", ["Arjun Mehta","Priya Nair","Rahul Sen","Meera Iyer","Kabir Shah","Ananya Rao","Dev Patel","Sara Khan","Vikram Das","Nila Kumar"][i], ["NIT Trichy","PSG Tech","VIT Chennai","CEG Anna University","SRM IST","MIT Chennai","IIT Madras","SSN College","SASTRA","REC Chennai"][i]]),
  ];
  const config = env as unknown as Record<string, string>;
  const hostPassword = config.EVENT_HOST_PASSWORD;
  const participantPassword = config.EVENT_PARTICIPANT_PASSWORD;
  if (!hostPassword || hostPassword.length < 12 || !participantPassword || participantPassword.length < 12) {
    throw new Error("EVENT_HOST_PASSWORD and EVENT_PARTICIPANT_PASSWORD must each contain at least 12 characters");
  }
  for (const [id, role, name, college] of identities) {
    const salt = randomSalt();
    const hash = await hashPassword(role === "host" ? hostPassword : participantPassword, salt);
    userStatements.push(database.prepare("INSERT INTO users (id, role, name, college, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, role, name, college, hash, salt, now));
    if (role === "participant") userStatements.push(database.prepare("INSERT INTO participants (user_id, last_seen) VALUES (?, ?)").bind(id, now));
  }
  userStatements.push(database.prepare("INSERT INTO rounds (id, status, duration_seconds, updated_at) VALUES ('round1', 'waiting', 1800, ?)").bind(now));
  userStatements.push(database.prepare("INSERT INTO rounds (id, status, duration_seconds, updated_at) VALUES ('round2', 'waiting', 7200, ?)").bind(now));
  await database.batch(userStatements);

  const quizStatements: D1PreparedStatement[] = [];
  for (let i = 0; i < 40; i++) {
    const q = baseQuiz[i % baseQuiz.length];
    const difficulty = i < 15 ? "EASY" : i < 30 ? "MEDIUM" : "HARD";
    const value = difficulty === "EASY" ? 20 : difficulty === "MEDIUM" ? 40 : 70;
    quizStatements.push(database.prepare("INSERT INTO quiz_questions (category, difficulty, prompt, options_json, correct_index, coin_value) VALUES (?, ?, ?, ?, ?, ?)").bind(q[0], difficulty, q[1], JSON.stringify(q[2]), q[3], value));
  }
  await database.batch(quizStatements);

  const codingStatements: D1PreparedStatement[] = [];
  for (const q of coding) {
    codingStatements.push(database.prepare("INSERT INTO coding_questions (id, title, difficulty, points, statement, input_format, output_format, sample_input, sample_output, hints_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(q.id, q.title, q.difficulty, q.points, q.statement, q.input, q.output, q.sampleIn, q.sampleOut, JSON.stringify(q.hints)));
    q.tests.forEach((test, index) => codingStatements.push(database.prepare("INSERT INTO test_cases (question_id, input, expected_output, position) VALUES (?, ?, ?, ?)").bind(q.id, test[0], test[1], index + 1)));
  }
  await database.batch(codingStatements);
}

export function remaining(round: { status: string; duration_seconds: number; started_at: number | null; paused_at: number | null; accumulated_pause_seconds: number }) {
  if (!round.started_at) return round.duration_seconds;
  const end = round.status === "paused" && round.paused_at ? round.paused_at : Date.now();
  return Math.max(0, round.duration_seconds - Math.floor((end - round.started_at) / 1000) + round.accumulated_pause_seconds);
}
