export type QuizDifficulty = "EASY" | "MEDIUM" | "HARD";

export type QuizQuestion = {
  category: string;
  difficulty: QuizDifficulty;
  prompt: string;
  options: readonly [string, string, string, string];
  correctIndex: number;
  coinValue: number;
};

export type CodingQuestion = {
  id: number;
  title: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  points: number;
  statement: string;
  input: string;
  output: string;
  sampleIn: string;
  sampleOut: string;
  hints: readonly string[];
  tests: readonly (readonly [input: string, expectedOutput: string])[];
};

export const quizQuestions: readonly QuizQuestion[] = [
  { category: "Computer Basics", difficulty: "EASY", prompt: "What does CPU stand for?", options: ["Central Processing Unit", "Computer Primary Utility", "Core Program Unit", "Central Program User"], correctIndex: 0, coinValue: 20 },
  { category: "Programming", difficulty: "EASY", prompt: "Which symbol starts a single-line comment in Python?", options: ["//", "#", "--", "/*"], correctIndex: 1, coinValue: 20 },
  { category: "Data Structures", difficulty: "EASY", prompt: "Which data structure follows First In, First Out?", options: ["Stack", "Queue", "Tree", "Graph"], correctIndex: 1, coinValue: 20 },
  { category: "Algorithms", difficulty: "EASY", prompt: "What is the time complexity of binary search on a sorted array?", options: ["O(n)", "O(log n)", "O(n²)", "O(1)"], correctIndex: 1, coinValue: 20 },
  { category: "Networks", difficulty: "EASY", prompt: "Which protocol is used for secure web browsing?", options: ["HTTP", "FTP", "HTTPS", "SMTP"], correctIndex: 2, coinValue: 20 },
  { category: "DBMS", difficulty: "EASY", prompt: "Which SQL command reads rows from a table?", options: ["SELECT", "UPDATE", "DELETE", "ALTER"], correctIndex: 0, coinValue: 20 },
  { category: "Operating Systems", difficulty: "EASY", prompt: "Which component manages hardware resources and running programs?", options: ["Compiler", "Operating system", "Web browser", "Text editor"], correctIndex: 1, coinValue: 20 },
  { category: "Programming", difficulty: "EASY", prompt: "Which loop is guaranteed to execute its body at least once in Java?", options: ["for", "while", "do-while", "foreach"], correctIndex: 2, coinValue: 20 },
  { category: "Data Structures", difficulty: "EASY", prompt: "Which operation removes the top element of a stack?", options: ["enqueue", "dequeue", "push", "pop"], correctIndex: 3, coinValue: 20 },
  { category: "Web", difficulty: "EASY", prompt: "Which language is primarily used to style web pages?", options: ["HTML", "CSS", "SQL", "Python"], correctIndex: 1, coinValue: 20 },
  { category: "Number Systems", difficulty: "EASY", prompt: "What is binary 1010 in decimal?", options: ["8", "9", "10", "12"], correctIndex: 2, coinValue: 20 },
  { category: "Software Engineering", difficulty: "EASY", prompt: "What does API stand for?", options: ["Application Programming Interface", "Automated Program Input", "Application Process Integration", "Advanced Programming Instruction"], correctIndex: 0, coinValue: 20 },
  { category: "Cybersecurity", difficulty: "EASY", prompt: "Which password is strongest?", options: ["password123", "techx2026", "P7!mQ2#zL9@v", "12345678"], correctIndex: 2, coinValue: 20 },
  { category: "Cloud", difficulty: "EASY", prompt: "Which cloud service model provides virtual machines?", options: ["IaaS", "SaaS", "DNS", "SMTP"], correctIndex: 0, coinValue: 20 },
  { category: "Git", difficulty: "EASY", prompt: "Which Git command records staged changes as a new revision?", options: ["git clone", "git add", "git commit", "git pull"], correctIndex: 2, coinValue: 20 },
  { category: "Programming", difficulty: "EASY", prompt: "What is the result of 17 % 5?", options: ["2", "3", "3.4", "5"], correctIndex: 0, coinValue: 20 },
  { category: "Data Structures", difficulty: "EASY", prompt: "Which structure stores data as key-value pairs?", options: ["Queue", "Hash map", "Stack", "Linked list"], correctIndex: 1, coinValue: 20 },
  { category: "Networks", difficulty: "EASY", prompt: "Which device forwards packets between different networks?", options: ["Keyboard", "Router", "Printer", "Compiler"], correctIndex: 1, coinValue: 20 },
  { category: "DBMS", difficulty: "EASY", prompt: "What uniquely identifies a row in a relational table?", options: ["Foreign key", "Primary key", "View", "Index name"], correctIndex: 1, coinValue: 20 },
  { category: "Logical Reasoning", difficulty: "EASY", prompt: "What is the next number in 2, 6, 12, 20, 30?", options: ["36", "40", "42", "44"], correctIndex: 2, coinValue: 20 },
  { category: "Algorithms", difficulty: "MEDIUM", prompt: "Which sorting algorithm has O(n log n) worst-case time and typically uses extra arrays?", options: ["Bubble sort", "Insertion sort", "Merge sort", "Selection sort"], correctIndex: 2, coinValue: 40 },
  { category: "Data Structures", difficulty: "MEDIUM", prompt: "Which traversal of a binary search tree produces keys in sorted order?", options: ["Preorder", "Inorder", "Postorder", "Level order"], correctIndex: 1, coinValue: 40 },
  { category: "DBMS", difficulty: "MEDIUM", prompt: "Which normal form removes partial dependency on a composite key?", options: ["1NF", "2NF", "3NF", "BCNF"], correctIndex: 1, coinValue: 40 },
  { category: "Operating Systems", difficulty: "MEDIUM", prompt: "Which scheduling algorithm may cause starvation for low-priority processes?", options: ["Round robin", "First come first served", "Priority scheduling", "FIFO paging"], correctIndex: 2, coinValue: 40 },
  { category: "Networks", difficulty: "MEDIUM", prompt: "Which OSI layer is responsible for end-to-end delivery and port numbers?", options: ["Network", "Transport", "Session", "Data link"], correctIndex: 1, coinValue: 40 },
  { category: "Programming", difficulty: "MEDIUM", prompt: "What principle allows one interface to have multiple implementations?", options: ["Encapsulation", "Polymorphism", "Recursion", "Compilation"], correctIndex: 1, coinValue: 40 },
  { category: "Algorithms", difficulty: "MEDIUM", prompt: "Breadth-first search uses which data structure for its frontier?", options: ["Stack", "Queue", "Heap only", "Hash table only"], correctIndex: 1, coinValue: 40 },
  { category: "Cybersecurity", difficulty: "MEDIUM", prompt: "Which property ensures data was not altered in transit?", options: ["Availability", "Integrity", "Compression", "Caching"], correctIndex: 1, coinValue: 40 },
  { category: "Web", difficulty: "MEDIUM", prompt: "Which HTTP status code means the requested resource was not found?", options: ["200", "301", "404", "500"], correctIndex: 2, coinValue: 40 },
  { category: "DBMS", difficulty: "MEDIUM", prompt: "Which JOIN returns only rows with matching values in both tables?", options: ["LEFT JOIN", "FULL JOIN", "CROSS JOIN", "INNER JOIN"], correctIndex: 3, coinValue: 40 },
  { category: "Operating Systems", difficulty: "MEDIUM", prompt: "What is virtual memory primarily used for?", options: ["Replacing the CPU", "Extending usable memory with secondary storage", "Encrypting files", "Increasing network speed"], correctIndex: 1, coinValue: 40 },
  { category: "Git", difficulty: "MEDIUM", prompt: "Which Git operation combines another branch into the current branch?", options: ["merge", "status", "init", "stash list"], correctIndex: 0, coinValue: 40 },
  { category: "Algorithms", difficulty: "MEDIUM", prompt: "What is the time complexity of inserting at the head of a singly linked list?", options: ["O(1)", "O(log n)", "O(n)", "O(n²)"], correctIndex: 0, coinValue: 40 },
  { category: "Networks", difficulty: "MEDIUM", prompt: "Which protocol automatically assigns IP addresses on a local network?", options: ["DNS", "DHCP", "SSH", "ARP only"], correctIndex: 1, coinValue: 40 },
  { category: "Algorithms", difficulty: "MEDIUM", prompt: "Which technique solves overlapping subproblems and stores their results?", options: ["Greedy choice", "Dynamic programming", "Linear search", "Hash collision"], correctIndex: 1, coinValue: 40 },
  { category: "Data Structures", difficulty: "HARD", prompt: "What is the amortized time complexity of appending to a dynamic array?", options: ["O(1)", "O(log n)", "O(n)", "O(n log n)"], correctIndex: 0, coinValue: 70 },
  { category: "Algorithms", difficulty: "HARD", prompt: "Dijkstra's shortest-path algorithm requires edge weights to be what?", options: ["All equal to one", "Non-negative", "Negative only", "Prime numbers"], correctIndex: 1, coinValue: 70 },
  { category: "DBMS", difficulty: "HARD", prompt: "Which ACID property makes committed data survive a system failure?", options: ["Atomicity", "Consistency", "Isolation", "Durability"], correctIndex: 3, coinValue: 70 },
  { category: "Operating Systems", difficulty: "HARD", prompt: "Which condition is NOT one of the four necessary Coffman deadlock conditions?", options: ["Mutual exclusion", "Circular wait", "Preemption allowed", "Hold and wait"], correctIndex: 2, coinValue: 70 },
  { category: "Networks", difficulty: "HARD", prompt: "A /26 IPv4 subnet provides how many usable host addresses?", options: ["30", "62", "64", "126"], correctIndex: 1, coinValue: 70 },
] as const;

