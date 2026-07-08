import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'config/app_config.dart';
import 'screens/quiz_view.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const BbaQuizApp());
}

class BbaQuizApp extends StatelessWidget {
  const BbaQuizApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConfig.appTitle,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1A365D),
          primary: const Color(0xFF2B6CB0),
        ),
        useMaterial3: true,
      ),
      home: const QuizScreen(),
    );
  }
}

class QuizScreen extends StatelessWidget {
  const QuizScreen({super.key});

  Future<void> _openInBrowser() async {
    final uri = Uri.parse(AppConfig.quizUrl);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            ClipOval(
              child: Image.asset(
                'assets/icon/app_icon.jpg',
                width: 32,
                height: 32,
                fit: BoxFit.cover,
              ),
            ),
            const SizedBox(width: 10),
            const Expanded(
              child: Text(
                AppConfig.appTitle,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        backgroundColor: const Color(0xFF1A365D),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            tooltip: 'Open in browser',
            onPressed: _openInBrowser,
            icon: const Icon(Icons.open_in_browser),
          ),
        ],
      ),
      body: SafeArea(
        child: QuizView(url: AppConfig.quizUrl),
      ),
    );
  }
}
