# Install & Setup Scripts Improvement Plan

**Created**: 2026-01-05
**Status**: Complete (10/10 items completed)
**Priority**: Medium

---

## Overview

Evaluation of `install.sh`, `scripts/setup.sh`, `start.sh`, and related installation scripts to identify gaps and improvements.

## Current State

The scripts are **well-designed overall** with:
- Robust prerequisite checking (Docker, Git, OpenSSL)
- Fallback mechanisms for secret generation
- Interactive optional features (monitoring, Tor)
- CI/CD integration with comprehensive test suite
- Legacy migration handling for upgrades

---

## Findings & Recommendations

### 1. Missing Pre-flight Checks

| Issue | Location | Risk | Priority |
|-------|----------|------|----------|
| No disk space check | `install.sh:164` | Docker images need ~4-6GB | Medium |
| No memory check | `install.sh:164` | Docker compose requires ~4GB RAM minimum | Medium |
| Only checks HTTPS_PORT | `install.sh:305-309` | HTTP_PORT, GATEWAY_PORT conflicts unchecked | Low |
| No architecture detection | `install.sh` | ARM64/Apple Silicon users may hit issues | Low |

**Implementation**:
```bash
# Disk space (before build)
check_disk_space() {
    local required_kb=6291456  # 6GB
    local install_dir="${1:-$HOME}"

    if command -v df &> /dev/null; then
        local available_kb=$(df -k "$install_dir" 2>/dev/null | tail -1 | awk '{print $4}')
        if [ -n "$available_kb" ] && [ "$available_kb" -lt "$required_kb" ]; then
            echo -e "${YELLOW}Warning: Less than 6GB disk space available.${NC}"
            echo "  Docker images and build cache require significant space."
            echo "  Available: $((available_kb / 1024))MB"
            echo ""
        fi
    fi
}

# Memory check
check_memory() {
    local required_kb=4194304  # 4GB

    if [ -f /proc/meminfo ]; then
        local total_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
        if [ -n "$total_kb" ] && [ "$total_kb" -lt "$required_kb" ]; then
            echo -e "${YELLOW}Warning: Less than 4GB RAM detected.${NC}"
            echo "  Sanctuary containers require approximately 4GB RAM."
            echo "  Available: $((total_kb / 1024))MB"
            echo ""
        fi
    fi
}
```

---

### 2. Upgrade Safety Concerns

| Issue | Location | Risk | Priority |
|-------|----------|------|----------|
| No database backup before migration | `server/scripts/migrate.sh` | Data loss on failed upgrade | High |
| No version comparison display | `install.sh:182-187` | User unaware of upgrade details | Medium |
| No rollback mechanism | - | Failed upgrade leaves system broken | Low |

**Implementation** - Add to `install.sh` for upgrades:
```bash
# In the "directory already exists" block
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Directory $INSTALL_DIR already exists.${NC}"

    # Show version info
    CURRENT_VERSION=$(git -C "$INSTALL_DIR" describe --tags 2>/dev/null || echo "unknown")
    echo "  Current version: $CURRENT_VERSION"
    if [ -n "$RELEASE_TAG" ]; then
        echo "  Upgrading to: $RELEASE_TAG"
    fi
    echo ""

    # Check if containers are running with data
    if docker compose -f "$INSTALL_DIR/docker-compose.yml" ps postgres 2>/dev/null | grep -q "running"; then
        echo -e "${YELLOW}Database container is running with existing data.${NC}"
        echo ""
        echo "Before upgrading, consider backing up your database:"
        echo "  docker exec -t \$(docker compose ps -q postgres) pg_dump -U sanctuary sanctuary > backup-\$(date +%Y%m%d).sql"
        echo ""
        read -p "Continue with upgrade? [y/N] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Upgrade cancelled."
            exit 0
        fi
    fi

    echo "Updating existing installation..."
    # ... rest of upgrade logic
fi
```

---

### 3. Health Check Timing

| Issue | Location | Impact | Priority |
|-------|----------|--------|----------|
| Only 5 second wait | `install.sh:400` | Premature "success" on slow systems | High |

The install script waits only 5 seconds before checking if services are running. On slower systems or first builds, containers may still be starting.

