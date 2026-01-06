#!/bin/bash
#
# Bump version across all package.json files
# Usage: ./scripts/bump-version.sh 0.7.19
#

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <new-version>"
  echo "Example: $0 0.7.19"
  exit 1
fi

NEW_VERSION="$1"

# Validate version format (semver-like)
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must be in format X.Y.Z (e.g., 0.7.19)"
  exit 1
fi

echo "Bumping version to $NEW_VERSION..."

# Root package.json
echo "  Updating package.json..."
sed -i "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$NEW_VERSION\"/" package.json

# Server package.json
echo "  Updating server/package.json..."
sed -i "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$NEW_VERSION\"/" server/package.json

# Umbrel app manifest
echo "  Updating sanctuary/umbrel-app.yml..."
sed -i "s/^version: \"[0-9]*\.[0-9]*\.[0-9]*\"/version: \"$NEW_VERSION\"/" sanctuary/umbrel-app.yml

# Update release notes date in umbrel-app.yml
TODAY=$(date +%Y-%m-%d)
sed -i "s/releaseNotes: \"Version [0-9]*\.[0-9]*\.[0-9]* released on [0-9-]*/releaseNotes: \"Version $NEW_VERSION released on $TODAY/" sanctuary/umbrel-app.yml

echo ""
echo "Version updated to $NEW_VERSION in:"
echo "  - package.json"
echo "  - server/package.json"
echo "  - sanctuary/umbrel-app.yml"
echo ""
echo "NOTE: sanctuary/docker-compose.yml image tags need to be updated"
echo "      manually after building and pushing new images with:"
echo "      ghcr.io/n-narusegawa/sanctuary-frontend:v$NEW_VERSION"
echo "      ghcr.io/n-narusegawa/sanctuary-backend:v$NEW_VERSION"
echo ""
echo "Run 'git diff' to review changes before committing."
