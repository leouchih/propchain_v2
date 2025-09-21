# PropChain — Real-Estate Escrow & NFT Listings (DApp)

PropChain is a decentralized marketplace for property listings that mints each property as an NFT and automates the sale flow via an Escrow smart contract (roles for Seller/Buyer/Inspector/Lender/Admin). Metadata and media are stored on IPFS.

## Features

* NFT-backed property listings (IPFS metadata + multi-image gallery)
* Fixed-price or auction style listing type
* On-chain escrow with role approvals (seller, buyer, inspector, lender)
* KYC/allowlist & lockups (Compliance panel)
* Admin panel: pause/unpause, fee settings, emergency actions
* Role-aware UI tabs (buyer/seller/inspector/lender/admin)
* Search, filters, and status badges across the marketplace

## Tech Stack

* **Solidity**, **Hardhat** (contracts, scripts, tests)
* **Ethers.js**, **MetaMask** (wallet & chain)
* **React** (frontend)
* **IPFS** via Pinata (media + JSON metadata)

---

## Quick Start

### 0) Prereqs

* Node 18+ and Git
* MetaMask (with a local account and/or Sepolia test ETH)

### 1) Install

```bash
git clone https://github.com/<you>/propchain_v2.git
cd propchain_v2
npm install
```

### 2) Environment

Create **.env** (never commit real secrets) and copy what you need from `.env.example`:

```ini
# RPCs
REACT_APP_SEPOLIA_RPC=https://sepolia.infura.io/v3/<your-key>

# Pinata (for uploads from the UI)
REACT_APP_PINATA_API_KEY=<key>
REACT_APP_PINATA_SECRET_API_KEY=<secret>
REACT_APP_PINATA_ENDPOINT=https://api.pinata.cloud/pinning/pinFileToIPFS

# Optional script overrides (usually not needed if you use config.json)
ESCROW_ADDRESS=
REALESTATE_ADDRESS=

# Role targets for scripts/grant-roles.js
ADMIN_ADDR=0xYourAdmin
PAUSER_ADDR=0xYourAdmin
TREASURER_ADDR=0xYourAdmin
GUARD_ADDR=0xYourAdmin
SELLER_ADDR=0xSellerForMinting
CURATOR_ADDR=0xYourAdmin
```

---

## Local Development (Hardhat)

### 3) Compile & Test

```bash
npx hardhat compile
npx hardhat test
```

### 4) Run Local Node

```bash
npx hardhat node
```

### 5) Deploy to Localhost

In a second terminal:

```bash
npx hardhat run scripts/deploy.js --network localhost
```

This writes deployed addresses to `src/config.json` under chain id `31337`.

### 6) (Optional) Grant Roles Locally

```bash
npx hardhat run scripts/grant-roles.js --network localhost
```

### 7) Start Frontend

```bash
npm start
```

Open [http://localhost:4001](http://localhost:4001) and connect MetaMask to **Localhost 8545** (or your chosen RPC).

---

## Sepolia Testnet

### 1) Configure RPC & Fund Accounts

* Put `REACT_APP_SEPOLIA_RPC` in `.env`
* Fund your deployer & seller with Sepolia ETH

### 2) Deploy

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

Addresses are written to `src/config.json` under chain id `11155111`.

### 3) Grant Roles

Make sure your `.env` has the target addresses set (see above), then:

```bash
npx hardhat run scripts/grant-roles.js --network sepolia
```

### 4) Frontend

No need to restart `npm start`—just switch the MetaMask network to **Sepolia**.
(App auto-selects `src/config.json` by `chainId` and uses your injected provider.)

### Optional: KYC / Compliance Webhook Server

This repo includes `server.js`, a minimal Express server that receives KYC webhooks
and updates on-chain compliance (e.g., allowlist / credential hash).

**Env (.env):**
PORT=4000
RPC_URL=https://sepolia.infura.io/v3/<key>
ESCROW_ADDRESS=<from src/config.json>
WEBHOOK_SECRET=<from KYC provider>
DIDIT_API_KEY=<if you call their API>
NGROK_AUTHTOKEN=<optional, for public URL>

**Run locally:**
npm run kyc:server         # or: node server.js
# (optional) expose via ngrok for webhook callbacks

---

## Acknowledgements

* Inspired by Dapp University’s **Millow** project
* Thanks to the open-source Ethereum & Hardhat communities