export const codingQuestions: readonly CodingQuestion[] = [
  {
    id: 1,
    title: "Even or Odd",
    difficulty: "EASY",
    points: 200,
    statement: "Write a program to check whether a given integer is even or odd.",
    input: "A single integer N.",
    output: "Print Even if N is divisible by 2; otherwise print Odd.",
    sampleIn: "8",
    sampleOut: "Even",
    hints: ["Use the remainder operator with 2.", "A remainder of zero means the number is even.", "This rule also works for zero and negative integers."],
    tests: [["8", "Even"], ["7", "Odd"], ["0", "Even"], ["-4", "Even"], ["-3", "Odd"], ["1000001", "Odd"]],
  },
  {
    id: 2,
    title: "Find the Largest Number",
    difficulty: "EASY",
    points: 300,
    statement: "Given three integers, find and print the largest number.",
    input: "Three space-separated integers A, B and C.",
    output: "Print the largest of the three integers.",
    sampleIn: "15 42 27",
    sampleOut: "42",
    hints: ["Start by treating the first number as the largest.", "Compare the second and third numbers one at a time.", "Equal values do not need special handling."],
    tests: [["15 42 27", "42"], ["9 3 1", "9"], ["-8 -2 -15", "-2"], ["5 5 2", "5"], ["0 0 0", "0"], ["-1 0 -2", "0"]],
  },
  {
    id: 3,
    title: "Sum of Digits",
    difficulty: "EASY",
    points: 400,
    statement: "Given a positive integer, calculate the sum of all its digits.",
    input: "A single positive integer N.",
    output: "Print the sum of the digits of N.",
    sampleIn: "1234",
    sampleOut: "10",
    hints: ["Process one digit at a time.", "The last digit is N modulo 10.", "Remove the last digit using integer division by 10."],
    tests: [["1234", "10"], ["5", "5"], ["1000", "1"], ["99999", "45"], ["24680", "20"], ["1000000000", "1"]],
  },
  {
    id: 4,
    title: "Palindrome Number",
    difficulty: "MEDIUM",
    points: 600,
    statement: "Check whether a positive integer reads the same forward and backward.",
    input: "A single positive integer N.",
    output: "Print Palindrome if N reads the same in both directions; otherwise print Not Palindrome.",
    sampleIn: "1221",
    sampleOut: "Palindrome",
    hints: ["Keep the original number before changing it.", "Build the reversed number digit by digit.", "Compare the reversed number with the original."],
    tests: [["1221", "Palindrome"], ["1234", "Not Palindrome"], ["7", "Palindrome"], ["1001", "Palindrome"], ["12321", "Palindrome"], ["120", "Not Palindrome"]],
  },
  {
    id: 5,
    title: "Find the Missing Number",
    difficulty: "HARD",
    points: 800,
    statement: "You are given N - 1 distinct numbers from 1 to N. Exactly one number is missing. Find it.",
    input: "The first line contains N. The second line contains N - 1 distinct space-separated integers from 1 to N.",
    output: "Print the missing number.",
    sampleIn: "5\n1 2 4 5",
    sampleOut: "3",
    hints: ["The sum of the numbers from 1 to N is N × (N + 1) / 2.", "Subtract the sum of the supplied numbers from the expected sum.", "The input order does not matter."],
    tests: [["5\n1 2 4 5", "3"], ["2\n2", "1"], ["6\n1 2 3 4 5", "6"], ["7\n7 2 1 6 4 3", "5"], ["10\n10 9 8 7 6 5 3 2 1", "4"], ["4\n2 4 1", "3"]],
  },
] as const;

