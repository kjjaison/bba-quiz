const admin = require("firebase-admin");
const {
  LANGUAGE_SHEETS,
  buildQuizTitle,
  parseBookReference,
  rowToQuestionDocs,
  rowToScheduleDoc,
} = require("./schema");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const BATCH_LIMIT = 450;

async function commitBatches(writes) {
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    writes.slice(i, i + BATCH_LIMIT).forEach(({ ref, data, merge }) => {
      if (merge) {
        batch.set(ref, data, { merge: true });
      } else {
        batch.set(ref, data);
      }
    });
    await batch.commit();
  }
}

async function deleteStaleDocs(collectionName, syncBatchId) {
  const snap = await db.collection(collectionName).get();
  const stale = snap.docs.filter((doc) => doc.data().syncBatchId !== syncBatchId);
  if (!stale.length) return 0;

  for (let i = 0; i < stale.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    stale.slice(i, i + BATCH_LIMIT).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  return stale.length;
}

function buildQuizMeta(quizMap) {
  const metaWrites = [];
  Object.keys(quizMap).forEach((quizId) => {
    const entry = quizMap[quizId];
    const parsed = parseBookReference(entry.bookReference);
    metaWrites.push({
      ref: db.collection("quizzes").doc(quizId),
      data: {
        quizId,
        bookReference: entry.bookReference,
        book: parsed.book,
        chapter: parsed.chapter,
        title: buildQuizTitle(parsed.book, parsed.chapter, entry.bookReference),
        questionCount: entry.questionCount,
        syncBatchId: entry.syncBatchId,
      },
      merge: true,
    });
  });
  return metaWrites;
}

async function syncSheetDataToFirestore(sheetData) {
  const syncBatchId = `sync_${Date.now()}`;
  const syncedAt = admin.firestore.FieldValue.serverTimestamp();
  const writes = [];
  const quizMap = {};

  Object.keys(sheetData.questions).forEach((tabName) => {
    const language = LANGUAGE_SHEETS[tabName];
    const rows = sheetData.questions[tabName] || [];

    for (let i = 1; i < rows.length; i++) {
      const parsed = rowToQuestionDocs(rows[i], language, syncBatchId);
      if (!parsed) continue;

      writes.push({
        ref: db.collection("questions").doc(parsed.question.id),
        data: { ...parsed.question.data, syncedAt },
        merge: true,
      });

      if (parsed.answerKey) {
        writes.push({
          ref: db.collection("answerKeys").doc(parsed.answerKey.id),
          data: { ...parsed.answerKey.data, syncedAt },
          merge: true,
        });
      }

      if (!quizMap[parsed.quizId]) {
        quizMap[parsed.quizId] = {
          bookReference: parsed.bookReference,
          questionCount: {},
          syncBatchId,
        };
      }
      quizMap[parsed.quizId].questionCount[language] =
        (quizMap[parsed.quizId].questionCount[language] || 0) + 1;
      if (!quizMap[parsed.quizId].bookReference && parsed.bookReference) {
        quizMap[parsed.quizId].bookReference = parsed.bookReference;
      }
    }
  });

  const scheduleRows = sheetData.schedule || [];
  for (let i = 1; i < scheduleRows.length; i++) {
    const scheduleDoc = rowToScheduleDoc(scheduleRows[i], syncBatchId);
    if (!scheduleDoc) continue;

    const quizMeta = quizMap[scheduleDoc.data.quizId];
    if (quizMeta && quizMeta.bookReference) {
      scheduleDoc.data.title = buildQuizTitle(
        scheduleDoc.data.book,
        scheduleDoc.data.chapter,
        quizMeta.bookReference
      );
    }

    writes.push({
      ref: db.collection("schedule").doc(scheduleDoc.id),
      data: { ...scheduleDoc.data, syncedAt },
      merge: true,
    });
  }

  writes.push(...buildQuizMeta(quizMap));
  writes.push({
    ref: db.collection("syncMeta").doc("latest"),
    data: {
      syncBatchId,
      syncedAt,
      source: "google-sheet",
      questionsEn: quizMap ? countQuestionsForLang(quizMap, "en") : 0,
      questionsMl: quizMap ? countQuestionsForLang(quizMap, "ml") : 0,
      scheduleDays: Math.max(0, scheduleRows.length - 1),
      quizCount: Object.keys(quizMap).length,
    },
    merge: true,
  });

  await commitBatches(writes);

  const removed = {
    questions: await deleteStaleDocs("questions", syncBatchId),
    answerKeys: await deleteStaleDocs("answerKeys", syncBatchId),
    schedule: await deleteStaleDocs("schedule", syncBatchId),
    quizzes: await deleteStaleDocs("quizzes", syncBatchId),
  };

  return {
    syncBatchId,
    written: writes.length,
    removed,
    quizCount: Object.keys(quizMap).length,
    scheduleDays: Math.max(0, scheduleRows.length - 1),
  };
}

function countQuestionsForLang(quizMap, language) {
  return Object.values(quizMap).reduce(
    (sum, quiz) => sum + (quiz.questionCount[language] || 0),
    0
  );
}

module.exports = {
  syncSheetDataToFirestore,
  db,
};
