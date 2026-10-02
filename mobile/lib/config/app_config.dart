/// Quiz web app URL — your deployed Google Apps Script Web App URL.
///
/// Set at build time:
///   flutter run --dart-define=QUIZ_URL=https://script.google.com/macros/s/YOUR_ID/exec
///
/// Or change [defaultUrl] below after deployment.
class AppConfig {
  static const String appVersion = '2026-10-02.1';

  static const String defaultUrl =
      'https://script.google.com/macros/s/AKfycbz2i8zY8yeo2ze8RafADDRckHcS8Y5UFEODbWS2k9Odnhpk8QILHqrTH3lk2O4UPgIunA/exec';

  static const String quizUrl = String.fromEnvironment(
    'QUIZ_URL',
    defaultValue: defaultUrl,
  );

  /// Cache-busted URL so WebView loads the latest HTML (language selector, etc.).
  static String get versionedQuizUrl {
    final base = quizUrl;
    final separator = base.contains('?') ? '&' : '?';
    return '$base${separator}v=$appVersion';
  }

  static const String appTitle = 'BBA Dublin Bible Quiz';
}
