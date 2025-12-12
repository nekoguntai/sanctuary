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

## Features

- **Multi-wallet support** — Manage multiple wallets (single-sig and multisig)
- **Hardware wallet integration** — Connect Ledger devices directly via WebUSB (HTTPS required)
- **Real-time sync** — Monitor transactions and balances via Electrum or your own Bitcoin node
- **Address management** — Receive/change address tracking with labels
- **UTXO control** — Coin selection for privacy-conscious transactions
- **Transaction building** — Create PSBTs for hardware wallet signing
- **Multi-user access** — Share wallet visibility with family or team members
- **Group permissions** — Organize users into groups with shared wallet access
- **Dark mode** — Easy on the eyes, day or night

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Browser                              │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Sanctuary Web UI                          │ │
│  │              (WebUSB → Hardware Wallet)                      │ │
│  └────────────────────────────┬────────────────────────────────┘ │
└───────────────────────────────┼─────────────────────────────────┘
                                │ HTTPS
┌───────────────────────────────▼─────────────────────────┐
│                  Docker Compose Stack                    │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐    │
│  │  Frontend   │  │   Backend   │  │   PostgreSQL  │    │
│  │   (nginx)   │  │  (Node.js)  │  │   (Database)  │    │
│  └─────────────┘  └──────┬──────┘  └───────────────┘    │
└──────────────────────────┼──────────────────────────────┘
                           │
            ┌──────────────▼──────────────┐
            │   Bitcoin Network Access     │
            │  (Electrum / Bitcoin Node)   │
            └─────────────────────────────┘
```

**Components:**
- **Frontend** — React-based web interface served via nginx (HTTPS for WebUSB)
- **Backend** — Node.js API server handling wallet logic and blockchain queries
- **Database** — PostgreSQL for storing wallet metadata, addresses, and transaction history
- **WebUSB** — Direct browser-to-hardware-wallet communication (Ledger devices)

## Requirements

- **Docker** and **Docker Compose** (v2.0+)
- A modern web browser (Chrome, Firefox, Edge, Brave)
- 2GB RAM minimum, 4GB recommended
- ~500MB disk space (plus blockchain index cache)

Optional:
- Hardware wallet (Ledger, Trezor, Coldcard, etc.)
- Bitcoin Core or Electrum server for self-sovereign blockchain access

## Installation

### Quick Start (All Platforms)

1. **Install Docker**
   - See platform-specific instructions below

2. **Clone the repository**
   ```bash
   git clone https://github.com/n-narusegawa/sanctuary.git
   cd sanctuary
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your preferred settings
   ```

4. **Generate SSL certificates** (recommended for hardware wallet support)
   ```bash
   cd docker/nginx/ssl && chmod +x generate-certs.sh && ./generate-certs.sh localhost && cd ../../..
   ```

5. **Start Sanctuary**
   ```bash
   # With HTTPS (recommended - enables hardware wallet WebUSB)
   HTTPS_PORT=8443 JWT_SECRET=your-secret-here docker compose -f docker-compose.yml -f docker-compose.ssl.yml up -d

   # Or HTTP-only (no hardware wallet support)
   JWT_SECRET=your-secret-here docker compose up -d
   ```

6. **Access the interface**

   Open https://localhost:8443 in your browser (accept the self-signed certificate warning)

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
   podman-compose up -d
   ```

---

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# Server port (default: 8080)
FRONTEND_PORT=8080

# JWT secret for session tokens (generate a random string)
JWT_SECRET=your-secret-key-here

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
```

### Enabling HTTPS

HTTPS is required for WebUSB to work directly in the browser (for hardware wallet access). To enable HTTPS:

**Option 1: Self-Signed Certificates (Development)**

```bash
# Generate self-signed certificates
cd docker/nginx/ssl
chmod +x generate-certs.sh
./generate-certs.sh localhost
cd ../../..

# Run with SSL enabled (HTTPS on port 8443, HTTP redirect on port 8080)
HTTPS_PORT=8443 JWT_SECRET=your-secret docker compose -f docker-compose.yml -f docker-compose.ssl.yml up --build
```

Access at `https://localhost:8443`. Your browser will warn about the self-signed certificate—click "Advanced" and proceed.

