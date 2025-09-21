// scripts/grant-roles.js
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers, network } = hre;

function readConfigAddressesByChainId(chainId) {
  try {
    const p = path.join(__dirname, "..", "src", "config.json");
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    const entry = json[String(chainId)];
    if (!entry) return {};
    return {
      escrow: entry.escrow?.address,
      realEstate: entry.realEstate?.address,
    };
  } catch {
    return {};
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`Using deployer: ${deployer.address} on ${network.name} (chainId=${net.chainId})`);

  // 1) Resolve from config.json (preferred), fallback to .env
  const fromConfig = readConfigAddressesByChainId(net.chainId);
  const ESCROW_ADDRESS     = process.env.ESCROW_ADDRESS     || fromConfig.escrow;
  const REALESTATE_ADDRESS = process.env.REALESTATE_ADDRESS || fromConfig.realEstate;

  if (!ESCROW_ADDRESS || !REALESTATE_ADDRESS) {
    throw new Error("Missing contract addresses. Ensure deploy wrote src/config.json, or set ESCROW_ADDRESS/REALESTATE_ADDRESS in .env.");
  }

  const escrow     = await ethers.getContractAt("Escrow", ESCROW_ADDRESS, deployer);
  const realEstate = await ethers.getContractAt("RealEstate", REALESTATE_ADDRESS, deployer);

  // Sanity-check addresses have code
  for (const [label, addr] of Object.entries({
    Escrow: ESCROW_ADDRESS,
    RealEstate: REALESTATE_ADDRESS,
  })) {
    const code = await ethers.provider.getCode(addr);
    if (code === "0x") {
      throw new Error(`${label} address ${addr} has NO CODE on ${network.name}. Check src/config.json or .env overrides.`);
    }
  }
  console.log("== Using addresses ==");
  console.log({
    ESCROW_ADDRESS, 
    REALESTATE_ADDRESS,
    source: {
      envEscrow: !!process.env.ESCROW_ADDRESS,
      envRealEstate: !!process.env.REALESTATE_ADDRESS
    }
  });


  // 2) Role IDs
  const ADMIN_ROLE      = await escrow.ADMIN_ROLE();
  const PAUSER_ROLE     = await escrow.PAUSER_ROLE();
  const TREASURER_ROLE  = await escrow.TREASURER_ROLE();
  const EMERGENCY_ROLE  = await escrow.EMERGENCY_ROLE();
  const COMPLIANCE_ROLE = await escrow.COMPLIANCE_ROLE();

  const RE_ADMIN_ROLE = await realEstate.ADMIN_ROLE();
  const MINTER_ROLE   = await realEstate.MINTER_ROLE();
  const METADATA_ROLE = await realEstate.METADATA_ROLE();

  // 3) Target role holders from .env (use your 6 real wallets here)
  const adminAddr     = process.env.ADMIN_ADDR;
  const pauserAddr    = process.env.PAUSER_ADDR;
  const treasurerAddr = process.env.TREASURER_ADDR;
  const guardAddr     = process.env.GUARD_ADDR;      // emergency
  const sellerAddr    = process.env.SELLER_ADDR;     // minter on RealEstate
  const curatorAddr   = process.env.CURATOR_ADDR;    // metadata on RealEstate

  if (!adminAddr) throw new Error("Set ADMIN_ADDR in .env (your real wallet).");

  console.log("== Addresses ==");
  console.log({ ESCROW_ADDRESS, REALESTATE_ADDRESS });
  console.log("== Role Targets ==");
  console.log({ adminAddr, pauserAddr, treasurerAddr, guardAddr, sellerAddr, curatorAddr });

  // 4) Helper
  const grantIfNeeded = async (contract, role, who, label) => {
    if (!who) return;
    const has = await contract.hasRole(role, who);
    if (has) {
      console.log(`✓ ${label}: ${who} already has role`);
    } else {
      const tx = await contract.grantRole(role, who);
      await tx.wait();
      console.log(`+ ${label}: granted to ${who}`);
    }
  };

  // 5) Ensure deployer can grant (must have admin role on both contracts)
  // Read the role IDs FIRST, then use them.
  const DEFAULT_ADMIN_ROLE_ESCROW = await escrow.DEFAULT_ADMIN_ROLE();

  // Some implementations expose DEFAULT_ADMIN_ROLE on ERC-roles contracts too.
  // If not, fall back to your explicit RE_ADMIN_ROLE.
  const DEFAULT_ADMIN_ROLE_RE =
    (await realEstate.DEFAULT_ADMIN_ROLE?.().catch(() => null)) || null;

  const canGrantEscrow = await escrow.hasRole(
    DEFAULT_ADMIN_ROLE_ESCROW,
    deployer.address
  );

  const canGrantRE = DEFAULT_ADMIN_ROLE_RE
    ? await realEstate.hasRole(DEFAULT_ADMIN_ROLE_RE, deployer.address)
    : await realEstate.hasRole(RE_ADMIN_ROLE, deployer.address);

  if (!canGrantEscrow) {
    console.warn(
      "⚠ Deployer lacks DEFAULT_ADMIN_ROLE on Escrow. Run this with the deployer or grant once from that account."
    );
  }
  if (!canGrantRE) {
    console.warn(
      "⚠ Deployer lacks admin role on RealEstate. Run this with the deployer or grant once from that account."
    );
  }

  console.log("\nGranting roles on Escrow...");
  await grantIfNeeded(escrow, ADMIN_ROLE,      adminAddr,     "ESCROW.ADMIN_ROLE");
  await grantIfNeeded(escrow, PAUSER_ROLE,     pauserAddr,    "ESCROW.PAUSER_ROLE");
  await grantIfNeeded(escrow, TREASURER_ROLE,  treasurerAddr, "ESCROW.TREASURER_ROLE");
  await grantIfNeeded(escrow, EMERGENCY_ROLE,  guardAddr,     "ESCROW.EMERGENCY_ROLE");
  await grantIfNeeded(escrow, COMPLIANCE_ROLE, adminAddr,     "ESCROW.COMPLIANCE_ROLE");

  console.log("\nGranting roles on RealEstate...");
  await grantIfNeeded(realEstate, RE_ADMIN_ROLE, adminAddr,   "REALESTATE.ADMIN_ROLE");
  await grantIfNeeded(realEstate, MINTER_ROLE,   sellerAddr,  "REALESTATE.MINTER_ROLE");
  await grantIfNeeded(realEstate, METADATA_ROLE, curatorAddr, "REALESTATE.METADATA_ROLE");

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
