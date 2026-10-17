import { describe, expect, it } from "vitest";
import { cleanQuestionText, groupQuestions, isNearIdentical, normalizeQuestionText, rankGroups, type SourceQuestion } from "@/lib/question-grouping";

let nextId = 0;
const question = (fileId: string, text: string, extra: Partial<SourceQuestion> = {}): SourceQuestion =>
  ({ id: `q-${String(++nextId).padStart(3, "0")}`, fileId, number: nextId, text, year: null, ...extra });
const texts = (groups: { questions: SourceQuestion[] }[]) => groups.map(group => group.questions.map(item => item.text));

describe("normalizeQuestionText", () => {
  it.each([
    ["Explain the TCP three-way handshake.", "explain the tcp three-way handshake"],
    ["  EXPLAIN   the TCP\nthree-way handshake ", "explain the tcp three-way handshake"],
    ["Explain, the TCP three-way handshake!", "explain the tcp three-way handshake"],
    ["“Explain” the (TCP) three-way handshake?", "explain the tcp three-way handshake"],
  ])("ignores case, spacing, and punctuation in %j", (text, key) => expect(normalizeQuestionText(text)).toBe(key));
  it.each(["Q3. Define a socket.", "Question 3) Define a socket.", "3. Define a socket.", "3) Define a socket.", "(3) Define a socket.", "q12 Define a socket"])(
    "removes the question number in %j", text => expect(normalizeQuestionText(text)).toBe("define a socket"));
  it.each(["Define a socket. (10 points)", "Define a socket [5 marks]", "Define a socket (2.5 pts)"])(
    "removes marks in %j", text => expect(normalizeQuestionText(text)).toBe("define a socket"));
  it("keeps math symbols but ignores spacing around them", () => {
    expect(normalizeQuestionText("Compute x + y = 2")).toBe(normalizeQuestionText("compute x+y=2"));
    expect(normalizeQuestionText("Compute a + b")).not.toBe(normalizeQuestionText("Compute a - b"));
    expect(normalizeQuestionText("Find x^2")).not.toBe(normalizeQuestionText("Find x^3"));
  });
  it("keeps a number that starts the question itself", () => expect(normalizeQuestionText("2 + 2 = ?")).toBe("2+2="));
  it("shows the text without the number or marks but with its own case and punctuation", () => {
    expect(cleanQuestionText("Q1.  Explain the TCP handshake. (10 points)")).toBe("Explain the TCP handshake.");
  });
});

describe("isNearIdentical", () => {
  const near = (a: string, b: string) => isNearIdentical(normalizeQuestionText(a), normalizeQuestionText(b));
  it("accepts a one-letter typo or swap in a long word", () => {
    expect(near("How does a router recieve a packet?", "How does a router receive a packet?")).toBe(true);
    expect(near("Normalise the relation to 3NF.", "Normalize the relation to 3NF.")).toBe(true);
  });
  it("rejects different acronyms, numbers, and short words", () => {
    expect(near("Explain the TCP handshake.", "Explain the UDP handshake.")).toBe(false);
    expect(near("Find the derivative of x^2 at x = 3.", "Find the derivative of x^2 at x = 4.")).toBe(false);
    expect(near("Is the graph cyclic?", "Is the tree cyclic?")).toBe(false);
  });
  it("rejects real words one letter apart that start differently or are short", () => {
    expect(near("Describe the cable layer.", "Describe the table layer.")).toBe(false);
    expect(near("Show that the directed graph is cyclic.", "Show that the directed graph is acyclic.")).toBe(false);
    expect(near("Pop the stack.", "Pop the stuck.")).toBe(false);
  });
  it("rejects a different word even if it is close in spelling", () => {
    expect(near("Describe the insertion sort algorithm.", "Describe the selection sort algorithm.")).toBe(false);
  });
  it("rejects an extra or missing word", () => {
    expect(near("Explain the TCP handshake.", "Explain the full TCP handshake.")).toBe(false);
  });
  it("allows one typo per eight words and no more", () => {
    expect(near("Briefly explain how routers forward packets", "Brefly explain how ruoters forward packets")).toBe(false);
    const long = "Briefly explain how routers forward packets between networks using their routing tables and the longest prefix match rule";
    expect(near(long, long.replace("Briefly", "Brefly").replace("routers", "ruoters"))).toBe(true);
  });
});

