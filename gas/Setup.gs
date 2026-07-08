/**
 * FIRST-TIME SETUP — open this file in Apps Script, then run setupSheets()
 *
 * Easiest: Google Sheet → BBA Quiz → Run initial setup
 * Or here: open Setup.gs → select setupSheets → Run ▶
 */

function setupSheets() {
  var ss = getSpreadsheet_();

  createSheetWithHeaders_(ss, CONFIG.SHEETS.USERS, [
    'email', 'password_hash', 'display_name', 'created_at',
    'session_token', 'session_expires', 'total_score',
    'total_quizzes', 'perfect_scores', 'current_streak'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEETS.OTP, [
    'email', 'otp', 'expires_at'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEETS.SCHEDULE, [
    'date', 'book', 'chapter', 'quiz_id'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEETS.QUESTIONS, [
    'quiz_id', 'question_num', 'question', 'book_reference',
    'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEETS.SUBMISSIONS, [
    'email', 'quiz_date', 'answers_json', 'score', 'total_questions',
    'submitted_at', 'locked'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEETS.SETTINGS, [
    'key', 'value'
  ]);

  var questionsSheet = getSheet_(CONFIG.SHEETS.QUESTIONS);
  if (questionsSheet.getLastRow() <= 1) {
    var sampleQuestions = [
      ['quiz-001', 1, 'Who came to Jesus at night in John 3?', 'John Chapter 3', 'Nicodemus', 'Peter', 'Judas', 'Thomas', 'option_a'],
      ['quiz-001', 2, 'Jesus told Nicodemus that one must be born again of what?', 'John Chapter 3', 'Water and Spirit', 'Fire and water', 'Blood and water', 'Wind and fire', 'option_a'],
      ['quiz-001', 3, 'For God so loved the world that He gave His only begotten...', 'John Chapter 3', 'Son', 'Prophet', 'Angel', 'Servant', 'option_a'],
      ['quiz-001', 4, 'Who must be lifted up, as Moses lifted up the serpent?', 'John Chapter 3', 'The Son of Man', 'The Son of God', 'The King', 'The Prophet', 'option_a'],
      ['quiz-001', 5, 'God sent not His Son into the world to condemn the world, but that the world through Him might be...', 'John Chapter 3', 'Saved', 'Judged', 'Blessed', 'Healed', 'option_a'],
      ['quiz-001', 6, 'He who believes in Him is not condemned; but he who does not believe is condemned already, because he has not believed in the name of the only begotten...', 'John Chapter 3', 'Son of God', 'Son of Man', 'King of kings', 'Lamb of God', 'option_a'],
      ['quiz-001', 7, 'Jesus said, "You must be born again" to which ruler?', 'John Chapter 3', 'Nicodemus', 'Pilate', 'Herod', 'Caiaphas', 'option_a'],
      ['quiz-002', 1, 'The Lord is my...', 'Psalm 23', 'Shepherd', 'King', 'Father', 'Rock', 'option_a'],
      ['quiz-002', 2, 'He makes me lie down in green...', 'Psalm 23', 'Pastures', 'Fields', 'Valleys', 'Meadows', 'option_a'],
      ['quiz-002', 3, 'He leads me beside still...', 'Psalm 23', 'Waters', 'Rivers', 'Seas', 'Springs', 'option_a'],
      ['quiz-002', 4, 'Though I walk through the valley of the shadow of death, I will fear no...', 'Psalm 23', 'Evil', 'Man', 'Enemy', 'Darkness', 'option_a'],
      ['quiz-002', 5, 'Surely goodness and mercy shall follow me all the days of my...', 'Psalm 23', 'Life', 'Youth', 'Journey', 'Days', 'option_a'],
      ['quiz-003', 1, 'There is therefore now no condemnation to those who are in Christ...', 'Romans Chapter 8', 'Jesus', 'God', 'Spirit', 'Lord', 'option_a'],
      ['quiz-003', 2, 'The law of the Spirit of life in Christ Jesus has made me free from the law of...', 'Romans Chapter 8', 'Sin and death', 'Moses', 'Works', 'Flesh', 'option_a'],
      ['quiz-003', 3, 'If Christ is in you, the body is dead because of sin, but the Spirit is life because of...', 'Romans Chapter 8', 'Righteousness', 'Faith', 'Grace', 'Love', 'option_a'],
      ['quiz-003', 4, 'For whom He foreknew, He also predestined to be conformed to the image of His...', 'Romans Chapter 8', 'Son', 'Glory', 'Kingdom', 'Holiness', 'option_a'],
      ['quiz-003', 5, 'What shall we then say to these things? If God is for us, who can be...', 'Romans Chapter 8', 'Against us', 'Greater', 'Stronger', 'Wiser', 'option_a'],
      ['quiz-003', 6, 'Who shall separate us from the love of...', 'Romans Chapter 8', 'Christ', 'God', 'Spirit', 'Father', 'option_a'],
      ['quiz-003', 7, 'In all these things we are more than conquerors through Him who loved...', 'Romans Chapter 8', 'Us', 'All', 'Many', 'Israel', 'option_a'],
      ['quiz-003', 8, 'Neither death nor life shall be able to separate us from the love of God which is in Christ Jesus our...', 'Romans Chapter 8', 'Lord', 'Saviour', 'King', 'Hope', 'option_a']
    ];
    for (var i = 0; i < sampleQuestions.length; i++) {
      questionsSheet.appendRow(sampleQuestions[i]);
    }
  }

  var scheduleCount = refreshDailyScheduleFromQuestions_();

  showMessage_(
    'Setup complete! Sheets created with sample quiz data.\n\n' +
    'DailySchedule refreshed from Questions (' + scheduleCount + ' days, starting ' +
    CONFIG.SCHEDULE_START_DATE + ').'
  );
}

/**
 * Rebuild DailySchedule from unique quiz_ids in Questions.
 * Book and chapter come from each quiz's book_reference (column D).
 * Dates start at CONFIG.SCHEDULE_START_DATE (one quiz per day).
 */
function refreshDailyScheduleFromQuestions() {
  var count = refreshDailyScheduleFromQuestions_();
  showMessage_(
    'DailySchedule refreshed from Questions.\n\n' +
    count + ' day(s) scheduled starting ' + CONFIG.SCHEDULE_START_DATE + '.'
  );
}

function refreshDailyScheduleFromQuestions_() {
  var startDate = CONFIG.SCHEDULE_START_DATE;
  var quizzes = collectQuizzesFromQuestions_();
  var scheduleSheet = getSheet_(CONFIG.SHEETS.SCHEDULE);
  var rows = [];

  for (var i = 0; i < quizzes.length; i++) {
    var parsed = parseBookReference_(quizzes[i].bookReference);
    rows.push([
      addDaysToDateStr_(startDate, i),
      parsed.book,
      parsed.chapter,
      quizzes[i].quizId
    ]);
  }

  var lastRow = scheduleSheet.getLastRow();
  if (lastRow > 1) {
    scheduleSheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  }
  if (rows.length > 0) {
    scheduleSheet.getRange(2, 1, rows.length, 4).setValues(rows);
  }

  return rows.length;
}

function collectQuizzesFromQuestions_() {
  var sheet = getSheet_(CONFIG.SHEETS.QUESTIONS);
  var data = sheet.getDataRange().getValues();
  var seen = {};
  var quizzes = [];

  for (var i = 1; i < data.length; i++) {
    var quizId = String(data[i][QCOL.QUIZ_ID] || '').trim();
    if (!quizId || seen[quizId]) continue;
    seen[quizId] = true;
    quizzes.push({
      quizId: quizId,
      bookReference: String(data[i][QCOL.CHAPTER] || '').trim()
    });
  }

  quizzes.sort(function(a, b) {
    return compareQuizIds_(a.quizId, b.quizId);
  });

  return quizzes;
}

function parseBookReference_(bookReference) {
  var ref = String(bookReference || '').trim();
  if (!ref) {
    return { book: '', chapter: '' };
  }

  if (/^Chapter\s+\d+$/i.test(ref)) {
    return { book: '', chapter: ref };
  }

  var fullMatch = ref.match(/^(.+?)\s+(Chapter\s+\d+|\d+)$/i);
  if (fullMatch) {
    return { book: fullMatch[1].trim(), chapter: fullMatch[2].trim() };
  }

  if (/^\d+$/.test(ref)) {
    return { book: '', chapter: ref };
  }

  return { book: '', chapter: ref };
}

function compareQuizIds_(a, b) {
  var numA = parseInt(String(a).replace(/\D/g, ''), 10) || 0;
  var numB = parseInt(String(b).replace(/\D/g, ''), 10) || 0;
  if (numA !== numB) return numA - numB;
  return String(a).localeCompare(String(b));
}

function addDaysToDateStr_(dateStr, days) {
  var date = new Date(dateStr + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function validateUpcomingQuizzes() {
  var scheduleSheet = getSheet_(CONFIG.SHEETS.SCHEDULE);
  var schedule = scheduleSheet.getDataRange().getValues();
  var minRequired = CONFIG.MIN_QUESTIONS_PER_QUIZ;
  var issues = [];
  var ok = [];

  for (var i = 1; i < schedule.length; i++) {
    var rowDate = schedule[i][0];
    if (!rowDate) continue;

    var dateStr = rowDate instanceof Date
      ? Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy-MM-dd')
      : String(rowDate).substring(0, 10);
    var book = schedule[i][1] || '';
    var chapter = schedule[i][2] || '';
    var quizId = schedule[i][3];
    if (!quizId) {
      issues.push(dateStr + ' — missing quiz_id');
      continue;
    }

    var count = countQuestionsForQuiz_(quizId);
    var label = book + ' ' + chapter + ' (' + quizId + ')';

    if (count < minRequired) {
      issues.push(dateStr + ' — ' + label + ': ' + count + '/' + minRequired + ' questions');
    } else {
      ok.push(dateStr + ' — ' + label + ': ' + count + ' questions');
    }
  }

  var message = 'Minimum required: ' + minRequired + ' questions per day.\n\n';
  if (ok.length > 0) {
    message += 'Ready (' + ok.length + '):\n' + ok.slice(0, 10).join('\n');
    if (ok.length > 10) message += '\n... and ' + (ok.length - 10) + ' more';
  }
  if (issues.length > 0) {
    message += '\n\nNeeds more questions (' + issues.length + '):\n' + issues.join('\n');
  }
  if (ok.length === 0 && issues.length === 0) {
    message += 'No rows found in DailySchedule.';
  }

  showMessage_('Quiz Validation\n\n' + message);
}

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('BBA Quiz')
      .addItem('Run initial setup', 'setupSheets')
      .addItem('Refresh schedule from Questions', 'refreshDailyScheduleFromQuestions')
      .addItem('Validate upcoming quizzes', 'validateUpcomingQuizzes')
      .addToUi();
  } catch (e) {
    Logger.log('onOpen menu skipped: ' + e.message);
  }
}

function createSheetWithHeaders_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}
