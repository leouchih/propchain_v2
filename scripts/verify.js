const { run } = require("hardhat");
const deploymentInfo = require('../deployments/sepolia.json'); // Adjust network as needed

async function main() {
  console.log("Verifying contracts on Etherscan...");
  
  try {
    // Verify RealEstate contract
    console.log("Verifying RealEstate contract...");
    await run("verify:verify", {
      address: deploymentInfo.realEstate.address,
      constructorArguments: []
    });
    console.log("✅ RealEstate contract verified");

    // Verify Escrow contract
    console.log("Verifying Escrow contract...");
    await run("verify:verify", {
      address: deploymentInfo.escrow.address,
      constructorArguments: [
        deploymentInfo.realEstate.address,
        deploymentInfo.deployer,
        deploymentInfo.inspector,
        deploymentInfo.lender
      ]
    });
    console.log("✅ Escrow contract verified");

  } catch (error) {
    console.error("Verification failed:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
