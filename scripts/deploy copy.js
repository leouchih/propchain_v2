const hre = require("hardhat");
const { ethers } = require("hardhat");

const tokens = (n) => {
  return ethers.utils.parseUnits(n.toString(), "ether");
};

async function main() {
  console.log("Starting enhanced contract deployment...\n");
  
  // Setup accounts
  const [deployer, seller, inspector, lender, buyer, feeRecipient] = await ethers.getSigners();
  
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH\n");

  // Deploy Enhanced Real Estate Contract
  console.log("Deploying Enhanced Real Estate Contract...");
  const RealEstate = await ethers.getContractFactory("RealEstate");
  const realEstate = await RealEstate.deploy();
  await realEstate.deployed();
  
  console.log(`Enhanced Real Estate Contract deployed at: ${realEstate.address}`);
  
  // Authorize seller as minter
  console.log("Authorizing seller as minter...");
  const MINTER_ROLE = await realEstate.MINTER_ROLE();
  await realEstate.grantRole(MINTER_ROLE, seller.address);
  
  console.log("Minting properties with enhanced metadata...\n");

  // Enhanced property data
  const properties = [
    {
      propertyType: "residential",
      squareFootage: 2500,
      location: "San Francisco, CA",
      yearBuilt: 2020,
      bedrooms: 3,
      bathrooms: 2,
      isActive: true,
      createdAt: 0 // Will be set by contract
    },
    {
      propertyType: "commercial",
      squareFootage: 5000,
      location: "New York, NY", 
      yearBuilt: 2018,
      bedrooms: 0,
      bathrooms: 4,
      isActive: true,
      createdAt: 0
    },
    {
      propertyType: "residential",
      squareFootage: 1800,
      location: "Austin, TX",
      yearBuilt: 2019,
      bedrooms: 2,
      bathrooms: 2,
      isActive: true,
      createdAt: 0
    }
  ];

  // Mint properties with enhanced metadata
  for (let i = 0; i < 3; i++) {
    try {
      const transaction = await realEstate.connect(seller)[
        "mint(address,string,(string,uint256,string,uint256,uint256,uint256,bool,uint256))"
      ](
        seller.address,
        `ipfs://QmQVcpsjrA6cr1iJjZAodYwmPekYgbnXGo4DFubJiLc2EB/${i + 1}.json`,
        properties[i]
      );
      await transaction.wait();
      console.log(`Minted property ${i + 1} with enhanced metadata`);
    } catch (error) {
      console.error(`Error minting property ${i + 1}:`, error.message);

      const transaction = await realEstate.connect(seller)[
        "mint(string)"
      ](`ipfs://QmQVcpsjrA6cr1iJjZAodYwmPekYgbnXGo4DFubJiLc2EB/${i + 1}.json`);
      await transaction.wait();
      console.log(`Minted property ${i + 1} with basic metadata`);
    }
  }

  // Deploy Enhanced Escrow Contract
  console.log("\nDeploying Enhanced Escrow Contract...");
  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(
    realEstate.address,
    seller.address,
    inspector.address,
    lender.address,
    feeRecipient.address
  );
  await escrow.deployed();

  console.log(`Enhanced Escrow Contract deployed at: ${escrow.address}`);
  console.log(`Listing properties with enhanced conditions...\n`);

  // Approve properties for escrow
  for (let i = 1; i <= 3; i++) {
    let transaction = await realEstate
      .connect(seller)
      .approve(escrow.address, i);
    await transaction.wait();
    console.log(`Approved property ${i} for escrow`);
  }

const latestBlock = await ethers.provider.getBlock("latest");
const now = latestBlock.timestamp;

  // Enhanced sale conditions
  const saleConditions = [
    {
      inspectionPeriod: 7 * 24 * 60 * 60, // 7 days in seconds
      financingPeriod: 30 * 24 * 60 * 60, // 30 days in seconds
      requiresInspection: true,
      requiresFinancing: true,
      listingExpiry: now + 90 * 24 * 60 * 60
    },
    {
      inspectionPeriod: 14 * 24 * 60 * 60, // 14 days
      financingPeriod: 45 * 24 * 60 * 60, // 45 days
      requiresInspection: true,
      requiresFinancing: true,
      listingExpiry: Math.floor(Date.now() / 1000) + (60 * 24 * 60 * 60) // 60 days from now
    },
    {
      inspectionPeriod: 10 * 24 * 60 * 60, // 10 days
      financingPeriod: 30 * 24 * 60 * 60, // 30 days
      requiresInspection: false, // Cash sale, no inspection
      requiresFinancing: false,
      listingExpiry: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days from now
    }
  ];

  const prices = [tokens(20), tokens(35), tokens(12)];
  const escrowAmounts = [tokens(2), tokens(3.5), tokens(1.2)];

  // List properties with enhanced conditions
  for (let i = 0; i < 3; i++) {
    try {
      let tx = await escrow.connect(seller)[
        "list(uint256,uint256,uint256,(uint256,uint256,bool,bool,uint256))"
      ](
        i + 1,                // nftID
        prices[i],            // purchasePrice
        escrowAmounts[i],     // escrowAmount
        saleConditions[i]     // enhanced conditions
      );
      await tx.wait();
      console.log(`Listed property ${i + 1} with enhanced conditions`);
    } catch (error) {
      console.error(`Error listing property ${i + 1}:`, error.message);
      
      // ✅ Fallback to simple listing (must use explicit signature)
      try {
        let tx = await escrow.connect(seller)[
          "list(uint256,uint256,uint256)"
        ](
          i + 1,                // nftID
          prices[i],            // purchasePrice
          escrowAmounts[i]      // escrowAmount
        );
        await tx.wait();
        console.log(`Listed property ${i + 1} with default conditions`);
      } catch (fallbackError) {
        console.error(`Failed to list property ${i + 1}:`, fallbackError.message);
      }
    }
  }

  // Demonstrate enhanced features
  console.log("\n=== Enhanced Features Demonstration ===");
  
  // Get property details
  try {
    const propertyDetails = await escrow.getPropertyDetails(1);
    console.log(`Property 1 details:`, {
      price: ethers.utils.formatEther(propertyDetails.price),
      escrow: ethers.utils.formatEther(propertyDetails.escrow),
      status: propertyDetails.status,
      listedAt: new Date(propertyDetails.listedAt * 1000).toISOString()
    });
  } catch (error) {
    console.log("Property details not available in this version");
  }
  
  // Check total supply and active properties
  try {
    const totalSupply = await realEstate.totalSupply();
    console.log(`Total properties minted: ${totalSupply}`);
    
    const activeSupply = await realEstate.totalActiveSupply();
    console.log(`Active properties: ${activeSupply}`);
  } catch (error) {
    console.log("Enhanced supply functions not available");
  }

  // Show contract addresses for frontend integration
  console.log("\n=== Contract Addresses (Save these for frontend) ===");
  console.log(`RealEstate Contract: ${realEstate.address}`);
  console.log(`Escrow Contract: ${escrow.address}`);
  console.log(`Seller Address: ${seller.address}`);
  console.log(`Inspector Address: ${inspector.address}`);
  console.log(`Lender Address: ${lender.address}`);
  console.log(`Fee Recipient Address: ${feeRecipient.address}`);

  console.log("\n=== Dev Seeding Buyer Data ===");

  const buyerAddress = process.env.BUYER_ADDR || buyer.address;
  const COMPLIANCE_ROLE = ethers.utils.id("COMPLIANCE_ROLE");

  console.log(`Granting COMPLIANCE_ROLE to deployer: ${deployer.address}`);
  await (await escrow.grantRole(COMPLIANCE_ROLE, deployer.address)).wait();

  console.log(`Allowlisting buyer: ${buyerAddress}`);
  await (await escrow.setAllowlist(buyerAddress, true)).wait();

  console.log(`Setting credential hash for buyer...`);
  await (await escrow.setCredentialHash(buyerAddress, ethers.utils.id("demo-kyc"))).wait();

  // Optional: set a short lockup for demo (e.g. 1 hour from now)
  const unlockTime = Math.floor(Date.now() / 1000) + 3600;
  await (await escrow.setUnlockAt(1, unlockTime)).wait();
  console.log(`Set unlock time for property 1: ${new Date(unlockTime * 1000).toISOString()}`);

  // Optional: register documents
  console.log(`Registering demo document hashes for property 1...`);
  await (await escrow.registerDocHash(1, await escrow.DOC_DEED(), ethers.utils.id("cid-deed"))).wait();
  await (await escrow.registerDocHash(1, await escrow.DOC_INSPECTION(), ethers.utils.id("cid-inspection"))).wait();
  await (await escrow.registerDocHash(1, await escrow.DOC_DISCLOSURE(), ethers.utils.id("cid-disclosure"))).wait();

  console.log("✅ Dev seeding complete\n");

  // Get contract balances
  console.log("\n=== Contract Balances ===");
  console.log(`Escrow contract balance: ${ethers.utils.formatEther(await escrow.getBalance())} ETH`);

  console.log("\n✅ Enhanced contract deployment completed successfully!");
  console.log("\n=== Next Steps ===");
  console.log("1. Update your frontend with the new contract addresses");
  console.log("2. Update your ABI files with the enhanced contract ABIs");
  console.log("3. Test the enhanced features like bidding, enhanced conditions, and property metadata");
  console.log("4. Configure the platform fee if needed using setPlatformFee()");
  
  return {
    realEstate: realEstate.address,
    escrow: escrow.address,
    seller: seller.address,
    inspector: inspector.address,
    lender: lender.address,
    feeRecipient: feeRecipient.address
  };
}

// Enhanced error handling
main()
  .then((addresses) => {
    console.log("\n=== Deployment Summary ===");
    console.log(JSON.stringify(addresses, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exitCode = 1;
  });