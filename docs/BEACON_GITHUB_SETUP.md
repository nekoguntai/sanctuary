# Moving Beacon to Its Own GitHub Repository

This document outlines strategies for structuring Beacon as a separate GitHub project while maintaining seamless integration with Sanctuary.

## Repository Structure Options

### Option 1: Separate Repository (Recommended)

```
github.com/n-narusegawa/
├── sanctuary/          # Main Sanctuary repo (existing)
└── beacon/             # New Lightning service repo
```

**Pros:**
- Clear separation of concerns
- Independent versioning and releases
- Separate issue tracking
- Different teams can work independently
- Easier for external contributors to understand scope

**Cons:**
- Need to coordinate breaking changes
- Shared types require publishing as package

---

### Option 2: Monorepo with Workspaces

```
github.com/n-narusegawa/sanctuary/
├── packages/
│   ├── sanctuary-server/     # Current server/
│   ├── sanctuary-frontend/   # Current frontend
│   ├── beacon/               # Lightning service
│   └── shared/               # Shared types/utils
├── package.json              # Workspace root
└── turbo.json                # Build orchestration
```

**Pros:**
- Single source of truth
- Atomic changes across packages
- Shared tooling (eslint, prettier, etc.)
- Easy local development

**Cons:**
- Larger repo size
- More complex CI/CD
- Coupled release cycles (unless carefully managed)

---

## Recommended Approach: Separate Repo + Shared Package

### 1. Create Shared Types Package

Publish shared types that both projects use:

```
github.com/n-narusegawa/sanctuary-types/
├── src/
│   ├── lightning.ts      # Lightning/Beacon types
│   ├── bitcoin.ts        # Bitcoin types
│   └── index.ts
├── package.json
└── tsconfig.json
```

**package.json:**
```json
{
  "name": "@sanctuary/types",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
}
```

Both Sanctuary and Beacon depend on this:
```json
{
  "dependencies": {
    "@sanctuary/types": "^1.0.0"
  }
}
```

### 2. Create Beacon Repository

```bash
# From sanctuary directory
cd beacon

# Initialize as separate git repo
rm -rf .git  # If nested
git init
git remote add origin git@github.com:n-narusegawa/beacon.git

# Initial commit
git add .
git commit -m "Initial Beacon structure"
git push -u origin main
```

### 3. Integration via API Contract

The integration is already API-based, which makes separation clean:

**Sanctuary → Beacon:**
- REST API calls via `BeaconClient`
- API key authentication
- No shared database

**Contract versioning:**
```
# beacon/api/v1/openapi.yaml
openapi: 3.0.0
info:
  title: Beacon API
  version: 1.0.0
paths:
  /api/swaps:
    post:
      summary: Create submarine swap
      ...
```

---

## Repository Setup Steps

### Step 1: Create the Beacon Repository

```bash
# On GitHub, create: n-narusegawa/beacon

# Clone and set up
git clone git@github.com:n-narusegawa/beacon.git
cd beacon

# Copy files from sanctuary/beacon/
cp -r ~/sanctuary/beacon/* .

# Set up
npm install
npx prisma generate

# Commit
git add .
git commit -m "Initial Beacon implementation"
git push
```

### Step 2: Set Up GitHub Actions

**.github/workflows/ci.yml:**
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: beacon_test
        ports:
          - 5432:5432
      redis:
        image: redis:7
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci
      - run: npx prisma generate
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v5
        with:
          context: .
          push: false
          tags: beacon:latest
```

### Step 3: Set Up Releases

**.github/workflows/release.yml:**
```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build Docker image
        run: docker build -t beacon:${{ github.ref_name }} .

      - name: Push to GitHub Container Registry
        run: |
          echo ${{ secrets.GITHUB_TOKEN }} | docker login ghcr.io -u ${{ github.actor }} --password-stdin
          docker tag beacon:${{ github.ref_name }} ghcr.io/n-narusegawa/beacon:${{ github.ref_name }}
          docker push ghcr.io/n-narusegawa/beacon:${{ github.ref_name }}

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          generate_release_notes: true
```

### Step 4: Update Sanctuary to Reference Beacon

In Sanctuary, remove the `beacon/` directory and update docker-compose to pull from Beacon's registry:

**sanctuary/docker-compose.yml:**
```yaml
services:
  beacon:
    image: ghcr.io/n-narusegawa/beacon:latest
    # or for specific version:
    # image: ghcr.io/n-narusegawa/beacon:v1.0.0
    environment:
      - SANCTUARY_API_URL=http://backend:3000
      - SANCTUARY_API_KEY=${BEACON_API_KEY}
    depends_on:
      - backend
```

---

## Version Coordination

### Semantic Versioning

Both projects follow semver independently:

| Beacon | Sanctuary | Compatibility |
|--------|-----------|---------------|
| 1.x    | Any       | Full support  |
| 2.x    | 3.x+      | Breaking API change |

### API Versioning

Prefix API routes with version:

```
/api/v1/swaps
/api/v1/invoices
/api/v2/swaps  # When breaking changes needed
```

### Compatibility Matrix

Maintain a compatibility matrix in both READMEs:

```markdown
## Compatibility

| Beacon Version | Sanctuary Version | Notes |
|---------------|-------------------|-------|
| 1.0.x         | 0.8.0+           | Initial release |
| 1.1.x         | 0.8.0+           | Added reverse swaps |
| 2.0.x         | 0.9.0+           | Breaking: New auth model |
```

---

## Development Workflow

### Local Development with Both Projects

```bash
# Terminal 1: Run Sanctuary
cd ~/sanctuary
./start.sh

# Terminal 2: Run Beacon (linked to local Sanctuary)
cd ~/beacon
SANCTUARY_API_URL=http://localhost:3000 npm run dev
```

### Testing Integration

Create integration tests that span both:

```typescript
// beacon/tests/integration/sanctuary.test.ts
describe('Sanctuary Integration', () => {
  it('should authenticate with Sanctuary API', async () => {
    const response = await beaconClient.validateSanctuaryUser(userId);
    expect(response.valid).toBe(true);
  });
});
```

### Git Submodules (Alternative)

If you want to keep beacon in sanctuary for convenience:

```bash
cd sanctuary
git submodule add git@github.com:n-narusegawa/beacon.git beacon
git commit -m "Add beacon as submodule"
```

Then updates are:
```bash
cd beacon
git pull origin main
cd ..
git add beacon
git commit -m "Update beacon submodule"
```

---

## Recommended Next Steps

1. **Keep beacon/ in sanctuary for now** - Continue development until Phase 1 is stable
2. **Extract when ready** - Move to separate repo when:
   - API is stable
   - Phase 1 (swaps) is working in production
   - You want independent release cycles
3. **Publish shared types** - Create `@sanctuary/types` package when needed
4. **Set up CI/CD** - Before first production release

---

## Quick Reference: Moving Files

When ready to extract:

```bash
# Create new repo
mkdir -p ~/beacon-repo
cd ~/beacon-repo
git init

# Copy files (preserving no git history - clean start)
cp -r ~/sanctuary/beacon/* .

# Or to preserve history (complex):
cd ~/sanctuary
git subtree split -P beacon -b beacon-branch
cd ~/beacon-repo
git pull ~/sanctuary beacon-branch
```
