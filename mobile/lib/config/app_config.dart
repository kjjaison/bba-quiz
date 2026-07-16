/// Quiz web app URL — your deployed Google Apps Script Web App URL.
///
/// Set at build time:
///   flutter run --dart-define=QUIZ_URL=https://script.google.com/macros/s/YOUR_ID/exec
///
/// Or change [defaultUrl] below after deployment.
class AppConfig {
  static const String appVersion = '2026-07-16.5';

  static const String defaultUrl =
      'https://script.google.com/macros/s/AKfycbxvC5P2T5SZTNfqBp4_ge_l2rOy7EIcDTs4goxAi6xzjjlelPLLiZbOqVu2wedhB3LP7Q/exec';

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