**Implementation** - Replace the simple `sleep 5` with proper polling:
```bash
# Wait for services to be healthy (with timeout)
echo ""
echo "Waiting for services to start..."

MAX_WAIT=120
WAITED=0
INTERVAL=5

while [ $WAITED -lt $MAX_WAIT ]; do
    # Check if frontend is healthy (last service to start)
    if docker compose ps frontend --format '{{.Status}}' 2>/dev/null | grep -q "healthy"; then
        FRONTEND_RUNNING=true
        break
    fi

    # Check for failures
    if docker compose ps --format '{{.Service}} {{.Status}}' 2>/dev/null | grep -q "Exit"; then
        echo -e "${RED}Some containers failed to start. Check logs with: docker compose logs${NC}"
        break
    fi

    sleep $INTERVAL
    WAITED=$((WAITED + INTERVAL))
    echo "  Waiting... ($WAITED/$MAX_WAIT seconds)"
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${YELLOW}Timeout waiting for services. They may still be starting.${NC}"
    echo "  Check status with: docker compose ps"
    echo "  View logs with: docker compose logs -f"
fi
```

---

### 4. WSL-Specific Guidance

| Issue | Impact | Priority |
|-------|--------|----------|
| No Docker Desktop check | Users may try to use Docker Engine in WSL without Docker Desktop | Low |
| No port forwarding note | localhost access works but LAN access needs Windows firewall | Low |

**Implementation**:
```bash
check_wsl() {
    if uname -r 2>/dev/null | grep -qi "wsl\|microsoft"; then
        echo -e "${BLUE}WSL detected.${NC}"
        echo "  Ensure Docker Desktop for Windows is running with WSL 2 backend enabled."
        echo "  For LAN access, configure Windows Firewall to allow ports $HTTP_PORT and $HTTPS_PORT."
        echo ""
    fi
}
```

---

### 5. SSL Certificate Management

| Issue | Location | Impact | Priority |
|-------|----------|--------|----------|
| 365-day expiry, no renewal reminder | `generate-certs.sh:10` | Silent HTTPS failure after 1 year | Medium |
| No mkcert recommendation for dev | `generate-certs.sh:26` | Users fight browser warnings | Low |

**Implementation** - Add to `start.sh`:
```bash
# Check SSL certificate expiry
check_ssl_expiry() {
    local cert_file="$SCRIPT_DIR/docker/nginx/ssl/fullchain.pem"

    if [ -f "$cert_file" ] && command -v openssl &> /dev/null; then
        local expiry_date=$(openssl x509 -enddate -noout -in "$cert_file" 2>/dev/null | cut -d= -f2)
        local expiry_epoch=$(date -d "$expiry_date" +%s 2>/dev/null || echo "0")
        local now_epoch=$(date +%s)
        local days_left=$(( (expiry_epoch - now_epoch) / 86400 ))

        if [ "$days_left" -lt 30 ] && [ "$days_left" -gt 0 ]; then
            echo -e "${YELLOW}Warning: SSL certificate expires in $days_left days.${NC}"
            echo "  Regenerate with: cd docker/nginx/ssl && ./generate-certs.sh localhost"
            echo ""
        elif [ "$days_left" -le 0 ]; then
            echo -e "${RED}Warning: SSL certificate has expired!${NC}"
            echo "  Regenerate with: cd docker/nginx/ssl && ./generate-certs.sh localhost"
            echo ""
        fi
    fi
}
```

---

### 6. Missing Uninstall Script

There's no `uninstall.sh` to cleanly remove the installation.

**Implementation** - Create `uninstall.sh`:
```bash
#!/bin/bash
# ============================================
# Sanctuary Bitcoin Wallet - Uninstall Script
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo ""
echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║              SANCTUARY UNINSTALL                          ║${NC}"
echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}This will permanently delete:${NC}"
echo "  - All Docker containers"
echo "  - All Docker volumes (database, Redis, Ollama models)"
echo "  - All locally built images"
echo "  - Your .env file with secrets"
echo ""
echo -e "${RED}YOUR WALLET DATA WILL BE LOST!${NC}"
echo ""

read -p "Type 'DELETE' to confirm uninstallation: " confirm
echo ""

if [ "$confirm" != "DELETE" ]; then
    echo "Uninstall cancelled."
    exit 0
fi

echo "Stopping and removing containers..."
docker compose down -v --remove-orphans 2>/dev/null || true
docker compose -f docker-compose.monitoring.yml down -v 2>/dev/null || true
docker compose -f docker-compose.tor.yml down -v 2>/dev/null || true

echo "Removing locally built images..."
docker rmi sanctuary-backend:local sanctuary-frontend:local sanctuary-gateway:local sanctuary-ai:local 2>/dev/null || true

echo "Removing .env file..."
rm -f .env .env.local 2>/dev/null || true

echo "Removing SSL certificates..."
rm -f docker/nginx/ssl/fullchain.pem docker/nginx/ssl/privkey.pem 2>/dev/null || true

echo ""
echo -e "${GREEN}Uninstall complete.${NC}"
echo ""
echo "To fully remove Sanctuary, delete this directory:"
echo "  rm -rf $SCRIPT_DIR"
echo ""
```

