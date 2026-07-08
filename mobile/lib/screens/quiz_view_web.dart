import 'dart:ui_web' as ui_web;

import 'package:flutter/material.dart';
import 'package:web/web.dart' as web;

/// Flutter Web: embeds the same Apps Script URL in a full-page iframe.
class QuizView extends StatefulWidget {
  const QuizView({super.key, required this.url});

  final String url;

  @override
  State<QuizView> createState() => _QuizViewState();
}

class _QuizViewState extends State<QuizView> {
  static const _viewType = 'bba-quiz-iframe';
  var _registered = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.url.contains('YOUR_DEPLOYMENT_ID')) {
      _error = 'Set your Apps Script URL in lib/config/app_config.dart '
          'or pass --dart-define=QUIZ_URL=... when running.';
      return;
    }
    _registerIframe();
  }

  void _registerIframe() {
    if (_registered) return;
    ui_web.platformViewRegistry.registerViewFactory(
      _viewType,
      (int viewId) {
        final iframe = web.HTMLIFrameElement()
          ..src = widget.url
          ..style.border = 'none'
          ..style.width = '100%'
          ..style.height = '100%'
          ..allow = 'clipboard-read; clipboard-write';
        return iframe;
      },
    );
    _registered = true;
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _error!,
            textAlign: TextAlign.center,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
      );
    }

    return const HtmlElementView(viewType: _viewType);
  }
}
