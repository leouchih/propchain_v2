const { ethers } = require("hardhat");

async function main() {
  console.log("Testing complete transaction flow on testnet...");
  
  // Load deployment info
  const deploymentInfo = require('../deployments/sepolia.json');
  const [seller, buyer] = await ethers.getSigners();
  
  // Get contract instances
  const realEstate = await ethers.getContractAt("RealEstate", deploymentInfo.realEstate.address);
  const escrow = await ethers.getContractAt("Escrow", deploymentInfo.escrow.address);
  
  console.log("Seller address:", seller.address);
  console.log("Buyer address:", buyer.address);
  
  try {
    // Step 1: Mint a property NFT
    console.log("\n1. Minting property NFT...");
    const tokenURI = "https://ipfs.io/ipfs/QmTudSYeM7mz3PkYEWXWqPjomRPHogcMFSq7XAvsvsgAPS";
    const mintTx = await realEstate.mint(seller.address, tokenURI);
    await mintTx.wait();
    const tokenId = await realEstate.totalSupply();
    console.log("✅ Property NFT minted with ID:", tokenId.toString());
    
    // Step 2: Approve escrow contract to transfer NFT
    console.log("\n2. Approving escrow contract...");
    const approveTx = await realEstate.approve(escrow.address, tokenId);
    await approveTx.wait();
    console.log("✅ Escrow contract approved");
    
    // Step 3: List property
    console.log("\n3. Listing property...");
    const purchasePrice = ethers.utils.parseEther("1.0");
    const escrowAmount = ethers.utils.parseEther("0.1");
    const listTx = await escrow.list(tokenId, purchasePrice, escrowAmount);
    await listTx.wait();
    console.log("✅ Property listed");
    
    // Step 4: Deposit earnest money (as buyer)
    console.log("\n4. Depositing earnest money...");
    const depositTx = await escrow.connect(buyer).depositEarnest(tokenId, {
      value: escrowAmount
    });
    await depositTx.wait();
    console.log("✅ Earnest money deposited");
    
    // Step 5: Get property details
    console.log("\n5. Checking property details...");
    const details = await escrow.getPropertyDetails(tokenId);
    console.log("Property details:", {
      purchasePrice: ethers.utils.formatEther(details.purchasePrice),
      escrowAmount: ethers.utils.formatEther(details.escrowAmount),
      buyer: details.buyer,
      status: details.status,
      paidAmount: ethers.utils.formatEther(details.paidAmount)
    });
    
    console.log("\n✅ Transaction flow test completed successfully!");
    console.log("\n📝 Manual steps needed:");
    console.log("1. Inspector needs to update inspection status");
    console.log("2. All parties need to approve the sale");
    console.log("3. Lender needs to fund the remaining amount");
    console.log("4. Finalize the sale");
    
  } catch (error) {
    console.error("Transaction flow test failed:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });