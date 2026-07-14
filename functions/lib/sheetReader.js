const { google } = require("googleapis");
const { LANGUAGE_SHEETS } = require("./schema");

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

async function readSheetTab(spreadsheetId, tabName) {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A:I`,
  });
  return response.data.values || [];
}

async function readSchedule(spreadsheetId) {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "DailySchedule!A:D",
  });
  return response.data.values || [];
}

async function readAllSheetData(spreadsheetId) {
  const questionTabs = Object.keys(LANGUAGE_SHEETS);
  const result = {
    questions: {},
    schedule: [],
  };

  for (const tabName of questionTabs) {
    result.questions[tabName] = await readSheetTab(spreadsheetId, tabName);
  }

  result.schedule = await readSchedule(spreadsheetId);
  return result;
}

module.exports = {
  readAllSheetData,
};
