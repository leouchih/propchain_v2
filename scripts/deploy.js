// scripts/deploy.js
// Deploys RealEstate + Escrow. Seeds demo data only on local (31337).
//
// Supports Escrow listing APIs (old & new):
// - list(uint256,uint256,uint256,(...))                                  [old]
// - listFixedPrice(uint256,uint256,uint256,(...))                         [old alt]
// - list(uint256,uint256,uint256,address,(...))                           [new, per-property lender]
// - listFixedPrice(uint256,uint256,uint256,address,(...))                 [new alt]
//
// Sepolia/mainnet: uses only the deployer; reads participant ADDRESSES from .env.
// No mint/approve/list is attempted on testnet/mainnet.

const hre = require("hardhat");
const { ethers, network } = hre;
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const tokens = (n) => ethers.utils.parseUnits(n.toString(), "ether");

async function main() {
  const [deployer, ...rest] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const isLocal = net.chainId === 31337;

  console.log(`\nDeploying with ${deployer.address} on ${network.name} (chainId=${net.chainId})`);
  console.log(`Deployer balance: ${ethers.utils.formatEther(await deployer.getBalance())} ETH\n`);

  // ---- Resolve participant addresses ----
  const SELLER_ADDR        = isLocal ? rest[0]?.address : (process.env.SELLER_ADDR        || deployer.address);
  const INSPECTOR_ADDR     = isLocal ? rest[1]?.address : (process.env.INSPECTOR_ADDR     || deployer.address);
  const LENDER_ADDR        = isLocal ? rest[2]?.address : (process.env.LENDER_ADDR        || deployer.address);
  const FEE_RECIPIENT_ADDR = isLocal ? rest[3]?.address : (process.env.FEE_RECIPIENT_ADDR || deployer.address);

  // ---- Deploy RealEstate ----
  console.log("Deploying RealEstate…");
  const RealEstate = await ethers.getContractFactory("RealEstate");
  const realEstate = await RealEstate.deploy();
  await realEstate.deployed();
  console.log("✓ RealEstate:", realEstate.address);

  // ---- Grant mint permission to seller (handles multiple APIs) ----
  try {
    if (realEstate.functions.setAuthorizedMinter) {
      await (await realEstate.setAuthorizedMinter(SELLER_ADDR, true)).wait();
      console.log(`✓ setAuthorizedMinter(${SELLER_ADDR}, true)`);
    } else if (realEstate.functions.MINTER_ROLE && realEstate.functions.grantRole) {
      const MINTER_ROLE = await realEstate.MINTER_ROLE();
      await (await realEstate.grantRole(MINTER_ROLE, SELLER_ADDR)).wait();
      console.log(`✓ grantRole(MINTER_ROLE, ${SELLER_ADDR})`);
    } else {
      console.log("ℹ️ RealEstate has no detectable minter function; skipping mint grant.");
    }
  } catch (e) {
    console.log("⚠️ Could not grant minter permission:", e.message);
  }

  // ---- Deploy Escrow ----
  console.log("Deploying Escrow…");
  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(
    realEstate.address,
    SELLER_ADDR,
    INSPECTOR_ADDR,
    LENDER_ADDR,
    FEE_RECIPIENT_ADDR
  );
  await escrow.deployed();
  console.log("✓ Escrow:", escrow.address);

  // ---- Write addresses to frontend config ----
  await writeConfig(net.chainId, realEstate.address, escrow.address);

  // ---- Seed demo data only on local ----
  if (isLocal) {
    console.log("\nSeeding local demo data…");
    const sellerSigner = rest[0];
    if (!sellerSigner) {
      console.log("⚠️ No seller signer available; skipping local seed.");
    } else {
      // helper: list with ABI fallback
      const listWithFallback = async (tokenId, price, escrowAmt, lenderAddr, cond) => {
        // Candidate function signatures (new first)
        const candidates = [
          "list(uint256,uint256,uint256,address,(uint256,uint256,bool,bool,uint256))",
          "listFixedPrice(uint256,uint256,uint256,address,(uint256,uint256,bool,bool,uint256))",
          "list(uint256,uint256,uint256,(uint256,uint256,bool,bool,uint256))",
          "listFixedPrice(uint256,uint256,uint256,(uint256,uint256,bool,bool,uint256))",
        ];

        for (const sig of candidates) {
          try {
            // Build arg list based on signature arity
            if (sig.includes("address,(")) {
              // needs lender address
              const tx = await escrow.connect(sellerSigner)[sig](tokenId, price, escrowAmt, lenderAddr, cond);
              await tx.wait();
              console.log(`✓ Listed #${tokenId} via ${sig}`);
              return;
            } else {
              // legacy signature (no lender address)
              const tx = await escrow.connect(sellerSigner)[sig](tokenId, price, escrowAmt, cond);
              await tx.wait();
              console.log(`✓ Listed #${tokenId} via ${sig}`);
              return;
            }
          } catch (e) {
            // Try next candidate
            if (!/is not a function|missing argument/i.test(e.message)) {
              // If it's a different error (e.g., require failed), surface it
              console.log(`  ↳ Attempt with ${sig} failed: ${e.message}`);
            }
          }
        }
        throw new Error("No compatible list() function found on Escrow.");
      };

      // Try minting 3 tokens as seller (use simple mint if available)
      for (let i = 1; i <= 3; i++) {
        try {
          // Mint token (if RealEstate has mint(string))
          let minted = false;
          try {
            if (realEstate.functions["mint(string)"]) {
              await (await realEstate.connect(sellerSigner)["mint(string)"](
                `ipfs://QmQVcpsjrA6cr1iJjZAodYwmPekYgbnXGo4DFubJiLc2EB/${i}.json`
              )).wait();
              console.log(`✓ Minted token #${i}`);
              minted = true;
            }
          } catch (e) {
            console.log(`ℹ️ RealEstate.mint(string) not available: ${e.message}`);
          }

          if (!minted) {
            // If your RealEstate uses a different mint API, add another branch here.
            console.log(`ℹ️ Skipping mint for #${i} (no compatible mint function)`);
          }

          // Approve to Escrow
          try {
            await (await realEstate.connect(sellerSigner).approve(escrow.address, i)).wait();
            console.log(`✓ Approved #${i} to Escrow`);
          } catch (e) {
            console.log(`⚠️ Approve #${i} failed: ${e.message}`);
            continue; // can't list without approval
          }

          // Build sale conditions
          const { timestamp: now } = await ethers.provider.getBlock("latest");
          const cond = {
            inspectionPeriod: 7 * 24 * 60 * 60,
            financingPeriod: 30 * 24 * 60 * 60,
            requiresInspection: true,
            requiresFinancing: true,
            listingExpiry: now + 90 * 24 * 60 * 60,
          };

          // Price & escrow for demo
          const priceWei = tokens(10 + i * 5);   // e.g., 15, 20, 25 ETH
          const escrowWei = tokens(1 + i * 0.5); // e.g., 1.5, 2.0, 2.5 ETH

          // List with ABI fallback (per-property lender preferred)
          try {
            await listWithFallback(i, priceWei, escrowWei, LENDER_ADDR, cond);
          } catch (e) {
            console.log(`⚠️ List for #${i} skipped: ${e.message}`);
          }
        } catch (e) {
          console.log(`⚠️ Mint/list seed for #${i} skipped: ${e.message}`);
        }
      }

      // Seed compliance for a demo buyer
      const demoBuyer = rest[4]?.address;
      if (demoBuyer) {
        try {
          if (escrow.functions.setAllowlist) {
            await (await escrow.setAllowlist(demoBuyer, true)).wait();
            console.log(`✓ Allowlisted buyer ${demoBuyer}`);
          }
          if (escrow.functions.setCredentialHash) {
            await (await escrow.setCredentialHash(demoBuyer, ethers.utils.id("demo-kyc"))).wait();
            console.log(`✓ Set credential hash for buyer ${demoBuyer}`);
          }
        } catch (e) {
          console.log("⚠️ Compliance seed failed:", e.message);
        }
      }
    }
  } else {
    console.log("\nℹ️ Testnet/mainnet deploy: skipping mint/approve/list demo seed.");
    console.log("   The SELLER wallet should mint NFTs and approve Escrow later via the dapp.");
  }

  // ---- Summary ----
  console.log("\n=== Deployment Summary ===");
  console.log(JSON.stringify({
    chainId: net.chainId,
    realEstate: realEstate.address,
    escrow: escrow.address,
    seller: SELLER_ADDR,
    inspector: INSPECTOR_ADDR,
    lender: LENDER_ADDR,
    feeRecipient: FEE_RECIPIENT_ADDR,
  }, null, 2));
  console.log("\nDone ✅");
}

async function writeConfig(chainId, realEstateAddr, escrowAddr) {
  const cfgPath = path.join(__dirname, "..", "src", "config.json");
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch {}
  cfg[String(chainId)] = {
    realEstate: { address: realEstateAddr },
    escrow:     { address: escrowAddr },
  };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  console.log(`✓ Wrote addresses for chain ${chainId} to ${cfgPath}`);
}

main().catch((e) => {
  console.error("\n❌ Deployment failed:");
  console.error(e);
  process.exit(1);
});
