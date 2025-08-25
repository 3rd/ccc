---
description: Create a git commit
model: sonnet | opus | opusplan
argument-hint: add [tagId] | remove [tagId] | list
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*)
---

## Template

Command arguments: `$ARGUMENTS`

- Execute shell command and inject output: !`git status`
