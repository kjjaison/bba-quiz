/**
 * Firestore document shapes for the BBA Quiz hybrid model.
 * Google Sheet = admin authoring; Firestore = runtime store for the app.
 */

const QCOL = {
  QUIZ_ID: 0,
  NUM: 1,
  TEXT: 2,
  CHAPTER: 3,
  OPTION_A: 4,
  OPTION_B: 5,
  OPTION_C: 6,
  OPTION_D: 7,
  CORRECT: 8,
};

const LANGUAGE_SHEETS = {
  Questions: "en",
  QuestionsMalayalam: "ml",
};

function normalizeCorrectAnswer(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return "";
  if (s === "option_a" || s === "a") return "A";
  if (s === "option_b" || s === "b") return "B";
  if (s === "option_c" || s === "c") return "C";
  if (s === "option_d" || s === "d") return "D";
  return String(value).trim().toUpperCase().charAt(0);
}

function parseBookReference(bookReference) {
  const ref = String(bookReference || "").trim();
  if (!ref) return { book: "", chapter: "" };

  if (/^Chapter\s+\d+$/i.test(ref)) {
    return { book: "", chapter: ref };
  }

  const fullMatch = ref.match(/^(.+?)\s+(Chapter\s+\d+|\d+)$/i);
  if (fullMatch) {
    return { book: fullMatch[1].trim(), chapter: fullMatch[2].trim() };
  }

  if (/^\d+$/.test(ref)) {
    return { book: "", chapter: ref };
  }

  return { book: "", chapter: ref };
}

function buildQuizTitle(book, scheduleChapter, bookReference) {
  bookReference = String(bookReference || "").trim();
  scheduleChapter = String(scheduleChapter || "").trim();
  book = String(book || "").trim();

  if (bookReference) {
    const fromRef = parseBookReference(bookReference);
    if (fromRef.book && fromRef.chapter) {
      return `${fromRef.book} ${fromRef.chapter}`;
    }
    if (
      fromRef.chapter &&
      !fromRef.book &&
      book &&
      /^(Chapter\s+\d+|\d+)$/i.test(fromRef.chapter)
    ) {
      return `${book} ${fromRef.chapter}`;
    }
  }

  if (book && scheduleChapter) {
    return `${book} ${scheduleChapter}`;
  }
  return bookReference || book || scheduleChapter || "";
}

function formatSheetDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().substring(0, 10);
  }
  return String(value || "").substring(0, 10);
}

function questionDocId(language, quizId, questionNum) {
  return `${language}_${quizId}_${questionNum}`;
}

function answerKeyDocId(language, quizId, questionNum) {
  return `${language}_${quizId}_${questionNum}`;
}

function rowToQuestionDocs(row, language, syncBatchId) {
  const quizId = String(row[QCOL.QUIZ_ID] || "").trim();
  const questionText = String(row[QCOL.TEXT] || "").trim();
  if (!quizId || !questionText) return null;

  const questionNum = Number(row[QCOL.NUM]);
  const bookReference = String(row[QCOL.CHAPTER] || "").trim();
  const correctAnswer = normalizeCorrectAnswer(row[QCOL.CORRECT]);
  const docId = questionDocId(language, quizId, questionNum);

  return {
    question: {
      id: docId,
      data: {
        quizId,
        language,
        questionNum,
        question: questionText,
        bookReference,
        options: {
          A: row[QCOL.OPTION_A],
          B: row[QCOL.OPTION_B],
          C: row[QCOL.OPTION_C],
          D: row[QCOL.OPTION_D],
        },
        syncBatchId,
      },
    },
    answerKey: correctAnswer
      ? {
          id: answerKeyDocId(language, quizId, questionNum),
          data: {
            quizId,
            language,
            questionNum,
            correctAnswer,
            syncBatchId,
          },
        }
      : null,
    quizId,
    bookReference,
  };
}

function rowToScheduleDoc(row, syncBatchId) {
  const date = formatSheetDate(row[0]);
  const book = String(row[1] || "").trim();
  const chapter = String(row[2] || "").trim();
  const quizId = String(row[3] || "").trim();
  if (!date || !quizId) return null;

  return {
    id: date,
    data: {
      date,
      quizId,
      book,
      chapter,
      title: buildQuizTitle(book, chapter, ""),
      syncBatchId,
    },
  };
}

module.exports = {
  QCOL,
  LANGUAGE_SHEETS,
  normalizeCorrectAnswer,
  parseBookReference,
  buildQuizTitle,
  formatSheetDate,
  questionDocId,
  answerKeyDocId,
  rowToQuestionDocs,
  rowToScheduleDoc,
};
