const hre = require("hardhat");
const { ethers, network } = hre;
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  const REALESTATE_ADDRESS = process.env.REALESTATE_ADDRESS;
  if (!REALESTATE_ADDRESS) throw new Error("Set REALESTATE_ADDRESS in .env");

  const SELLER_ADDR        = process.env.SELLER_ADDR        || deployer.address;
  const INSPECTOR_ADDR     = process.env.INSPECTOR_ADDR     || deployer.address;
  const LENDER_ADDR        = process.env.LENDER_ADDR        || deployer.address;
  const FEE_RECIPIENT_ADDR = process.env.FEE_RECIPIENT_ADDR || deployer.address;

  console.log(`Deploying Escrow on ${network.name} by ${deployer.address}`);
  console.log("Using RealEstate:", REALESTATE_ADDRESS);

  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(
    REALESTATE_ADDRESS,
    SELLER_ADDR,
    INSPECTOR_ADDR,
    LENDER_ADDR,
    FEE_RECIPIENT_ADDR
  );
  await escrow.deployed();

  console.log("Escrow:", escrow.address);

  // (optional) verify
  if (net.chainId !== 31337) {
    try {
      await hre.run("verify:verify", {
        address: escrow.address,
        constructorArguments: [
          REALESTATE_ADDRESS, SELLER_ADDR, INSPECTOR_ADDR, LENDER_ADDR, FEE_RECIPIENT_ADDR
        ],
      });
      console.log("✓ verified");
    } catch (e) {
      console.log("verify skipped:", e.message);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
