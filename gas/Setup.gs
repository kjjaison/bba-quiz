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

  var today = todayDate_();
  var scheduleSheet = getSheet_(CONFIG.SHEETS.SCHEDULE);
  if (scheduleSheet.getLastRow() <= 1) {
    scheduleSheet.appendRow([today, 'John', 'Chapter 3', 'quiz-001']);
    scheduleSheet.appendRow(['2026-07-08', 'Psalm', '23', 'quiz-002']);
    scheduleSheet.appendRow(['2026-07-09', 'Romans', 'Chapter 8', 'quiz-003']);
  }

  var questionsSheet = getSheet_(CONFIG.SHEETS.QUESTIONS);
  if (questionsSheet.getLastRow() <= 1) {
    var sampleQuestions = [
      ['quiz-001', 1, 'Who came to Jesus at night in John 3?', 'Chapter 3', 'Nicodemus', 'Peter', 'Judas', 'Thomas', 'option_a'],
      ['quiz-001', 2, 'Jesus told Nicodemus that one must be born again of what?', 'Chapter 3', 'Water and Spirit', 'Fire and water', 'Blood and water', 'Wind and fire', 'option_a'],
      ['quiz-001', 3, 'For God so loved the world that He gave His only begotten...', 'Chapter 3', 'Son', 'Prophet', 'Angel', 'Servant', 'option_a'],
      ['quiz-001', 4, 'Who must be lifted up, as Moses lifted up the serpent?', 'Chapter 3', 'The Son of Man', 'The Son of God', 'The King', 'The Prophet', 'option_a'],
      ['quiz-001', 5, 'God sent not His Son into the world to condemn the world, but that the world through Him might be...', 'Chapter 3', 'Saved', 'Judged', 'Blessed', 'Healed', 'option_a'],
      ['quiz-001', 6, 'He who believes in Him is not condemned; but he who does not believe is condemned already, because he has not believed in the name of the only begotten...', 'Chapter 3', 'Son of God', 'Son of Man', 'King of kings', 'Lamb of God', 'option_a'],
      ['quiz-001', 7, 'Jesus said, "You must be born again" to which ruler?', 'Chapter 3', 'Nicodemus', 'Pilate', 'Herod', 'Caiaphas', 'option_a'],
      ['quiz-002', 1, 'The Lord is my...', '23', 'Shepherd', 'King', 'Father', 'Rock', 'option_a'],
      ['quiz-002', 2, 'He makes me lie down in green...', '23', 'Pastures', 'Fields', 'Valleys', 'Meadows', 'option_a'],
      ['quiz-002', 3, 'He leads me beside still...', '23', 'Waters', 'Rivers', 'Seas', 'Springs', 'option_a'],
      ['quiz-002', 4, 'Though I walk through the valley of the shadow of death, I will fear no...', '23', 'Evil', 'Man', 'Enemy', 'Darkness', 'option_a'],
      ['quiz-002', 5, 'Surely goodness and mercy shall follow me all the days of my...', '23', 'Life', 'Youth', 'Journey', 'Days', 'option_a'],
      ['quiz-003', 1, 'There is therefore now no condemnation to those who are in Christ...', 'Chapter 8', 'Jesus', 'God', 'Spirit', 'Lord', 'option_a'],
      ['quiz-003', 2, 'The law of the Spirit of life in Christ Jesus has made me free from the law of...', 'Chapter 8', 'Sin and death', 'Moses', 'Works', 'Flesh', 'option_a'],
      ['quiz-003', 3, 'If Christ is in you, the body is dead because of sin, but the Spirit is life because of...', 'Chapter 8', 'Righteousness', 'Faith', 'Grace', 'Love', 'option_a'],
      ['quiz-003', 4, 'For whom He foreknew, He also predestined to be conformed to the image of His...', 'Chapter 8', 'Son', 'Glory', 'Kingdom', 'Holiness', 'option_a'],
      ['quiz-003', 5, 'What shall we then say to these things? If God is for us, who can be...', 'Chapter 8', 'Against us', 'Greater', 'Stronger', 'Wiser', 'option_a'],
      ['quiz-003', 6, 'Who shall separate us from the love of...', 'Chapter 8', 'Christ', 'God', 'Spirit', 'Father', 'option_a'],
      ['quiz-003', 7, 'In all these things we are more than conquerors through Him who loved...', 'Chapter 8', 'Us', 'All', 'Many', 'Israel', 'option_a'],
      ['quiz-003', 8, 'Neither death nor life shall be able to separate us from the love of God which is in Christ Jesus our...', 'Chapter 8', 'Lord', 'Saviour', 'King', 'Hope', 'option_a']
    ];
    for (var i = 0; i < sampleQuestions.length; i++) {
      questionsSheet.appendRow(sampleQuestions[i]);
    }
  }

  showMessage_('Setup complete! Sheets created with sample quiz data. Check the tabs at the bottom of your spreadsheet.');
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