describe("groupQuestions (US-15a)", () => {
  it("groups the same question from two papers that differ only in spacing, punctuation, or capitalisation", () => {
    const groups = groupQuestions([
      question("paper-a", "Explain the TCP three-way handshake."),
      question("paper-b", "explain   the tcp three-way handshake"),
      question("paper-c", "Q4) EXPLAIN THE TCP THREE-WAY HANDSHAKE?"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].questions.map(item => item.fileId)).toEqual(["paper-a", "paper-b", "paper-c"]);
  });
  it("keeps genuinely different questions in separate groups", () => {
    const groups = groupQuestions([
      question("paper-a", "Explain the TCP three-way handshake."),
      question("paper-b", "Explain the UDP header format."),
      question("paper-b", "Compute a + b"),
      question("paper-c", "Compute a - b"),
    ]);
    expect(groups).toHaveLength(4);
  });
  it("lists every source question and the paper each came from", () => {
    const sources = [question("paper-b", "Define a socket."), question("paper-a", "Define a socket"), question("paper-a", "Define a port.")];
    const groups = groupQuestions(sources);
    const socket = groups.find(group => group.normalizedText === "define a socket")!;
    expect(socket.questions.map(item => [item.id, item.fileId])).toEqual([[sources[1].id, "paper-a"], [sources[0].id, "paper-b"]]);
  });
  it("groups near-identical typos with the first version", () => {
    const groups = groupQuestions([question("paper-a", "How does a router receive a packet?"), question("paper-b", "How does a router recieve a packet?")]);
    expect(texts(groups)).toEqual([["How does a router receive a packet?", "How does a router recieve a packet?"]]);
    expect(groups[0].text).toBe("How does a router receive a packet?");
  });
  it("compares with each group's first question only, so typos cannot chain two different words together", () => {
    const groups = groupQuestions([
      question("paper-a", "Describe the protocol stack"),
      question("paper-b", "Describe the protocal stack"),
      question("paper-c", "Describe the protecal stack"),
    ]);
    expect(groups.map(group => group.questions.length)).toEqual([2, 1]);
  });
  it("skips a question with no text left after cleaning", () => {
    expect(groupQuestions([question("paper-a", "Q1."), question("paper-a", "  "), question("paper-a", "(10 points)")])).toEqual([]);
  });
  it("gives the same groups whatever order the questions come in", () => {
    const sources = [
      question("paper-b", "Define a socket"), question("paper-a", "Define a socket."), question("paper-c", "Explain ARP."),
      question("paper-a", "Explain arp"), question("paper-b", "What is a subnet mask?"),
    ];
    expect(groupQuestions([...sources].reverse())).toEqual(groupQuestions(sources));
  });
});

describe("rankGroups (US-16)", () => {
  const sources = [
    question("paper-2023", "Define a socket.", { year: 2023 }),
    question("paper-2024", "Explain ARP.", { year: 2024 }),
    question("paper-2024", "Define a socket", { year: 2024 }),
    question("paper-2025", "Define a socket?", { year: 2025 }),
    question("paper-2025", "Explain ARP", { year: 2025 }),
    question("paper-2025", "What is a subnet mask?", { year: 2025 }),
    question("paper-2022", "What is NAT?", { year: 2022 }),
  ];

  it("puts groups that appeared in more papers first and numbers the ranks from 1", () => {
    const ranked = rankGroups(groupQuestions(sources));
    expect(ranked.map(group => [group.text, group.paperCount, group.rank])).toEqual([
      ["Define a socket.", 3, 1], ["Explain ARP.", 2, 2], ["What is a subnet mask?", 1, 3], ["What is NAT?", 1, 4],
    ]);
  });
  it("counts a question repeated inside the same paper once", () => {
    const ranked = rankGroups(groupQuestions([
      question("paper-a", "Define a socket."), question("paper-a", "Define a socket"), question("paper-a", "DEFINE A SOCKET"),
      question("paper-a", "Explain ARP."), question("paper-b", "Explain ARP."),
    ]));
    expect(ranked.map(group => [group.text, group.paperCount, group.questions.length])).toEqual([["Explain ARP.", 2, 2], ["Define a socket.", 1, 3]]);
  });
  it("reflects a newly processed paper when ranking runs again", () => {
    const before = rankGroups(groupQuestions(sources));
    expect(before.find(group => group.text === "What is NAT?")?.rank).toBe(4);
    const after = rankGroups(groupQuestions([
      ...sources, question("paper-2026a", "What is NAT", { year: 2026 }), question("paper-2026b", "what is nat?", { year: 2026 }),
      question("paper-2026c", "What is NAT?!", { year: 2026 }),
    ]));
    expect(after.map(group => group.text)).toEqual(["What is NAT?", "Define a socket.", "Explain ARP.", "What is a subnet mask?"]);
  });
  it("breaks ties by the most recent year, then by text, and papers without a year come last", () => {
    const ranked = rankGroups(groupQuestions([
      question("paper-x", "Beta question", { year: null }), question("paper-y", "Alpha question", { year: 2020 }),
      question("paper-z", "Gamma question", { year: 2020 }), question("paper-w", "Delta question", { year: 2024 }),
    ]));
    expect(ranked.map(group => group.text)).toEqual(["Delta question", "Alpha question", "Gamma question", "Beta question"]);
  });
  it("gives the identical order for the same input twice, in any input order", () => {
    const first = rankGroups(groupQuestions(sources));
    expect(rankGroups(groupQuestions(sources))).toEqual(first);
    expect(rankGroups(groupQuestions([...sources].reverse())).map(group => group.normalizedText)).toEqual(first.map(group => group.normalizedText));
  });
  it("returns nothing for a course without questions", () => expect(rankGroups(groupQuestions([]))).toEqual([]));
});