---

### 7. Port Conflict Checking

| Current | Missing |
|---------|---------|
| HTTPS_PORT (8443) | HTTP_PORT (8080), GATEWAY_PORT (4000), Grafana (3000) |

**Implementation**:
```bash
check_port_conflicts() {
    local ports_to_check="$HTTPS_PORT $HTTP_PORT ${GATEWAY_PORT:-4000}"

    if command -v ss &> /dev/null; then
        for port in $ports_to_check; do
            if ss -tuln | grep -q ":${port} "; then
                echo -e "${YELLOW}Warning: Port ${port} is already in use.${NC}"
            fi
        done
    elif command -v netstat &> /dev/null; then
        for port in $ports_to_check; do
            if netstat -tuln | grep -q ":${port} "; then
                echo -e "${YELLOW}Warning: Port ${port} is already in use.${NC}"
            fi
        done
    fi
}
```

---

### 8. `setup.sh` vs `install.sh` Secret Generation Alignment

| Script | Secret Length | Fallback |
|--------|---------------|----------|
| `install.sh:149-159` | 48 chars | /dev/urandom, sha256sum |
| `scripts/setup.sh:42-48` | 32 chars | No fallback, requires openssl |

**Recommendation**: Update `scripts/setup.sh` to use the same `generate_secret` function as `install.sh` for consistency.

---

### 9. Test Coverage Gaps

| Missing Test | Impact | Priority |
|--------------|--------|----------|
| Upgrade with data migration | Data loss scenarios untested | Medium |
| ARM64 build verification | Apple Silicon users may hit issues | Low |
| Low disk space behavior | Install may fail ungracefully | Low |

**Recommendation**: Add test cases in `tests/install/e2e/`:
- `upgrade-with-data.test.sh` - Test upgrade preserves existing data
- `low-resources.test.sh` - Test behavior with constrained resources

---

### 10. Minor Issues

| Issue | Location | Fix |
|-------|----------|-----|
| OpenSSL 1.1.1+ required for `-addext` | `generate-certs.sh:19` | Add version check or fallback |
| No `.env.example` in repo root | - | Create for documentation |
| Container name pattern may break with custom COMPOSE_PROJECT_NAME | `start.sh:190-192` | Use `docker compose ps` instead |

---

## Implementation Priority

### High Priority
1. [x] Improve health check wait time (5s is too short) - **DONE** (2026-01-05)
2. [x] Add database backup guidance before upgrades - **DONE** (2026-01-05)

### Medium Priority
3. [x] Add disk space and memory pre-flight checks - **DONE** (2026-01-05)
4. [x] Create `uninstall.sh` for clean removal - **DONE** (2026-01-05)
5. [x] Add SSL certificate expiry warning - **DONE** (2026-01-05)
6. [x] Check all ports for conflicts - **DONE** (2026-01-05)

### Low Priority
7. [x] Add WSL detection and guidance - **DONE** (2026-01-05, added check_wsl function)
8. [x] Add ARM64/Apple Silicon detection - **DONE** (2026-01-05, added check_architecture function)
9. [x] Align secret generation between scripts - **DONE** (2026-01-05, updated scripts/setup.sh)
10. [x] Update `.env.example` file - **DONE** (2026-01-05, added push notifications, improved instructions)

---

## Related Files

- `/home/azayaka/sanctuary/install.sh` - Main installation script
- `/home/azayaka/sanctuary/scripts/setup.sh` - Secret generation script
- `/home/azayaka/sanctuary/start.sh` - Container startup script
- `/home/azayaka/sanctuary/docker/nginx/ssl/generate-certs.sh` - SSL generation
- `/home/azayaka/sanctuary/server/scripts/migrate.sh` - Database migration
- `/home/azayaka/sanctuary/tests/install/` - Installation test suite

---

## Notes

- The test suite at `tests/install/` is comprehensive and well-structured
- CI/CD workflow at `.github/workflows/install-test.yml` runs tests on relevant changes
- Consider running these improvements through the existing test suite before merging