export function validateQuestionBank() {
  if (quizQuestions.length !== 40)
    throw new Error(`Round 1 must contain exactly 40 questions; found ${quizQuestions.length}`);
  if (codingQuestions.length !== 5)
    throw new Error(`Round 2 must contain exactly 5 questions; found ${codingQuestions.length}`);

  const normalizedPrompts = quizQuestions.map((question) =>
    question.prompt.trim().toLocaleLowerCase("en-US"),
  );
  if (new Set(normalizedPrompts).size !== normalizedPrompts.length)
    throw new Error("Round 1 contains duplicate question prompts");

  for (const question of quizQuestions) {
    if (question.options.length !== 4)
      throw new Error(`Quiz question must have four options: ${question.prompt}`);
    const normalizedOptions = question.options.map((option) =>
      option.trim().toLocaleLowerCase("en-US"),
    );
    if (new Set(normalizedOptions).size !== normalizedOptions.length)
      throw new Error(`Quiz question contains duplicate options: ${question.prompt}`);
    if (question.correctIndex < 0 || question.correctIndex >= question.options.length)
      throw new Error(`Quiz answer index is invalid: ${question.prompt}`);
    const expectedCoinValue =
      question.difficulty === "EASY"
        ? 20
        : question.difficulty === "MEDIUM"
          ? 40
          : 70;
    if (question.coinValue !== expectedCoinValue)
      throw new Error(`Quiz coin value does not match difficulty: ${question.prompt}`);
  }

  const codingIds = codingQuestions.map((question) => question.id);
  if (new Set(codingIds).size !== codingIds.length)
    throw new Error("Round 2 contains duplicate question IDs");
  for (const [index, question] of codingQuestions.entries()) {
    if (question.id !== index + 1)
      throw new Error("Round 2 question IDs must be sequential from 1 to 5");
    if (index > 0 && question.points <= codingQuestions[index - 1].points)
      throw new Error("Round 2 points must increase with difficulty");
    if (question.tests.length < 5)
      throw new Error(`Coding question needs at least five tests: ${question.title}`);
    if (new Set(question.tests.map(([input]) => input)).size !== question.tests.length)
      throw new Error(`Coding question contains duplicate test inputs: ${question.title}`);
    if (!question.sampleIn || !question.sampleOut)
      throw new Error(`Coding question needs a sample: ${question.title}`);
  }
}
