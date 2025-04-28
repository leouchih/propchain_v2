import { ethers } from "ethers";
import { useEffect, useState } from "react";

import close from "../assets/close.svg";

const Home = ({ home, provider, account, escrow, togglePop }) => {
  const [hasBought, setHasBought] = useState(false);
  const [hasLended, setHasLended] = useState(false);
  const [hasInspected, setHasInspected] = useState(false);
  const [hasSold, setHasSold] = useState(false);

  const [buyer, setBuyer] = useState(null);
  const [lender, setLender] = useState(null);
  const [inspector, setInspector] = useState(null);
  const [seller, setSeller] = useState(null);
  const [owner, setOwner] = useState(null);
  const [progressMessage, setProgressMessage] = useState(""); // Add missing progress message state

  // New state for transaction status
  const [transactionStatus, setTransactionStatus] = useState({
    buyerApproved: false,
    sellerApproved: false,
    lenderApproved: false,
    inspectionPassed: false,
    fundsSufficient: false,
    isFinalized: false,
  });

  // Add a new state to track the current step in the transaction flow
  const [currentStep, setCurrentStep] = useState(0);

  const fetchDetails = async () => {
    try {
      // Check if property is still listed
      const isListed = await escrow.isListed(home.id);
      if (!isListed) {
        setCurrentStep(6); // Transaction completed
      }

      // -- Buyer
      const buyer = await escrow.buyer(home.id);
      setBuyer(buyer);

      const hasBought = await escrow.approval(home.id, buyer);
      setHasBought(hasBought);
      if (hasBought && currentStep < 2) setCurrentStep(2);

      // -- Seller
      const seller = await escrow.seller();
      setSeller(seller);

      const hasSold = await escrow.approval(home.id, seller);
      setHasSold(hasSold);
      if (hasSold && currentStep < 5) setCurrentStep(5);

      // -- Lender
      const lender = await escrow.lender();
      setLender(lender);

      const hasLended = await escrow.approval(home.id, lender);
      setHasLended(hasLended);
      if (hasLended && currentStep < 4) setCurrentStep(4);

      // -- Inspector
      const inspector = await escrow.inspector();
      setInspector(inspector);

      const hasInspected = await escrow.inspectionPassed(home.id);
      setHasInspected(hasInspected);
      if (hasInspected && currentStep < 3) setCurrentStep(3);

      // Check contract balance vs purchase price
      const contractBalance = await provider.getBalance(escrow.address);
      const purchasePrice = await escrow.purchasePrice(home.id);
      const fundsSufficient = contractBalance.gte(purchasePrice);

      // Update transaction status
      setTransactionStatus({
        buyerApproved: hasBought,
        sellerApproved: hasSold,
        lenderApproved: hasLended,
        inspectionPassed: hasInspected,
        fundsSufficient: fundsSufficient,
        isFinalized: !isListed,
      });
    } catch (error) {
      console.error("Error fetching details:", error);
    }
  };

  const fetchOwner = async () => {
    try {
      // Only set an owner if the property is not listed AND has a non-zero buyer
      if (await escrow.isListed(home.id)) return;

      const owner = await escrow.buyer(home.id);
      // Only set the owner if it's not the zero address
      if (owner !== "0x0000000000000000000000000000000000000000") {
        setOwner(owner);
      }
    } catch (error) {
      console.error("Error fetching owner:", error);
    }
  };

  const buyHandler = async () => {
    try {
      setProgressMessage("Initiating purchase...");
      const escrowAmount = await escrow.escrowAmount(home.id);
      const signer = await provider.getSigner();

      // Buyer deposit earnest
      setProgressMessage("Depositing earnest money...");
      let transaction = await escrow
        .connect(signer)
        .depositEarnest(home.id, { value: escrowAmount });

      setProgressMessage("Waiting for deposit confirmation...");
      await transaction.wait();

      // Buyer approves...
      setProgressMessage("Approving sale...");
      transaction = await escrow.connect(signer).approveSale(home.id);

      setProgressMessage("Waiting for approval confirmation...");
      await transaction.wait();

      setProgressMessage("Purchase initiated successfully!");
      setHasBought(true);
      setCurrentStep(2);
      fetchDetails(); // Refresh data

      // Clear progress message after a delay
      setTimeout(() => setProgressMessage(""), 3000);
    } catch (error) {
      console.error("Error in buy process:", error);
      setProgressMessage("Transaction failed. Please try again.");
      setTimeout(() => setProgressMessage(""), 3000);
    }
  };

  const inspectHandler = async () => {
    try {
      setProgressMessage("Updating inspection status...");
      const signer = await provider.getSigner();

      // Inspector updates status
      const transaction = await escrow
        .connect(signer)
        .updateInspectionStatus(home.id, true);

      setProgressMessage("Waiting for confirmation...");
      await transaction.wait();

      setProgressMessage("Inspection approved successfully!");
      setHasInspected(true);
      setCurrentStep(3);
      fetchDetails(); // Refresh data

      // Clear progress message after a delay
      setTimeout(() => setProgressMessage(""), 3000);
    } catch (error) {
      console.error("Error in inspection process:", error);
      setProgressMessage("Inspection update failed. Please try again.");
      setTimeout(() => setProgressMessage(""), 3000);
    }
  };

  const lendHandler = async () => {
    try {
      setProgressMessage("Checking property status...");
      const signer = await provider.getSigner();

      // First check if property is listed
      const isListed = await escrow.isListed(home.id);
      console.log("Is property listed?", isListed);
      if (!isListed) {
        setProgressMessage("Property is not currently listed. Cannot proceed.");
        setTimeout(() => setProgressMessage(""), 3000);
        return;
      }

      // Check if there's a buyer
      const currentBuyer = await escrow.buyer(home.id);
      console.log("Current buyer:", currentBuyer);
      if (currentBuyer === ethers.constants.AddressZero) {
        setProgressMessage(
          "No buyer has initiated purchase yet. Cannot proceed."
        );
        setTimeout(() => setProgressMessage(""), 3000);
        return;
      }

      // Calculate lend amount
      const purchasePrice = await escrow.purchasePrice(home.id);
      const escrowAmount = await escrow.escrowAmount(home.id);
      const lendAmount = purchasePrice.sub(escrowAmount);

      console.log("Transaction details:", {
        purchasePrice: ethers.utils.formatEther(purchasePrice),
        escrowAmount: ethers.utils.formatEther(escrowAmount),
        lendAmount: ethers.utils.formatEther(lendAmount),
        contractAddress: escrow.address,
      });

      // Send funds to contract first
      setProgressMessage("Sending funds to contract...");
      const fundingTx = await escrow.connect(signer).fundByLender(home.id, {
        value: lendAmount,
      });
      await fundingTx.wait();

      setProgressMessage("Waiting for funding confirmation...");
      await fundingTx.wait();
      console.log("Funding transaction complete:", fundingTx.hash);

      // Now approve the sale
      setProgressMessage("Approving sale...");
      const approvalTx = await escrow.connect(signer).approveSale(home.id);

      setProgressMessage("Waiting for approval confirmation...");
      await approvalTx.wait();
      console.log("Approval transaction complete:", approvalTx.hash);

      setProgressMessage("Lending process completed successfully!");
      setHasLended(true);
      setCurrentStep(4);
      fetchDetails(); // Refresh data

      // Clear progress message after a delay
      setTimeout(() => setProgressMessage(""), 3000);
    } catch (error) {
      console.error("Error in lending process:", error);
      console.log("Error details:", error);
      setProgressMessage(
        "Lending process failed. Please check the console for details."
      );
      setTimeout(() => setProgressMessage(""), 3000);
    }
  };

  const sellHandler = async () => {
    try {
      setProgressMessage("Approving sale...");
      const signer = await provider.getSigner();

      // Seller approves...
      let transaction = await escrow.connect(signer).approveSale(home.id);
      setProgressMessage("Waiting for approval confirmation...");
      await transaction.wait();

      // Add a small delay to ensure the blockchain state is updated
      setProgressMessage("Approval confirmed. Preparing to finalize...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify seller approval went through
      const sellerApproval = await escrow.approval(home.id, seller);
      console.log("Seller approved (after transaction):", sellerApproval);

      if (sellerApproval) {
        // Seller finalize...
        setProgressMessage("Finalizing transaction...");
        transaction = await escrow.connect(signer).finalizeSale(home.id);
        await transaction.wait();

        setProgressMessage("Sale finalized successfully!");
        setHasSold(true);
        setCurrentStep(6);
        fetchDetails(); // Refresh data
      } else {
        setProgressMessage(
          "Seller approval did not register properly. Please try again."
        );
      }

      // Clear progress message after a delay
      setTimeout(() => setProgressMessage(""), 3000);
    } catch (error) {
      console.error("Error in selling process:", error);
      setProgressMessage("Transaction failed: " + error.message);
      setTimeout(() => setProgressMessage(""), 5000);
    }
  };

  const cancelSaleHandler = async () => {
    try {
      setProgressMessage("Cancelling sale...");
      const signer = await provider.getSigner();

      const transaction = await escrow.connect(signer).cancelSale(home.id);
      setProgressMessage("Waiting for confirmation...");
      await transaction.wait();

      setProgressMessage("Sale cancelled successfully!");
      fetchDetails(); // Refresh data

      // Clear progress message after a delay
      setTimeout(() => setProgressMessage(""), 3000);
    } catch (error) {
      console.error("Error cancelling sale:", error);
      setProgressMessage("Failed to cancel sale. Please try again.");
      setTimeout(() => setProgressMessage(""), 3000);
    }
  };

  useEffect(() => {
    const init = async () => {
      await fetchDetails();
      await fetchOwner();
    };
    init();
  }, [home.id]);

  // Define the transaction flow steps
  const transactionSteps = [
    {
      name: "Property Listed",
      description: "NFT transferred to escrow contract",
    },
    { name: "Buyer Selected", description: "Buyer chosen during listing" },
    {
      name: "Buyer Deposits & Approves",
      description: "Earnest money deposited",
    },
    {
      name: "Inspection Passed",
      description: "Inspector approves the property",
    },
    {
      name: "Lender Funds & Approves",
      description: "Remaining funds transferred",
    },
    { name: "Seller Approves", description: "Seller approves the sale" },
    { name: "Transaction Complete", description: "NFT transferred to buyer" },
  ];

  return (
    <div className="home">
      <div className="home__details">
        <div className="home__image">
          <img src={home.image} alt="Home" />
        </div>
        <div className="home__overview">
          <h1>{home.name}</h1>
          <p>
            <strong>{home.attributes[2].value}</strong> bds |
            <strong>{home.attributes[3].value}</strong> ba |
            <strong>{home.attributes[4].value}</strong> sqft
          </p>
          <p>{home.address}</p>

          <h2>{home.attributes[0].value} ETH</h2>

          {owner && owner !== "0x0000000000000000000000000000000000000000" ? (
            <div className="home__owned">
              Owned by {owner.slice(0, 6) + "..." + owner.slice(38, 42)}
            </div>
          ) : (
            <div>
              {/* Transaction Flow Visualization */}
              <div className="transaction-flow">
                <h3>Transaction Flow</h3>
                <div className="flow-steps">
                  {transactionSteps.map((step, index) => (
                    <div
                      key={index}
                      className={`flow-step ${
                        index === currentStep ? "active" : ""
                      } ${index < currentStep ? "completed" : ""}`}
                    >
                      <div className="step-number">{index + 1}</div>
                      <div className="step-content">
                        <div className="step-name">{step.name}</div>
                        <div className="step-description">
                          {step.description}
                        </div>
                        {index === 2 && buyer === account && (
                          <div className="step-your-role">Your Role: Buyer</div>
                        )}
                        {index === 3 && inspector === account && (
                          <div className="step-your-role">
                            Your Role: Inspector
                          </div>
                        )}
                        {index === 4 && lender === account && (
                          <div className="step-your-role">
                            Your Role: Lender
                          </div>
                        )}
                        {index === 5 && seller === account && (
                          <div className="step-your-role">
                            Your Role: Seller
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Transaction status details
              <div className="transaction-details">
                <h3>Transaction Details</h3>
                <ul className="status-list">
                  <li>
                    <span
                      className={`status-icon ${
                        transactionStatus.inspectionPassed
                          ? "complete"
                          : "pending"
                      }`}
                    ></span>
                    Inspection:{" "}
                    {transactionStatus.inspectionPassed ? "Passed" : "Pending"}
                  </li>
                  <li>
                    <span
                      className={`status-icon ${
                        transactionStatus.buyerApproved ? "complete" : "pending"
                      }`}
                    ></span>
                    Buyer Approval:{" "}
                    {transactionStatus.buyerApproved ? "Approved" : "Pending"}
                  </li>
                  <li>
                    <span
                      className={`status-icon ${
                        transactionStatus.sellerApproved
                          ? "complete"
                          : "pending"
                      }`}
                    ></span>
                    Seller Approval:{" "}
                    {transactionStatus.sellerApproved ? "Approved" : "Pending"}
                  </li>
                  <li>
                    <span
                      className={`status-icon ${
                        transactionStatus.lenderApproved
                          ? "complete"
                          : "pending"
                      }`}
                    ></span>
                    Lender Approval:{" "}
                    {transactionStatus.lenderApproved ? "Approved" : "Pending"}
                  </li>
                  <li>
                    <span
                      className={`status-icon ${
                        transactionStatus.fundsSufficient
                          ? "complete"
                          : "pending"
                      }`}
                    ></span>
                    Funds:{" "}
                    {transactionStatus.fundsSufficient
                      ? "Sufficient"
                      : "Insufficient"}
                  </li>
                </ul>
              </div> */}

              {/* Progress Message */}
              {progressMessage && (
                <div className="progress-message">{progressMessage}</div>
              )}

              {/* Action buttons based on role */}
              <div className="action-buttons">
                {account === inspector && !hasInspected && (
                  <button
                    className="home__buy"
                    onClick={inspectHandler}
                    disabled={hasInspected}
                  >
                    Approve Inspection
                  </button>
                )}

                {account === lender && !hasLended && (
                  <button
                    className="home__buy"
                    onClick={lendHandler}
                    disabled={hasLended}
                  >
                    Approve & Fund
                  </button>
                )}

                {account === seller && !hasSold && (
                  <button
                    className="home__buy"
                    onClick={sellHandler}
                    disabled={
                      hasSold ||
                      !hasInspected ||
                      !hasBought ||
                      !hasLended ||
                      !transactionStatus.fundsSufficient
                    }
                  >
                    Approve & Sell
                  </button>
                )}

                {/* MODIFIED CONDITION HERE - Show buy button for any account that's not a role player */}
                {account !== inspector &&
                  account !== lender &&
                  account !== seller &&
                  (buyer === "0x0000000000000000000000000000000000000000" ||
                    account === buyer) &&
                  !hasBought && (
                    <button
                      className="home__buy"
                      onClick={buyHandler}
                      disabled={hasBought}
                    >
                      Buy
                    </button>
                  )}

                {/* Cancel button - show for buyer or seller if transaction not finalized */}
                {!transactionStatus.isFinalized &&
                  (account === buyer || account === seller) && (
                    <button
                      className="home__cancel"
                      onClick={cancelSaleHandler}
                    >
                      Cancel Sale
                    </button>
                  )}

                <button className="home__contact">Contact agent</button>
              </div>

              {/* Role information message */}
              <div className="role-info">
                {account === buyer && "You are the buyer for this property."}
                {account === seller && "You are the seller of this property."}
                {account === lender &&
                  "You are the lender for this transaction."}
                {account === inspector &&
                  "You are the inspector for this property."}
                {account !== buyer &&
                  account !== seller &&
                  account !== lender &&
                  account !== inspector &&
                  "Connect with the correct account to interact with this transaction."}
              </div>
            </div>
          )}

          <hr />

          <h2>Overview</h2>

          <p>{home.description}</p>

          <hr />

          <h2>Facts and features</h2>

          <ul>
            {home.attributes.map((attribute, index) => (
              <li key={index}>
                <strong>{attribute.trait_type}</strong> : {attribute.value}
              </li>
            ))}
          </ul>
        </div>

        <button onClick={togglePop} className="home__close">
          <img src={close} alt="Close" />
        </button>
      </div>
    </div>
  );
};

export default Home;