For standard ports (requires root/admin):
```bash
HTTPS_PORT=443 FRONTEND_PORT=80 JWT_SECRET=your-secret docker compose -f docker-compose.yml -f docker-compose.ssl.yml up --build
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

# Run with SSL
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

Sanctuary uses WebUSB to communicate directly with Ledger hardware wallets from your browser. **HTTPS is required** for WebUSB to work.

#### Requirements

- **HTTPS** — Enable SSL (see [Enabling HTTPS](#enabling-https) above)
- **Chrome/Edge/Brave** — WebUSB is not supported in Firefox or Safari
- **Ledger device** — Currently supported: Nano S, Nano S Plus, Nano X, Stax, Flex

#### Connecting Your Device

1. **Enable HTTPS** in Sanctuary (required for WebUSB)
2. **Connect your Ledger** via USB
3. **Unlock the device** with your PIN
4. **Open the Bitcoin app** on your Ledger
5. In Sanctuary, click **Connect Device** — your browser will show a device picker
6. **Select your Ledger** to authorize access

Once connected, you can:
- Export xpubs for watch-only wallet setup
- Sign transactions (PSBT)
- Verify addresses on the device display

#### Supported Devices

| Device | Connection | Status |
|--------|------------|--------|
| **Ledger Nano S/S+/X** | WebUSB | Supported |
| **Ledger Stax/Flex** | WebUSB | Supported |
| **ColdCard** | PSBT file (air-gap) | Supported |
| **Trezor** | Coming soon | Planned |
| **Others** | PSBT file (air-gap) | Supported |

**Air-gapped devices** (ColdCard, Keystone, Passport) work via PSBT file export/import — no USB connection needed.

#### Troubleshooting

**"WebUSB not supported"**
- Ensure you're using Chrome, Edge, or Brave
- Verify HTTPS is enabled (check for 🔒 in address bar)
- Try `https://localhost` instead of `http://localhost`

**"Device not found"**
- Ensure device is plugged in and unlocked
- Open the Bitcoin app on your Ledger
- Close other apps using the device (Ledger Live)
- Try a different USB port or cable

**"Access denied"**
- Click "Connect Device" again to trigger the permission dialog
- Select your device in the browser's USB picker

## Usage

### First Run

1. Open https://localhost:8443 in Chrome, Edge, or Brave
2. Accept the self-signed certificate warning (Advanced → Proceed)
3. Create an account (stored locally in your database)
4. Add a wallet by importing an output descriptor or connecting a hardware wallet
5. Sanctuary will scan the blockchain for your transaction history

### Importing a Wallet

Sanctuary supports multiple import methods:

- **Output Descriptor** — Paste a descriptor like `wpkh([fingerprint/84'/0'/0']xpub.../0/*)`
- **Hardware Wallet** — Connect via WebUSB (HTTPS required) to read the xpub directly
- **JSON Export** — Import from Sparrow, Specter, or other compatible wallets

### Creating Transactions

1. Go to a wallet and click **Send**
2. Enter recipient address and amount
3. Select fee rate and optionally choose specific UTXOs
4. Review the transaction details
5. Click **Sign with Hardware Wallet**
6. Confirm on your hardware device
7. Broadcast the signed transaction

## Updating

```bash
cd sanctuary
git pull
docker compose down
docker compose build
docker compose up -d
```

## Backup & Restore

### Database Backup
```bash
docker compose exec postgres pg_dump -U sanctuary sanctuary > backup.sql
```

### Database Restore
```bash
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

### Network Exposure

By default, Sanctuary only listens on `localhost`. To expose it:

```yaml
# docker-compose.override.yml
services:
  frontend:
    ports:
      - "0.0.0.0:8080:80"  # Expose to network
```

For production deployments, put Sanctuary behind a reverse proxy (nginx, Caddy, Traefik) with TLS.

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
├── src/
│   └── api/           # Frontend API client
├── services/          # Frontend services (hardware wallet, etc.)
├── themes/            # Color theme definitions
├── docker/            # Docker configuration files
└── docker-compose.yml
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License — see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built with React, Node.js, PostgreSQL, and Docker
- Uses bitcoinjs-lib for Bitcoin primitives
- Electrum protocol for blockchain queries
- Inspired by Sparrow, Specter, and the broader Bitcoin ecosystem

---

**Sanctuary** — Your keys, your coins, your server.
