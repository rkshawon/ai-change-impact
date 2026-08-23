# Change Log

All notable changes to the "ai-change-impact" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.5]

- Added `Change Guard: Audit History` (`change-guard.auditHistory`) for chronological commit history audits and bug culprit detection.
- Added support for both proactive blind audits across commit ranges and targeted bug/symptom diagnosis.
- Added interactive history audit Webview panel with health status, culprit commit attribution, root-cause analysis, copyable code fixes, and commit sequence timeline.
- Added Git commit history inspection tools (`getRecentCommits`, `getCommitList`, `getCommitDiff`).
- Added full unit test suite for history audit and culprit parsing.

## [0.0.4]

- Added Google Gemini and OpenAI provider support with custom API key management.