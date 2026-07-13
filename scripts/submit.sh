#!/usr/bin/env bash
set -euo pipefail

echo "COSI 152A Submission Script"

if [ ! -d .git ]; then
  echo "This directory is not a git repository."
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "Staging all changes..."
git add -A

if git diff --cached --quiet; then
  echo "No changes to commit."
else
  read -r -p "Enter your commit message [Assignment submission]: " commit_msg
  commit_msg=${commit_msg:-"Assignment submission"}
  git commit -m "$commit_msg"
fi

echo "Pulling latest changes..."
git pull --rebase origin "$BRANCH" || true

echo "Pushing to GitHub..."
git push origin "$BRANCH"

echo "Submission complete."
