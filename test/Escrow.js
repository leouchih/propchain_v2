const { expect } = require("chai");
const { ethers } = require("hardhat");

const tokens = (n) => ethers.utils.parseUnits(n.toString(), "ether");

const seedKYC = async (escrowContract, addr) => {
  await escrowContract.setAllowlist(addr, true);
  await escrowContract.setCredentialHash(addr, ethers.utils.id("demo-kyc"));
};

const clearKYC = async (escrowContract, addr) => {
  await escrowContract.setAllowlist(addr, false);
  await escrowContract.setCredentialHash(addr, ethers.constants.HashZero);
};

describe("Enhanced Escrow", () => {
  let buyer, seller, inspector, lender, feeRecipient, otherBuyer;
  let realEstate, escrow;
  const tokenId = 1;
  const purchasePrice = tokens(10);
  const escrowAmount = tokens(5);

  // Mirror on-chain enum order
  const PropertyStatus = {
    NotListed: 0,
    Listed: 1,
    UnderContract: 2,
    InspectionPending: 3,
    AwaitingApprovals: 4,
    ReadyToClose: 5,
    Sold: 6,
    Cancelled: 7
  };

  beforeEach(async () => {
    [buyer, seller, inspector, lender, feeRecipient, otherBuyer] = await ethers.getSigners();

    // Deploy RealEstate
    const RealEstate = await ethers.getContractFactory("RealEstate");
    realEstate = await RealEstate.deploy();

    // Authorize seller and mint #1
    await (await realEstate.setAuthorizedMinter(seller.address, true)).wait();
    await (
      await realEstate
        .connect(seller)
        ["mint(string)"]("https://ipfs.io/ipfs/QmTudSYeM7mz3PkYEWXWqPjomRPHogcMFSq7XAvsvsgAPS")
    ).wait();

    // Deploy Escrow (owner = deployer = buyer)
    const Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.deploy(
      realEstate.address,
      seller.address,
      inspector.address,
      lender.address,
      feeRecipient.address
    );

    // Approve Escrow to transfer the NFT
    await (await realEstate.connect(seller).approve(escrow.address, tokenId)).wait();

    // Block timestamp for listing expiry
    const { timestamp: now } = await ethers.provider.getBlock("latest");

    const saleConditions = {
      inspectionPeriod: 7 * 24 * 60 * 60,
      financingPeriod: 30 * 24 * 60 * 60,
      requiresInspection: true,
      requiresFinancing: true,
      listingExpiry: now + 90 * 24 * 60 * 60
    };

    // List as FixedPrice by using the (uint,uint,uint,SaleConditions) overload
    await (
      await escrow.connect(seller)[
        "list(uint256,uint256,uint256,(uint256,uint256,bool,bool,uint256))"
      ](tokenId, purchasePrice, escrowAmount, saleConditions)
    ).wait();
  });

  describe("Deployment", () => {
    it("Returns NFT address", async () => {
      expect(await escrow.nftAddress()).to.equal(realEstate.address);
    });

    it("Returns seller", async () => {
      expect(await escrow.getSeller()).to.equal(seller.address);
    });

    it("Returns inspector", async () => {
      expect(await escrow.inspector()).to.equal(inspector.address);
    });

    it("Returns lender", async () => {
      expect(await escrow.lender()).to.equal(lender.address);
    });

    it("Returns fee recipient", async () => {
      expect(await escrow.feeRecipient()).to.equal(feeRecipient.address);
    });

    it("Returns platform fee", async () => {
      expect(await escrow.platformFee()).to.equal(250);
    });
  });

  describe("Enhanced Listing", () => {
    it("Updates property status to Listed", async () => {
      const details = await escrow.getPropertyDetails(tokenId);
      expect(details.status).to.equal(PropertyStatus.Listed);
    });

    it("Returns purchase price", async () => {
      const details = await escrow.getPropertyDetails(tokenId);
      expect(details.price).to.equal(purchasePrice);
    });

    it("Returns escrow amount", async () => {
      const details = await escrow.getPropertyDetails(tokenId);
      expect(details.escrow).to.equal(escrowAmount);
    });

    it("Updates ownership to contract", async () => {
      expect(await realEstate.ownerOf(tokenId)).to.equal(escrow.address);
    });

    it("Sets sale conditions correctly", async () => {
      const details = await escrow.getPropertyDetails(tokenId);
      expect(details.conditions.requiresInspection).to.equal(true);
      expect(details.conditions.requiresFinancing).to.equal(true);
    });

    it("Should not allow listing expired properties", async () => {
      await ethers.provider.send("evm_increaseTime", [91 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");

      await expect(
        escrow.connect(buyer).depositEarnest(tokenId, { value: escrowAmount })
      ).to.be.revertedWithCustomError(escrow, "ListingExpired");
    });
  });

  // ----------------------
  // BIDDING SUITE (Auction)
  // ----------------------
  describe("Bidding System (Auction listing)", () => {
    beforeEach(async () => {
      // Cancel the FixedPrice listing and relist as Auction
      await (await escrow.connect(seller).cancelSale(tokenId, "relist as auction")).wait();
      await (await realEstate.connect(seller).approve(escrow.address, tokenId)).wait();

      // Set auction min bid to 5 ETH so tests' 5/7/8 bids are valid
      const minBid = tokens(5);

      await (
        await escrow.connect(seller)["list(uint256,uint256,uint256,uint8)"](
          tokenId,
          minBid,        // minimum acceptable bid
          escrowAmount,  // must be <= minBid (here, 5 <= 5)
          1              // Auction
        )
      ).wait();
    });

    it("Allows placing bids", async () => {
      await seedKYC(escrow, buyer.address);
      await (await escrow.connect(buyer).placeBid(tokenId, { value: tokens(5) })).wait();
      const bidAmount = await escrow.getBidAmount(tokenId, buyer.address);
      expect(bidAmount).to.equal(tokens(5));
    });

    it("Tracks multiple bidders", async () => {
      await seedKYC(escrow, buyer.address);
      await seedKYC(escrow, otherBuyer.address);
      await (await escrow.connect(buyer).placeBid(tokenId, { value: tokens(5) })).wait();
      await (await escrow.connect(otherBuyer).placeBid(tokenId, { value: tokens(7) })).wait();

      const bidders = await escrow.getBidders(tokenId);
      expect(bidders).to.include(buyer.address);
      expect(bidders).to.include(otherBuyer.address);
    });

    it("Returns highest bid correctly", async () => {
      await seedKYC(escrow, buyer.address);
      await seedKYC(escrow, otherBuyer.address);
      await (await escrow.connect(buyer).placeBid(tokenId, { value: tokens(5) })).wait();
      await (await escrow.connect(otherBuyer).placeBid(tokenId, { value: tokens(8) })).wait();

      const [highestBidder, highestAmount] = await escrow.getHighestBid(tokenId);
      expect(highestBidder).to.equal(otherBuyer.address);
      expect(highestAmount).to.equal(tokens(8));
    });

    it("Allows bid withdrawal", async () => {
      await seedKYC(escrow, buyer.address);
      await (await escrow.connect(buyer).placeBid(tokenId, { value: tokens(5) })).wait();

      const initial = await buyer.getBalance();
      const tx = await escrow.connect(buyer).withdrawBid(tokenId);
      const receipt = await tx.wait();
      const gas = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const finalBal = await buyer.getBalance();

      // Refund should be exactly the bid (5 ETH), minus gas
      expect(finalBal.add(gas)).to.be.closeTo(initial.add(tokens(5)), tokens(0.01));
    });

    it("Allows seller to accept bids (Deposit + Lender path)", async () => {
      await seedKYC(escrow, buyer.address);
      await (await escrow.connect(buyer).placeBid(tokenId, { value: tokens(5) })).wait();

      // acceptBid(uint256,address,PaymentMethod) — 1 = DepositAndLender
      await (await escrow.connect(seller).acceptBid(tokenId, buyer.address, 1)).wait();

      const details = await escrow.getPropertyDetails(tokenId);
      expect(details.currentBuyer).to.equal(buyer.address);
      expect(details.status).to.equal(PropertyStatus.UnderContract);
    });
  });

  describe("Traditional Earnest Money Deposits", () => {
    beforeEach(async () => {
      await seedKYC(escrow, buyer.address);
    });

    it("Accepts earnest money deposits", async () => {
      await (await escrow.connect(buyer).depositEarnest(tokenId, { value: escrowAmount })).wait();
      const d = await escrow.getPropertyDetails(tokenId);
      expect(d.currentBuyer).to.equal(buyer.address);
      expect(d.paid).to.equal(escrowAmount);
      expect(d.status).to.equal(PropertyStatus.UnderContract);
    });

    it("Updates contract balance", async () => {
      await (await escrow.connect(buyer).depositEarnest(tokenId, { value: escrowAmount })).wait();
      expect(await escrow.getBalance()).to.equal(escrowAmount);
    });
  });

  describe("Enhanced Inspection Process", () => {
    beforeEach(async () => {
      await seedKYC(escrow, buyer.address);
      await (await escrow.connect(buyer).depositEarnest(tokenId, { value: escrowAmount })).wait();
    });

    it("Updates inspection status and timing", async () => {
      await (await escrow.connect(inspector).updateInspectionStatus(tokenId, true)).wait();
      const d = await escrow.getPropertyDetails(tokenId);
      expect(d.inspectionStatus).to.equal(true);
      expect(d.status).to.equal(PropertyStatus.AwaitingApprovals);
    });

    it("Handles failed inspection", async () => {
      await (await escrow.connect(inspector).updateInspectionStatus(tokenId, false)).wait();
      const d = await escrow.getPropertyDetails(tokenId);
      expect(d.inspectionStatus).to.equal(false);
      expect(d.status).to.equal(PropertyStatus.InspectionPending);
    });

    it("Checks inspection period expiry", async () => {
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      await expect(
        escrow.connect(inspector).updateInspectionStatus(tokenId, true)
      ).to.be.revertedWithCustomError(escrow, "InspectionPeriodExpired");
    });
  });

  describe("Enhanced Approval System", () => {
    beforeEach(async () => {
      await seedKYC(escrow, buyer.address);
      // Select Deposit+Lender path
      await (await escrow.connect(buyer).purchaseWithDeposit(tokenId, { value: escrowAmount })).wait();
      await (await escrow.connect(inspector).updateInspectionStatus(tokenId, true)).wait();
    });

    it("Tracks individual approvals", async () => {
      await (await escrow.connect(buyer).approveSale(tokenId)).wait();
      await (await escrow.connect(seller).approveSale(tokenId)).wait();
      await (await escrow.connect(lender).approveSale(tokenId)).wait();

      const [bOK, sOK, lOK] = await escrow.getApprovalStatus(tokenId);
      expect(bOK).to.equal(true);
      expect(sOK).to.equal(true);
      expect(lOK).to.equal(true);
    });

    it("Updates status to ReadyToClose when all approve", async () => {
      await (await escrow.connect(buyer).approveSale(tokenId)).wait();
      await (await escrow.connect(seller).approveSale(tokenId)).wait();
      await (await escrow.connect(lender).approveSale(tokenId)).wait();

      const d = await escrow.getPropertyDetails(tokenId);
      expect(d.status).to.equal(PropertyStatus.ReadyToClose);
    });
  });

  describe("Lender Funding with Timing", () => {
    beforeEach(async () => {
      await seedKYC(escrow, buyer.address);
      await (await escrow.connect(buyer).purchaseWithDeposit(tokenId, { value: escrowAmount })).wait();
      await (await escrow.connect(inspector).updateInspectionStatus(tokenId, true)).wait();
    });

    it("Accepts lender funding", async () => {
      await (await escrow.connect(lender).fundByLender(tokenId, { value: tokens(5) })).wait();
      const d = await escrow.getPropertyDetails(tokenId);
      expect(d.paid).to.equal(tokens(10));
    });

    it("Checks financing period expiry", async () => {
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      await expect(
        escrow.connect(lender).fundByLender(tokenId, { value: tokens(5) })
      ).to.be.revertedWithCustomError(escrow, "FinancingPeriodExpired");
    });
  });

  describe("Enhanced Sale Finalization", () => {
    beforeEach(async () => {
      await seedKYC(escrow, buyer.address);
      await (await escrow.connect(buyer).purchaseWithDeposit(tokenId, { value: escrowAmount })).wait();
      await (await escrow.connect(inspector).updateInspectionStatus(tokenId, true)).wait();

      await (await escrow.connect(buyer).approveSale(tokenId)).wait();
      await (await escrow.connect(lender).approveSale(tokenId)).wait();
      await (await escrow.connect(lender).fundByLender(tokenId, { value: tokens(5) })).wait();
      await (await escrow.connect(seller).approveSale(tokenId)).wait();

      // Compliance + unlock
      await escrow.setAllowlist(buyer.address, true);
      await escrow.setCredentialHash(buyer.address, ethers.utils.id("demo-kyc"));
      await escrow.setUnlockAt(tokenId, 0);
    });

    it("Finalizes sale with fee calculation", async () => {
      const initialSeller = await seller.getBalance();
      const initialFee = await feeRecipient.getBalance();

      await (await escrow.connect(seller).finalizeSale(tokenId)).wait();

      expect(await realEstate.ownerOf(tokenId)).to.equal(buyer.address);

      const d = await escrow.getPropertyDetails(tokenId);
      expect(d.status).to.equal(PropertyStatus.Sold);

      const expectedFee = tokens(10).mul(250).div(10000); // 0.25 ETH on 10 ETH
      const finalFee = await feeRecipient.getBalance();
      expect(finalFee.sub(initialFee)).to.equal(expectedFee);

      expect(await escrow.getBalance()).to.equal(0);
    });
  });

  describe("Escrow Phase-1: compliance only (no docs)", function () {
    beforeEach(async () => {
      await seedKYC(escrow, buyer.address);
      // 1) Buyer chooses deposit+lender
      await escrow.connect(buyer).purchaseWithDeposit(tokenId, { value: escrowAmount });

      // 2) Inspector passes → status = AwaitingApprovals
      await escrow.connect(inspector).updateInspectionStatus(tokenId, true);

      // 3) Partial approvals (NOT all)
      await escrow.connect(buyer).approveSale(tokenId);

      // 4) Lender funds while still AwaitingApprovals (also sets lender approval = true)
      await escrow.connect(lender).fundByLender(tokenId, { value: purchasePrice.sub(escrowAmount) });

      // 5) Seller approval completes the triad → flips to ReadyToClose.
      await escrow.connect(seller).approveSale(tokenId);

      const d = await escrow.getPropertyDetails(tokenId);
      expect(d.status).to.equal(PropertyStatus.ReadyToClose);
    });

    it("blocks finalizeSale when allowlist/credential/lockup not satisfied; succeeds when satisfied", async () => {
      // Reset compliance so the first check fails on allowlist
      await escrow.setAllowlist(buyer.address, false);
      await escrow.setCredentialHash(buyer.address, ethers.constants.HashZero);

      // Missing allowlist
      await expect(escrow.connect(seller).finalizeSale(tokenId))
        .to.be.revertedWithCustomError(escrow, "TRANSFER_NOT_ALLOWED");

      // Allowlisted but missing credential
      await escrow.setAllowlist(buyer.address, true);
      await expect(escrow.connect(seller).finalizeSale(tokenId))
        .to.be.revertedWithCustomError(escrow, "MISSING_CREDENTIAL");

      // Lockup active
      await escrow.setCredentialHash(buyer.address, ethers.utils.id("demo-kyc"));
      const future = (await ethers.provider.getBlock("latest")).timestamp + 3600;
      await escrow.setUnlockAt(tokenId, future);
      await expect(escrow.connect(seller).finalizeSale(tokenId))
        .to.be.revertedWithCustomError(escrow, "LOCKUP_ACTIVE");

      // Unlock and succeed
      await escrow.setUnlockAt(tokenId, 0);
      await expect(escrow.connect(seller).finalizeSale(tokenId)).to.not.be.reverted;
    });
  });

  describe("Enhanced Cancellation System", () => {
    beforeEach(async () => {
      await seedKYC(escrow, buyer.address);
      await (await escrow.connect(buyer).depositEarnest(tokenId, { value: escrowAmount })).wait();
    });

    it("Allows seller to cancel with full refund", async () => {
      const before = await buyer.getBalance();
      await (await escrow.connect(seller).cancelSale(tokenId, "Seller changed mind")).wait();
      const after = await buyer.getBalance();
      expect(after).to.be.gt(before);
      const d = await escrow.getPropertyDetails(tokenId);
      expect(d.status).to.equal(PropertyStatus.Cancelled);
    });

    it("Handles buyer cancellation after inspection passes", async () => {
      await (await escrow.connect(inspector).updateInspectionStatus(tokenId, true)).wait();
      const sBefore = await seller.getBalance();
      await (await escrow.connect(buyer).cancelSale(tokenId, "Buyer backing out")).wait();
      const sAfter = await seller.getBalance();
      expect(sAfter).to.be.gt(sBefore);
    });
  });

  describe("Property Status Queries", () => {
    it("Checks listing expiry", async () => {
      expect(await escrow.isListingExpired(tokenId)).to.equal(false);
      await ethers.provider.send("evm_increaseTime", [91 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      expect(await escrow.isListingExpired(tokenId)).to.equal(true);
    });

    it("Gets property balance correctly", async () => {
      // Relist as auction
      await (await escrow.connect(seller).cancelSale(tokenId, "relist as auction")).wait();
      await (await realEstate.connect(seller).approve(escrow.address, tokenId)).wait();

      await (
        await escrow.connect(seller)["list(uint256,uint256,uint256,uint8)"](
          tokenId,
          tokens(5),    // min bid = 5 ETH
          escrowAmount, // <= 5 ETH
          1             // Auction
        )
      ).wait();
      await seedKYC(escrow, buyer.address);
      await seedKYC(escrow, otherBuyer.address);
      await (await escrow.connect(buyer).placeBid(tokenId, { value: tokens(6) })).wait();
      await (await escrow.connect(otherBuyer).placeBid(tokenId, { value: tokens(7) })).wait();

      expect(await escrow.getPropertyBalance(tokenId)).to.equal(tokens(13));
    });
  });

  describe("Admin Functions", () => {
    beforeEach(async () => {
      await seedKYC(escrow, buyer.address);
    });

    it("Allows owner to update platform fee", async () => {
      const newFee = 300;
      await (await escrow.setPlatformFee(newFee)).wait(); // owner is deployer (buyer)
      expect(await escrow.platformFee()).to.equal(newFee);
    });

    it("Allows owner to update fee recipient", async () => {
      await (await escrow.setFeeRecipient(buyer.address)).wait();
      expect(await escrow.feeRecipient()).to.equal(buyer.address);
    });

    it("Allows owner to pause/unpause", async () => {
      await (await escrow.pause()).wait();
      await expect(
        escrow.connect(buyer).depositEarnest(tokenId, { value: escrowAmount })
      ).to.be.reverted;
      await (await escrow.unpause()).wait();
      await (await escrow.connect(buyer).depositEarnest(tokenId, { value: escrowAmount })).wait();
    });
  });

  describe("Emergency Functions", () => {
    beforeEach(async () => {
      await seedKYC(escrow, buyer.address);
    });

    it("Allows emergency cancellation by owner", async () => {
      await (await escrow.connect(buyer).depositEarnest(tokenId, { value: escrowAmount })).wait();
      await (await escrow.emergencyCancelSale(tokenId, buyer.address)).wait();
      const d = await escrow.getPropertyDetails(tokenId);
      expect(d.status).to.equal(PropertyStatus.Cancelled);
    });

    it("Allows emergency withdrawal by owner", async () => {
      await (await escrow.connect(buyer).depositEarnest(tokenId, { value: escrowAmount })).wait();
      const before = await feeRecipient.getBalance();
      await (await escrow.emergencyWithdraw(feeRecipient.address, escrowAmount)).wait();
      const after = await feeRecipient.getBalance();
      expect(after.sub(before)).to.equal(escrowAmount);
    });
  });

  // ----------------------------
  // Reentrancy simulations (NEW)
  // ----------------------------
  describe("Reentrancy simulations", () => {
    describe("Reentry attempt via fee recipient during finalizeSale", () => {
      beforeEach(async () => {
        await seedKYC(escrow, buyer.address);
        await (await escrow.connect(buyer).purchaseWithDeposit(tokenId, { value: escrowAmount })).wait();
        await (await escrow.connect(inspector).updateInspectionStatus(tokenId, true)).wait();
        await (await escrow.connect(buyer).approveSale(tokenId)).wait();
        await (await escrow.connect(lender).approveSale(tokenId)).wait();
        await (await escrow.connect(lender).fundByLender(tokenId, { value: tokens(5) })).wait();
        await (await escrow.connect(seller).approveSale(tokenId)).wait();
        await escrow.setAllowlist(buyer.address, true);
        await escrow.setCredentialHash(buyer.address, ethers.utils.id("demo-kyc"));
        await escrow.setUnlockAt(tokenId, 0);
      });

      it("blocks reentrancy and still finalizes sale successfully", async () => {
        const MaliciousFeeRecipient = await ethers.getContractFactory("MaliciousFeeRecipient");
        const malFee = await MaliciousFeeRecipient.deploy();
        await malFee.deployed();

        await malFee.setTarget(escrow.address, 1);
        await escrow.setFeeRecipient(malFee.address);

        await expect(escrow.connect(seller).finalizeSale(1)).to.not.be.reverted;

        expect(await realEstate.ownerOf(1)).to.equal(buyer.address);
        const details = await escrow.getPropertyDetails(1);
        expect(details.status).to.equal(PropertyStatus.Sold);
        expect(await malFee.reentryTried()).to.equal(true);
        expect(await malFee.reentryOk()).to.equal(false);
      });
    });

    describe("Reentry attempt via bidder refund in _refundOtherBidders", () => {
      beforeEach(async () => {
        // Ensure AUCTION listing with low enough min bid
        await (await escrow.connect(seller).cancelSale(tokenId, "relist as auction")).wait();
        await (await realEstate.connect(seller).approve(escrow.address, tokenId)).wait();

        await (
          await escrow.connect(seller)["list(uint256,uint256,uint256,uint8)"](
            tokenId,
            tokens(5),    // min bid = 5 ETH
            escrowAmount, // <= 5 ETH
            1             // Auction
          )
        ).wait();
      });

      it("refunds malicious bidder; reentry is blocked and state remains correct", async () => {
        const MaliciousBidderF = await ethers.getContractFactory("MaliciousBidder");
        const malBid = await MaliciousBidderF.deploy(escrow.address, 1);
        await malBid.deployed();

        await seedKYC(escrow, malBid.address);
        await seedKYC(escrow, buyer.address);

        await malBid.connect(otherBuyer).bid({ value: tokens(6) });
        await seedKYC(escrow, otherBuyer.address);
        await escrow.connect(buyer).placeBid(1, { value: tokens(7) });
        await expect(escrow.connect(seller).acceptBid(1, buyer.address, 1)).to.not.be.reverted;

        expect(await malBid.reentryTried()).to.equal(true);
        expect(await malBid.reentryOk()).to.equal(false);

        expect(await escrow.getBidAmount(1, malBid.address)).to.equal(0);
        const propertyDetails = await escrow.getPropertyDetails(1);
        expect(propertyDetails.currentBuyer).to.equal(buyer.address);
        expect(propertyDetails.status).to.equal(PropertyStatus.UnderContract);
      });
    });
  });

  describe("Unauthorized Access (negative tests)", () => {
    it("prevents non-seller from listing", async () => {
      await expect(
        escrow.connect(buyer)["list(uint256,uint256,uint256,uint8)"](
          tokenId,
          purchasePrice,
          escrowAmount,
          0 // ListingType.FixedPrice
        )
      ).to.be.revertedWithCustomError(escrow, "UnauthorizedCaller");
    });

    it("prevents non-inspector from updating inspection", async () => {
      await seedKYC(escrow, buyer.address);
      await (await escrow.connect(buyer).depositEarnest(tokenId, { value: escrowAmount })).wait();
      await expect(
        escrow.connect(buyer).updateInspectionStatus(tokenId, true)
      ).to.be.revertedWithCustomError(escrow, "UnauthorizedCaller");
    });

    it("prevents non-lender from funding", async () => {
      await seedKYC(escrow, buyer.address);
      await (await escrow.connect(buyer).depositEarnest(tokenId, { value: escrowAmount })).wait();
      await (await escrow.connect(inspector).updateInspectionStatus(tokenId, true)).wait();
      const d = await escrow.getPropertyDetails(tokenId);
      expect(Number(d.status)).to.equal(4); // AwaitingApprovals
      await expect(
        escrow.connect(buyer).fundByLender(tokenId, { value: tokens(5) })
      ).to.be.revertedWithCustomError(escrow, "UnauthorizedCaller");
    });

    it("prevents random address from approving sale", async () => {
      await seedKYC(escrow, buyer.address);
      await (await escrow.connect(buyer).depositEarnest(tokenId, { value: escrowAmount })).wait();
      await (await escrow.connect(inspector).updateInspectionStatus(tokenId, true)).wait();
      {
        const d = await escrow.getPropertyDetails(tokenId);
        expect(Number(d.status)).to.equal(4);
      }
      await expect(escrow.connect(otherBuyer).approveSale(tokenId))
        .to.be.reverted;
    });

    it("rejects platform fee above 10%", async () => {
      await expect(escrow.connect(buyer).setPlatformFee(1001))
        .to.be.reverted;
    });
  });
});
