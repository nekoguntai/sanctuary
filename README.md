<p align="center">
  <img src="assets/logo.svg" alt="Sanctuary Logo" width="80" height="80" />
</p>

<h1 align="center">Sanctuary</h1>

<p align="center">
  <strong>Your keys, your coins, your server.</strong>
</p>

<p align="center">
  A web-based Bitcoin wallet coordinator designed for security-conscious users.<br/>
  Sanctuary never holds private keys—all signing happens on your hardware wallet.<br/>
  Run it locally, on your private server, or in the cloud.
</p>

<p align="center">
  <em>Don't trust. Verify.</em>
</p>

---

> **Disclaimer:** Sanctuary is provided free of charge, "as is", without warranty of any kind, express or implied. The authors and contributors accept no liability for any damages, loss of funds, or other issues arising from the use of this software. You are solely responsible for the security of your Bitcoin and the verification of all transactions. Always verify addresses and amounts on your hardware wallet before signing.

## Table of Contents

- [Quick Install](#quick-install)
- [First Run](#first-run)
- [Umbrel Installation](#umbrel-installation)
- [Overview](#overview)
- [Screenshots](#screenshots)
- [Features](#features)
- [Architecture](#architecture)
- [HTTP and HTTPS Ports](#http-and-https-ports)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Manual Installation](#manual-installation)
  - [Windows Installation](#windows-installation)
  - [macOS Installation](#macos-installation)
  - [Linux Installation](#linux-installation)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [Logging](#logging)
  - [Enabling HTTPS](#enabling-https)
  - [Connecting to Your Own Bitcoin Node](#connecting-to-your-own-bitcoin-node)
  - [Hardware Wallet Setup](#hardware-wallet-setup)
- [Usage](#usage)
  - [Importing a Wallet](#importing-a-wallet)
  - [Creating Transactions](#creating-transactions)
  - [Bumping Fees (RBF)](#bumping-fees-rbf)
  - [User Roles & Permissions](#user-roles--permissions)
  - [Admin Settings](#admin-settings)
  - [Two-Factor Authentication](#two-factor-authentication)
  - [Notifications](#notifications)
- [Upgrading](#upgrading)
- [Backup & Restore](#backup--restore)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Support the Project](#support-the-project)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Quick Install

**Prerequisites:** [Docker](https://www.docker.com/products/docker-desktop) and Git

**Option 1: One-liner** (downloads, clones, and installs automatically)
```bash
curl -fsSL https://raw.githubusercontent.com/n-narusegawa/sanctuary/main/install.sh | bash
```
This installs the **latest release** to `~/sanctuary` by default. Set `SANCTUARY_DIR` to customize the location.

**Option 2: Clone first** (if you want to choose the directory)
```bash
git clone https://github.com/n-narusegawa/sanctuary.git
cd sanctuary
./install.sh
```

Open **https://localhost:8443** and accept the certificate warning.

> **Time estimate:** First-time installation takes 2-5 minutes (Docker build). Subsequent starts are nearly instant.

<details>
<summary><strong>What the install script does</strong></summary>

1. Checks for Docker and Git
2. Fetches the latest release tag from GitHub
3. Clones the repository and checks out the release
4. Generates self-signed SSL certificates (for hardware wallet support)
5. Generates secure random secrets (JWT_SECRET and ENCRYPTION_KEY)
6. Builds and starts the Docker containers
7. Creates a default `admin` user with password `sanctuary` (must be changed on first login)
8. Saves your configuration to `.env.local` for future restarts

**After installation:**
- **Login credentials:** Username: `admin` / Password: `sanctuary`
- You'll be required to change the password on first login
- Start: `./start.sh`
- Stop: `./start.sh --stop`
- View logs: `./start.sh --logs`
- Upgrade: `./install.sh` (fetches and installs the latest release)

</details>

---

## First Run

After installation, follow these steps to set up your Sanctuary:

1. **Open the application**
   - Navigate to **https://localhost:8443** in Chrome, Edge, or Brave
   - Accept the self-signed certificate warning (click "Advanced" then "Proceed")

2. **Log in with default credentials**
   - Username: `admin`
   - Password: `sanctuary`

3. **Set your secure password**
   - You'll be prompted to change the default password immediately
   - Choose a strong password (minimum 8 characters, mix of letters, numbers, symbols)
   - This is a one-time setup step

4. **Add your first wallet**
   - Connect a hardware wallet (Ledger, Trezor) or import via QR code/file
   - Sanctuary will scan for existing transactions

**Troubleshooting first run:**
- **Can't connect?** Wait 30 seconds after install for services to start, then try again
- **Certificate warning?** This is expected for self-signed certificates. Click Advanced and Proceed.
- **API Error?** Run `./start.sh --logs` to check for issues

---

## Umbrel Installation

> **⚠️ Limited Functionality:** Umbrel serves apps over HTTP (not HTTPS), which means **WebUSB hardware wallet connections will not work**. You can still use Sanctuary on Umbrel for:
> - Importing wallets via output descriptors or JSON files
> - Viewing balances and transaction history
> - Creating unsigned PSBTs for air-gapped signing (ColdCard, Keystone, etc.)
>
> For full hardware wallet support via USB, use the [Quick Install](#quick-install) method which enables HTTPS.

If you're running [Umbrel](https://umbrel.com/), you can install Sanctuary as a Community App:

1. Open the **App Store** in your Umbrel
2. Click the **⋯** menu in the upper right corner
3. Select **Community App Stores**
4. Paste: `https://github.com/n-narusegawa/sanctuary`
5. Click **Add**
6. Find **Sanctuary** in the App Store and click **Install**

Sanctuary will automatically connect to your Umbrel's Electrum server.

---

## Overview

Sanctuary is a **watch-only wallet coordinator** that helps you manage Bitcoin wallets without exposing private keys to any networked device. It's designed for:

- **Individuals** who want a clean interface for their hardware wallet
- **Families or small teams** who need shared visibility into Bitcoin holdings
- **Security-focused users** who want full control over their wallet infrastructure

### Key Principles

- **No Private Keys** — Sanctuary never sees, stores, or transmits private keys. All transaction signing happens exclusively on your hardware wallet.
- **Self-Hosted** — Run on your own hardware. No third-party servers, no accounts, no tracking.
- **No Installation Required** — Just Docker. No elevated privileges, no system modifications.
- **Portable** — Works on Windows, macOS, and Linux with identical setup.

## Screenshots

<p align="center">
  <img src="assets/screenshots/dashboard.png" alt="Dashboard" width="800" />
  <br/><em>Dashboard - Overview of your wallets and recent activity</em>
</p>

<p align="center">
  <img src="assets/screenshots/wallet.png" alt="Wallet Detail" width="800" />
  <br/><em>Wallet Detail - Addresses, UTXOs, and transaction history</em>
</p>

<p align="center">
  <img src="assets/screenshots/send.png" alt="Send Transaction" width="800" />
  <br/><em>Send Transaction - Build and sign transactions with your hardware wallet</em>
</p>

<p align="center">
  <img src="assets/screenshots/settings.png" alt="Settings" width="800" />
  <br/><em>Settings - Customize themes and preferences</em>
</p>

## Features

- **Multi-wallet support** — Manage multiple wallets (single-sig and multisig)
- **Hardware wallet integration** — Connect Ledger and Trezor devices directly
- **QR code scanning** — Import device xpubs via camera (Keystone, Passport, ColdCard Q)
- **Real-time sync** — Monitor transactions and balances via Electrum or your own Bitcoin node
- **Address management** — Receive/change address tracking with labels
- **UTXO control** — Coin selection for privacy-conscious transactions
- **Transaction building** — Create PSBTs for hardware wallet signing
- **Replace-By-Fee (RBF)** — Bump fees on pending transactions to speed up confirmation
- **Multi-user access** — Share wallet visibility with family or team members
- **Role-based permissions** — Fine-grained access control (owner, signer, viewer)
- **Group permissions** — Organize users into groups with shared wallet access
- **Admin controls** — Configure public registration and system settings
- **Dark mode** — Easy on the eyes, day or night
- **8 color themes** — Sanctuary, Serenity, Forest, Cyber, Sunrise, Ocean, Nordic, Midnight
- **Background patterns** — 16 patterns with adjustable opacity
- **Contrast control** — Adjust background contrast for accessibility
- **Two-factor authentication** — Optional TOTP-based 2FA with backup codes
- **Telegram notifications** — Receive transaction alerts via your own Telegram bot
- **Notification sounds** — Configurable audio alerts for transactions and confirmations
- **Update notifications** — Dashboard alerts when new versions are available
- **Audit logging** — Track security-relevant events and user actions (including gateway/mobile API events)
- **Mobile API gateway** — Secure API for iOS/Android apps with push notifications
- **Backup & restore** — Export/import all data via the web UI

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Your Browser                                     │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        Sanctuary Web UI                                │  │
│  │                  (WebUSB → Hardware Wallet)                            │  │
│  └────────────────────────────────┬──────────────────────────────────────┘  │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │ HTTPS (:8443)
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│                          Docker Compose Stack                                │
│                                                                              │
│  ┌─────────────┐      ┌─────────────┐      ┌───────────────┐                │
│  │  Frontend   │      │   Backend   │◄────►│   PostgreSQL  │                │
│  │   (nginx)   │─────►│  (Node.js)  │      │   (Database)  │                │
│  │   :8443     │      │    :3001    │      │     :5432     │                │
│  └─────────────┘      └──────┬──────┘      └───────────────┘                │
│                              │ ▲                                             │
│                              │ │ WebSocket                                   │
│                              │ │                                             │
│  ┌─────────────┐             │ │                                             │
│  │   Gateway   │─────────────┘ │                                             │
│  │  (Node.js)  │◄──────────────┘                                             │
│  │    :4000    │                                                             │
│  └──────┬──────┘                                                             │
│         │                                                                    │
└─────────┼────────────────────────────────────────────────────────────────────┘
          │ HTTPS (:4000)                       │
          │                                     │
          ▼                                     ▼
┌───────────────────┐              ┌─────────────────────────────┐
│   Mobile Apps     │              │   Bitcoin Network Access     │
│  (iOS / Android)  │              │  (Electrum / Bitcoin Node)   │
│                   │              └─────────────────────────────┘
│  ┌─────┐ ┌─────┐  │
│  │ iOS │ │ And │  │
│  └─────┘ └─────┘  │
└───────────────────┘
```

**Components:**
- **Frontend** — React-based web interface served via nginx (HTTPS for WebUSB)
- **Backend** — Node.js API server handling wallet logic and blockchain queries
- **Database** — PostgreSQL for storing wallet metadata, addresses, and transaction history
- **Gateway** — API gateway for mobile apps with JWT auth, rate limiting, and push notifications
- **WebUSB** — Direct browser-to-hardware-wallet communication (Ledger, Trezor)

### Mobile API Gateway

The gateway container provides a secure API for iOS and Android mobile apps:

**Features:**
- **JWT Authentication** — Same tokens as web app (shared secret)
- **Route Whitelisting** — Only safe read/write endpoints exposed
- **Rate Limiting** — 60 requests/min default, 5 login attempts/15min
- **Push Notifications** — FCM (Android) and APNs (iOS) support
- **Audit Logging** — Security events logged to database for admin visibility

**How it works:**
1. Mobile apps authenticate via `/api/v1/auth/login`
2. Gateway validates JWT and proxies allowed routes to backend
3. Gateway subscribes to backend WebSocket for transaction events
4. When transactions occur, gateway sends push notifications to registered devices

**Exposed endpoints:**
- Authentication (login, profile)
- Wallets (list, view, sync)
- Transactions (list, view)
- Addresses (list, generate)
- Labels (full CRUD)
- Push device registration

**Blocked by design:**
- Admin routes (`/api/v1/admin/*`)
- User management (create/delete users)
- Node configuration
- Backup/restore operations

The gateway runs on port 4000 by default and starts automatically with `docker compose up`.

## HTTP and HTTPS Ports

Sanctuary runs on both HTTP and HTTPS to support different hardware wallet types:

**Default ports:**
- `HTTPS_PORT=8443` — Main application (https://localhost:8443)
- `HTTP_PORT=8080` — Alternative port (http://localhost:8080)

**Why two ports?**

| Device Type | Required Port | Reason |
|-------------|---------------|--------|
| **Ledger** | HTTPS (8443) | WebUSB requires a secure context |
| **Trezor** | Any | Works on both HTTP and HTTPS |
| **QR Camera** | HTTPS (8443) | Camera access requires a secure context |
| **File import** | Any | No special browser API required |

**Recommendation:** Use HTTPS (8443) as your default. Only switch to HTTP if you encounter issues.

## Requirements

- **Docker** and **Docker Compose** (v2.0+)
- A modern web browser (Chrome, Firefox, Edge, Brave)
- 2GB RAM minimum, 4GB recommended
- ~500MB disk space (plus blockchain index cache)

Optional:
- Hardware wallet (Ledger, Trezor, Coldcard, etc.)
- Bitcoin Core or Electrum server for self-sovereign blockchain access

## Installation

> **Easiest method:** Use `./install.sh` as shown in [Quick Install](#quick-install) above.
>
> The sections below are for manual installation or platform-specific troubleshooting.

### Manual Installation

If you prefer to run the commands yourself:

```bash
# 1. Clone the repository
git clone https://github.com/n-narusegawa/sanctuary.git
cd sanctuary

# 2. Generate SSL certificates
cd docker/nginx/ssl && chmod +x generate-certs.sh && ./generate-certs.sh localhost && cd ../../..

# 3. Start Sanctuary (replace secrets with random strings)
HTTPS_PORT=8443 JWT_SECRET=your-jwt-secret ENCRYPTION_KEY=your-encryption-key docker compose up -d

# 4. Open https://localhost:8443
```

---

### Windows Installation

#### Option 1: Docker Desktop (Recommended)

1. **Download Docker Desktop**
   - Visit https://www.docker.com/products/docker-desktop
   - Download and run the installer
   - No admin rights needed for installation in user directory

2. **Enable WSL 2 (if prompted)**
   - Docker Desktop will guide you through WSL 2 setup
   - This runs Linux containers natively on Windows

3. **Clone and run**
   ```powershell
   git clone https://github.com/n-narusegawa/sanctuary.git
   cd sanctuary
   copy .env.example .env
   # Edit .env and replace CHANGE_ME values with random strings
   docker compose up -d
   ```

#### Option 2: WSL 2 + Docker (No Docker Desktop)

For users who prefer not to use Docker Desktop:

1. **Install WSL 2**
   ```powershell
   wsl --install -d Ubuntu
   ```

2. **Inside WSL, install Docker**
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   # Log out and back in
   ```

3. **Clone and run**
   ```bash
   git clone https://github.com/n-narusegawa/sanctuary.git
   cd sanctuary
   cp .env.example .env
   # Edit .env and replace CHANGE_ME values with random strings
   docker compose up -d
   ```

---

### macOS Installation

#### Option 1: Docker Desktop

1. **Download Docker Desktop**
   - Visit https://www.docker.com/products/docker-desktop
   - Download the Mac version (Apple Silicon or Intel)
   - Drag to Applications folder

2. **Clone and run**
   ```bash
   git clone https://github.com/n-narusegawa/sanctuary.git
   cd sanctuary
   cp .env.example .env
   # Edit .env and replace CHANGE_ME values with random strings
   docker compose up -d
   ```

#### Option 2: Colima (Lightweight Alternative)

For users who prefer a lighter-weight solution:

1. **Install via Homebrew**
   ```bash
   brew install colima docker docker-compose
   ```

2. **Start Colima**
   ```bash
   colima start
   ```

3. **Clone and run**
   ```bash
   git clone https://github.com/n-narusegawa/sanctuary.git
   cd sanctuary
   cp .env.example .env
   # Edit .env and replace CHANGE_ME values with random strings
   docker compose up -d
   ```

---

### Linux Installation

#### Option 1: Docker Engine (Recommended)

1. **Install Docker**
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   # Log out and back in for group changes to take effect
   ```

   ```bash
   # Fedora
   sudo dnf install docker docker-compose-plugin
   sudo systemctl enable --now docker
   sudo usermod -aG docker $USER
   ```

   ```bash
   # Arch Linux
   sudo pacman -S docker docker-compose
   sudo systemctl enable --now docker
   sudo usermod -aG docker $USER
   ```

2. **Clone and run**
   ```bash
   git clone https://github.com/n-narusegawa/sanctuary.git
   cd sanctuary
   cp .env.example .env
   # Edit .env and replace CHANGE_ME values with random strings
   docker compose up -d
   ```

#### Option 2: Podman (Rootless Alternative)

For systems where you can't or don't want to run Docker:

1. **Install Podman**
   ```bash
   # Ubuntu/Debian
   sudo apt install podman podman-compose

   # Fedora
   sudo dnf install podman podman-compose
   ```

2. **Clone and run**
   ```bash
   git clone https://github.com/n-narusegawa/sanctuary.git
   cd sanctuary
   cp .env.example .env
   # Edit .env and replace CHANGE_ME values with random strings
   podman-compose up -d
   ```

---

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# Server port (default: 8080)
FRONTEND_PORT=8080

# JWT secret for session tokens (generate a random string, min 32 chars)
JWT_SECRET=your-secret-key-here

# Encryption key for sensitive data like node passwords (generate a random string, min 32 chars)
ENCRYPTION_KEY=your-encryption-key-here

# Database (default works out of box)
DATABASE_URL=postgresql://sanctuary:sanctuary@postgres:5432/sanctuary

# Bitcoin network: mainnet, testnet, or regtest
BITCOIN_NETWORK=mainnet

# Electrum server (optional - uses public servers by default)
ELECTRUM_HOST=your-electrum-server.com
ELECTRUM_PORT=50002
ELECTRUM_SSL=true

# Block explorer URL for transaction links
EXPLORER_URL=https://mempool.space

# Logging level (debug, info, warn, error)
LOG_LEVEL=info
```

### Logging

Sanctuary uses a structured logging system with configurable verbosity levels:

| Level | Description |
|-------|-------------|
| `debug` | Verbose output for development and troubleshooting (WebSocket events, sync details, API calls) |
| `info` | Normal operation messages (startup, sync completion) — **default** |
| `warn` | Warning conditions that don't prevent operation |
| `error` | Error conditions that may affect functionality |

**Setting the log level:**

```bash
# Verbose debugging (see all WebSocket subscriptions, sync operations, etc.)
LOG_LEVEL=debug docker compose up

# Normal operation (default)
LOG_LEVEL=info docker compose up

# Quiet mode (warnings and errors only)
LOG_LEVEL=warn docker compose up

# Minimal output (errors only)
LOG_LEVEL=error docker compose up
```

**Log format:**
```
[2025-12-13T20:57:49.857Z] DEBUG [WS] WebSocket client authenticated: user-id-here
[2025-12-13T20:57:49.921Z] INFO  [SYNC] Background sync service started
[2025-12-13T20:57:50.123Z] WARN  [BLOCKCHAIN] Failed to get tx abc123
[2025-12-13T20:57:50.456Z] ERROR [WALLETS] Database connection failed
```

**Module prefixes:**
- `[WS]` — WebSocket server events
- `[SYNC]` — Background sync service
- `[BLOCKCHAIN]` — Blockchain/Electrum operations
- `[WALLETS]` — Wallet API operations
- `[NOTIFY]` — Real-time notification service
- `[ADMIN]` — Admin API operations
- `[BITCOIN]` — Bitcoin RPC/network operations
- `[PRICE]` — Price feed service
- `[GATEWAY]` — Mobile API gateway operations
- `[REQUEST]` — Gateway request logging
- `[AUTH]` — Gateway authentication
- `[PROXY]` — Gateway backend proxy
- `[FCM]` — Firebase Cloud Messaging (Android push)
- `[APNS]` — Apple Push Notification Service (iOS push)

### Enabling HTTPS

HTTPS is required for WebUSB to work directly in the browser (for hardware wallet access). With HTTPS enabled:
- **All content is served exclusively over HTTPS**
- **HTTP requests are automatically redirected to HTTPS**

**Option 1: Self-Signed Certificates (Development)**

```bash
# Generate self-signed certificates
cd docker/nginx/ssl
chmod +x generate-certs.sh
./generate-certs.sh localhost
cd ../../..

# Run with HTTPS (port 8443) + HTTP redirect (port 8080)
HTTPS_PORT=8443 JWT_SECRET=your-secret docker compose -f docker-compose.yml -f docker-compose.ssl.yml up --build
```

Access at `https://localhost:8443` (or `http://localhost:8080` which redirects to HTTPS). Your browser will warn about the self-signed certificate—click "Advanced" and proceed.

For standard ports (requires root/admin):
```bash
HTTPS_PORT=443 HTTP_PORT=80 JWT_SECRET=your-secret docker compose -f docker-compose.yml -f docker-compose.ssl.yml up --build
```

**Option 2: mkcert (Locally-Trusted Certificates)**

For a better local development experience without certificate warnings:

```bash
# Install mkcert (https://github.com/FiloSottile/mkcert)
# macOS: brew install mkcert
# Windows: choco install mkcert
# Linux: see mkcert GitHub

# Install local CA (one time)
mkcert -install

# Generate certificates
mkcert -key-file docker/nginx/ssl/privkey.pem -cert-file docker/nginx/ssl/fullchain.pem localhost 127.0.0.1

# Run with HTTPS
HTTPS_PORT=8443 JWT_SECRET=your-secret docker compose -f docker-compose.yml -f docker-compose.ssl.yml up --build
```

**Option 3: Let's Encrypt (Production)**

For production deployments with a domain name, replace the certificates in `docker/nginx/ssl/` with your Let's Encrypt certificates:
- `fullchain.pem` — Your certificate chain
- `privkey.pem` — Your private key

### Connecting to Your Own Bitcoin Node

For maximum privacy, connect Sanctuary to your own Bitcoin/Electrum infrastructure.

> **Recommendation:** Use an Electrum server (Fulcrum, ElectrumX, or electrs) rather than Bitcoin Core RPC directly. Electrum servers maintain an address index optimized for wallet queries, providing significantly faster sync times and lower resource usage. Bitcoin Core's `scantxoutset` command works but is slower and not designed for frequent wallet operations.

**Option 1: Electrum Server (Recommended)**
```bash
ELECTRUM_HOST=192.168.1.100
ELECTRUM_PORT=50002
ELECTRUM_SSL=true
```

**Option 2: Fulcrum/ElectrumX**
```bash
ELECTRUM_HOST=fulcrum.local
ELECTRUM_PORT=50002
ELECTRUM_SSL=false
```

**Option 3: Bitcoin Core RPC**

Bitcoin Core RPC is supported but not recommended for regular use. Configure via the Admin panel under Node Config.

```
Type: bitcoind
Host: 192.168.1.100
Port: 8332
Username: your-rpc-user
Password: your-rpc-password
```

Note: Bitcoin Core requires the wallet to have `txindex=1` enabled or uses `scantxoutset` which rescans the UTXO set on each query.

### Hardware Wallet Setup

Sanctuary supports multiple hardware wallet types through different connection methods.

#### Supported Devices

| Device | Connection | Port | Status |
|--------|------------|------|--------|
| **Ledger Nano S/S+/X** | WebUSB | HTTPS (8443) | Supported |
| **Ledger Stax/Flex** | WebUSB | HTTPS (8443) | Supported |
| **Trezor Model One/T** | Trezor Connect | Either | Supported |
| **Trezor Safe 3/5/7** | Trezor Connect | Either | Supported |
| **ColdCard** | File (MicroSD) | Any | Supported |
| **ColdCard Q** | QR code or file | HTTPS for QR camera | Supported |
| **Keystone** | QR code or file | HTTPS for QR camera | Supported |
| **Passport** | QR code or file | HTTPS for QR camera | Supported |

#### Connecting a Ledger

1. Open **https://localhost:8443** (HTTPS required for WebUSB)
2. Connect your Ledger via USB
3. Unlock the device with your PIN
4. Open the **Bitcoin app** on your Ledger
5. Click **Connect Device** — your browser will show a USB device picker
6. Select your Ledger to authorize access

#### Connecting a Trezor

1. Open Sanctuary (HTTPS or HTTP)
2. Connect your Trezor via USB
3. Click **Connect Device** and select a Trezor model
4. A popup will open to **connect.trezor.io**
5. Follow the prompts to authorize and export your xpub
6. **Note:** You may need to switch between Trezor Suite and Sanctuary for device operations

#### Air-Gapped Devices (ColdCard, ColdCard Q, Keystone, Passport)

Air-gapped devices work via PSBT file or QR code — no USB connection needed:

**Option 1: QR Code Scanning** (requires HTTPS for camera access)
1. Open **https://localhost:8443**
2. Click **Connect Device** → **QR Code**
3. Use your camera to scan the device's xpub QR code

**Option 2: File Import**
1. Export the xpub/descriptor as a JSON file from your device
2. Click **Connect Device** → **File Upload**
3. Select the exported file

Once connected, you can:
- Export xpubs for watch-only wallet setup
- Sign transactions (PSBT)
- Verify addresses on the device display

#### Troubleshooting

**Ledger: "WebUSB not supported"**
- Ensure you're using Chrome, Edge, or Brave (Firefox/Safari don't support WebUSB)
- Use HTTPS: https://localhost:8443 (check for 🔒 in address bar)
- Don't use HTTP for Ledger devices

**Ledger: "Device not found"**
- Ensure device is plugged in and unlocked
- Open the Bitcoin app on your Ledger
- Close Ledger Live (it locks the USB connection)
- Try a different USB port or cable

**Trezor: Connection fails or popup blocked**
- Allow popups from connect.trezor.io
- Close Trezor Suite if it's open
- If issues persist on HTTPS, try HTTP: http://localhost:8080
- Try a different browser if issues persist

**QR Camera: "Camera access denied"**
- Use HTTPS: https://localhost:8443
- Allow camera permissions when prompted
- Check browser settings if previously denied

## Usage

> See [First Run](#first-run) for initial setup steps after installation.

### Importing a Wallet

Sanctuary supports multiple import methods:

- **Output Descriptor** — Paste a descriptor like `wpkh([fingerprint/84'/0'/0']xpub.../0/*)`
- **Hardware Wallet** — Connect Ledger or Trezor to read the xpub directly
- **QR Code Scan** — Scan xpub QR codes from Keystone, Passport, ColdCard Q (HTTPS required for camera)
- **JSON Export** — Import from Sparrow, Specter, or other compatible wallets

### Creating Transactions

1. Go to a wallet and click **Send**
2. Enter recipient address and amount
3. Select fee rate and optionally choose specific UTXOs
   - Click on blocks in the mempool visualizer to populate the fee rate
   - Fee rates support decimals as low as 0.1 sat/vB
4. Review the transaction details
5. Click **Sign with Hardware Wallet**
6. Confirm on your hardware device
7. Broadcast the signed transaction

### Bumping Fees (RBF)

If a transaction is stuck in the mempool, you can bump the fee using Replace-By-Fee:

1. Go to the wallet's **Transactions** tab
2. Click on a pending (unconfirmed) transaction
3. In the transaction details modal, click **Bump Fee (RBF)**
4. Enter a new fee rate (must be higher than the current rate)
5. Click **Bump Fee** to create a replacement transaction
6. Sign with your hardware wallet and broadcast

**Requirements:**
- Transaction must have RBF enabled (sequence number < 0xfffffffe)
- You must be the sender (can't bump received transactions)
- New fee rate must be at least 1 sat/vB higher than the current rate

**Note:** RBF creates a new transaction that replaces the original. Only one will confirm.

### User Roles & Permissions

Sanctuary supports role-based access control for shared wallets:

| Role | View | Edit Labels | Create Transactions | Share/Delete |
|------|------|-------------|---------------------|--------------|
| **Owner** | ✓ | ✓ | ✓ | ✓ |
| **Signer** | ✓ | ✓ | ✓ | ✗ |
| **Viewer** | ✓ | ✗ | ✗ | ✗ |

- **Owner** — Full control. Can share wallets with groups/users and delete the wallet.
- **Signer** — Can view, add/edit labels, and create transactions for signing.
- **Viewer** — Read-only access. Can view transactions and balances but cannot modify anything.

When sharing a wallet with a group, you can set a default role for all group members.

### Admin Settings

Administrators can configure system-wide settings under **Administration → System Settings**:

- **Public Registration** — Enable/disable self-service account creation. When disabled (default), only administrators can create new user accounts.

### Two-Factor Authentication

Users can enable TOTP-based two-factor authentication for additional account security:

1. Go to **Account** (click your username in the sidebar)
2. Find the **Two-Factor Authentication** section
3. Click **Enable 2FA**
4. Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)
5. Enter the 6-digit code to verify
6. **Save your backup codes** — these can be used if you lose access to your authenticator

**Backup codes:**
- 10 single-use codes are generated when 2FA is enabled
- Each code can only be used once
- Store them securely (password manager, printed copy in a safe place)
- You can regenerate codes from the Account page if needed

**Disabling 2FA:**
- Requires your current password and a valid 2FA code
- This is intentionally difficult to prevent unauthorized disabling

### Notifications

Sanctuary supports multiple notification methods to keep you informed about wallet activity.

#### Telegram Notifications

Receive transaction alerts via Telegram using your own bot:

1. **Create a Telegram bot:**
   - Open Telegram and message [@BotFather](https://t.me/BotFather)
   - Send `/newbot` and follow the prompts
   - Copy the bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

2. **Get your Chat ID:**
   - Send `/start` to your new bot in Telegram
   - In Sanctuary, go to **Settings → Telegram Notifications**
   - Paste your bot token and click **Fetch** to auto-detect your Chat ID

3. **Configure per-wallet notifications:**
   - Go to any wallet's **Settings** tab
   - Enable Telegram notifications for that wallet
   - Choose which events to receive: received, sent, consolidation

#### Notification Sounds

Configure audio alerts for different transaction events:

1. Go to **Settings → Notification Sounds**
2. Enable sounds globally with the master toggle
3. Configure each event type independently:
   - **Confirmation** — Plays when a transaction gets its first confirmation
   - **Receive** — Plays when Bitcoin is received
   - **Send** — Plays when a transaction is broadcast

Each event can have its own sound from 20 built-in presets (chime, bell, coin, zen, etc.) or be disabled individually.

## Upgrading

The easiest way to upgrade is to re-run the install script, which automatically fetches and installs the latest release:

```bash
cd ~/sanctuary
./install.sh
```

### Manual Upgrade

If you prefer to upgrade manually:

```bash
cd ~/sanctuary

# Fetch all tags and checkout the latest release
git fetch --tags
LATEST=$(git tag --sort=-v:refname | head -1)
git checkout "$LATEST"

# Rebuild and restart
docker compose down
docker compose build
docker compose up -d
```

### Checking Your Current Version

```bash
cd ~/sanctuary
git describe --tags --always
```

### Downgrading to a Specific Version

If you need to rollback to a previous release:

```bash
cd ~/sanctuary
git fetch --tags
git tag --sort=-v:refname  # List available versions
git checkout v0.4.8        # Replace with desired version
docker compose down
docker compose build
docker compose up -d
```

## Backup & Restore

Sanctuary provides multiple ways to backup and restore your data.

### Web UI Backup (Recommended)

The easiest way to backup is through the web interface:

1. Go to **Administration → Backup & Restore**
2. Click **Create Backup** to generate an encrypted backup file
3. Enter a password to encrypt the backup
4. Download the `.sanctuary-backup` file and store it securely

To restore:
1. Go to **Administration → Backup & Restore**
2. Click **Restore from Backup**
3. Upload your backup file and enter the decryption password
4. Choose whether to merge with existing data or replace entirely

**What's included in UI backups:**
- All wallets, devices, and their configurations
- User accounts and preferences (including 2FA settings)
- Transaction labels and address labels
- Groups and sharing permissions
- Audit logs

### Command-Line Backup

For scripted or automated backups:

```bash
# Full database backup
docker compose exec postgres pg_dump -U sanctuary sanctuary > backup.sql

# Restore from backup
cat backup.sql | docker compose exec -T postgres psql -U sanctuary sanctuary
```

### What's Stored

Sanctuary stores:
- Wallet metadata (names, descriptors, settings)
- Extended public keys (xpubs) — these are **watch-only**
- Transaction history and labels
- Address derivation state
- User accounts and preferences

Sanctuary **never** stores:
- Private keys
- Seed phrases
- Wallet passwords

## Security Considerations

- **Run locally** when possible for maximum security
- **Use HTTPS** if exposing to a network (see reverse proxy setup)
- **Backup your hardware wallet seed** — Sanctuary cannot recover funds
- **Keep Docker updated** for security patches
- **Use strong passwords** for your Sanctuary account

### First-Login Security

- The default admin password (`sanctuary`) must be changed on first login
- A modal will block access until you set a secure password
- Minimum password length: 8 characters

### TLS Certificate Verification

- Sanctuary verifies TLS certificates when connecting to Electrum servers
- Self-signed certificates are rejected by default for security
- To allow self-signed certificates (e.g., for local servers), enable "Allow Self-Signed Certificates" in Admin → Node Config

### Network Exposure

By default, Sanctuary listens on all network interfaces (`0.0.0.0`). This means it's accessible from other devices on your network.

**To restrict to localhost only:**

```yaml
# docker-compose.override.yml
services:
  frontend:
    ports:
      - "127.0.0.1:${HTTP_PORT:-80}:80"
      - "127.0.0.1:${HTTPS_PORT:-443}:443"
```

**For production deployments:**
- Use a reverse proxy (nginx, Caddy, Traefik) with proper TLS certificates
- Configure firewall rules to restrict access
- Consider VPN access for remote administration

## Troubleshooting

### Container won't start
```bash
# Check logs
docker compose logs -f

# Rebuild from scratch
docker compose down -v
docker compose build --no-cache
docker compose up -d
```

### Can't connect to hardware wallet
- Ensure HTTPS is enabled (WebUSB requires a secure context)
- Use Chrome, Edge, or Brave (Firefox/Safari don't support WebUSB)
- Try a different USB port
- Check that no other application is using the device (close Ledger Live)
- On Linux, you may need udev rules for your hardware wallet

### Database connection errors
```bash
# Reset the database
docker compose down -v
docker compose up -d
```

### Port already in use
```bash
# Change the port in .env
FRONTEND_PORT=8081
docker compose up -d
```

## Development

### Running in Development Mode

```bash
# Start backend services
docker compose up -d postgres

# Run backend with hot reload
cd server
npm install
npm run dev

# Run frontend with hot reload
cd ..
npm install
npm run dev
```

### Project Structure

```
sanctuary/
├── components/        # React components
├── contexts/          # React context providers
├── hooks/             # Custom React hooks
├── server/            # Backend Node.js application
│   ├── src/
│   │   ├── api/       # REST API routes
│   │   ├── services/  # Business logic
│   │   └── models/    # Prisma database models
│   └── prisma/        # Database schema and migrations
├── gateway/           # Mobile API gateway
│   └── src/
│       ├── middleware/ # Auth, rate limiting, logging
│       ├── routes/     # Proxy routes to backend
│       └── services/   # Push notifications (FCM/APNs)
├── src/
│   └── api/           # Frontend API client
├── services/          # Frontend services (hardware wallet, etc.)
├── themes/            # Color theme definitions
├── docker/            # Docker configuration files
└── docker-compose.yml
```

## Support the Project

If you find Sanctuary useful and want to support its development, consider sending a donation.

### Bitcoin (on-chain)

<p align="center">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=bitcoin%3Abc1qzmc3dq08dermpth02xa437d3fx99n7e6wyhmhq" alt="Bitcoin QR Code" />
</p>

```
bc1qzmc3dq08dermpth02xa437d3fx99n7e6wyhmhq
```

### Lightning Address

<p align="center">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=lightning%3Acarpalbutton44%40phoenixwallet.me" alt="Lightning Address QR Code" />
</p>

```
carpalbutton44@phoenixwallet.me
```

### BOLT12 Offer

<p align="center">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=lno1zrxq8pjw7qjlm68mtp7e3yvxee4y5xrgjhhyf2fxhlphpckrvevh50u0q0k69ewp6vpr8cpc4fd86z8zx6vfsw9mygjvpanytty0rf7dadr2jqsrl3hc5zp5ethevj9fgtw2507ug4qvfaqeejk637u03dmqpy9fyq6sqv6wau6w883t4n4l5yqjfr4ge4ugpttxgeq9cy4gtxhlckats0ce9mph6k4kwrz7dl648999emgcv5p90yl8q25qslw2dfndv3n2gtv20wpkhahexj93dh7w35g832h33e55h3tagqqsu0hv9rtuadpk5rahzc9uj9fdzy" alt="BOLT12 Offer QR Code" />
</p>

<details>
<summary>BOLT12 Offer (click to expand)</summary>

```
lno1zrxq8pjw7qjlm68mtp7e3yvxee4y5xrgjhhyf2fxhlphpckrvevh50u0q0k69ewp6vpr8cpc4fd86z8zx6vfsw9mygjvpanytty0rf7dadr2jqsrl3hc5zp5ethevj9fgtw2507ug4qvfaqeejk637u03dmqpy9fyq6sqv6wau6w883t4n4l5yqjfr4ge4ugpttxgeq9cy4gtxhlckats0ce9mph6k4kwrz7dl648999emgcv5p90yl8q25qslw2dfndv3n2gtv20wpkhahexj93dh7w35g832h33e55h3tagqqsu0hv9rtuadpk5rahzc9uj9fdzy
```

</details>

Your support helps cover development costs and keeps the project independent.

## License

MIT License — see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built with React, Node.js, PostgreSQL, and Docker
- Uses bitcoinjs-lib for Bitcoin primitives
- Electrum protocol for blockchain queries
- Inspired by Sparrow, Specter, and the broader Bitcoin ecosystem

---

**Sanctuary** — Your keys, your coins, your server.
