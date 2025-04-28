import { useEffect, useState } from "react";
import { ethers } from "ethers";
import close from "../assets/close.svg";

const SellerDashboard = ({
  provider,
  account,
  realEstate,
  escrow,
  toggleDashboard,
}) => {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadSellerProperties = async () => {
      if (!account || !realEstate || !escrow) return;

      try {
        setLoading(true);

        // Get all properties
        const totalSupply = await realEstate.totalSupply();
        const seller = await escrow.seller();

        // Check if current user is the seller
        if (seller.toLowerCase() !== account.toLowerCase()) {
          setError("You are not the seller in this escrow contract.");
          setLoading(false);
          return;
        }

        const sellerProperties = [];

        // Loop through all properties to find those owned or listed by the seller
        for (let i = 1; i <= totalSupply; i++) {
          try {
            const isListed = await escrow.isListed(i);

            if (isListed) {
              // Get metadata for this property
              const uri = await realEstate.tokenURI(i);
              const response = await fetch(uri);
              const metadata = await response.json();

              // Add blockchain data
              metadata.id = i;

              // Get transaction status
              const buyerAddress = await escrow.buyer(i);
              const buyerApproved = await escrow.approval(i, buyerAddress);
              const sellerApproved = await escrow.approval(i, seller);
              const lender = await escrow.lender();
              const lenderApproved = await escrow.approval(i, lender);
              const inspectionPassed = await escrow.inspectionPassed(i);

              metadata.status = {
                buyerAddress,
                buyerApproved,
                sellerApproved,
                lenderApproved,
                inspectionPassed,
              };

              sellerProperties.push(metadata);
            }
          } catch (err) {
            console.error(`Error loading property #${i}:`, err);
          }
        }

        setProperties(sellerProperties);
      } catch (err) {
        console.error("Error loading seller properties:", err);
        setError("Failed to load your properties. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    loadSellerProperties();
  }, [account, realEstate, escrow]);

  const getStatusText = (status) => {
    if (!status) return "Unknown";

    if (
      status.sellerApproved &&
      status.buyerApproved &&
      status.lenderApproved &&
      status.inspectionPassed
    ) {
      return "Ready for Finalization";
    } else if (status.inspectionPassed) {
      return "Inspection Passed";
    } else {
      return "Awaiting Inspection";
    }
  };

  const getStatusColor = (status) => {
    if (!status) return "gray";

    if (
      status.sellerApproved &&
      status.buyerApproved &&
      status.lenderApproved &&
      status.inspectionPassed
    ) {
      return "green";
    } else if (status.inspectionPassed) {
      return "blue";
    } else {
      return "orange";
    }
  };

  const handleFinalizeSale = async (propertyId) => {
    if (!account || !escrow) return;

    try {
      const signer = await provider.getSigner();

      // First approve if not already approved
      const seller = await escrow.seller();
      const isApproved = await escrow.approval(propertyId, seller);

      if (!isApproved) {
        const approveTransaction = await escrow
          .connect(signer)
          .approveSale(propertyId);
        await approveTransaction.wait();
      }

      // Then finalize the sale
      const transaction = await escrow.connect(signer).finalizeSale(propertyId);
      await transaction.wait();

      // Refresh the list
      const updatedProperties = properties.filter((p) => p.id !== propertyId);
      setProperties(updatedProperties);

      alert("Sale finalized successfully!");
    } catch (err) {
      console.error("Error finalizing sale:", err);
      alert("Failed to finalize sale. Please ensure all conditions are met.");
    }
  };

  const handleApproveSale = async (propertyId) => {
    if (!account || !escrow) return;

    try {
      const signer = await provider.getSigner();
      const transaction = await escrow.connect(signer).approveSale(propertyId);
      await transaction.wait();

      // Update the status in the UI
      const updatedProperties = properties.map((p) => {
        if (p.id === propertyId) {
          return {
            ...p,
            status: {
              ...p.status,
              sellerApproved: true,
            },
          };
        }
        return p;
      });

      setProperties(updatedProperties);
      alert("Sale approved successfully!");
    } catch (err) {
      console.error("Error approving sale:", err);
      alert("Failed to approve sale. Please try again.");
    }
  };

  return (
    <div className="seller-dashboard">
      <div className="dashboard-content">
        <button className="close-button" onClick={toggleDashboard}>
          <img src={close} alt="Close" />
        </button>

        <h2>Seller Dashboard</h2>

        {error && <div className="error-message">{error}</div>}

        {loading ? (
          <div className="loading">Loading your properties...</div>
        ) : (
          <>
            <h3>Your Listed Properties</h3>

            {properties.length === 0 ? (
              <p>You don't have any properties listed for sale.</p>
            ) : (
              <div className="property-list">
                {properties.map((property) => (
                  <div className="property-card" key={property.id}>
                    <div className="property-image">
                      <img src={property.image} alt={property.name} />
                    </div>

                    <div className="property-details">
                      <h4>{property.name}</h4>
                      <p>{property.address}</p>
                      <p className="property-price">
                        <strong>{property.attributes[0].value} ETH</strong>
                      </p>

                      <div
                        className="property-status"
                        style={{
                          backgroundColor: getStatusColor(property.status),
                        }}
                      >
                        {getStatusText(property.status)}
                      </div>

                      <div className="transaction-parties">
                        <p>
                          <strong>Buyer:</strong>{" "}
                          {property.status?.buyerAddress.slice(0, 6)}...
                          {property.status?.buyerAddress.slice(-4)}
                          <span
                            className={
                              property.status?.buyerApproved
                                ? "approved"
                                : "pending"
                            }
                          >
                            {property.status?.buyerApproved
                              ? "✓ Approved"
                              : "Pending"}
                          </span>
                        </p>

                        <p>
                          <strong>Seller:</strong> You
                          <span
                            className={
                              property.status?.sellerApproved
                                ? "approved"
                                : "pending"
                            }
                          >
                            {property.status?.sellerApproved
                              ? "✓ Approved"
                              : "Pending"}
                          </span>
                        </p>

                        <p>
                          <strong>Inspection:</strong>
                          <span
                            className={
                              property.status?.inspectionPassed
                                ? "approved"
                                : "pending"
                            }
                          >
                            {property.status?.inspectionPassed
                              ? "✓ Passed"
                              : "Pending"}
                          </span>
                        </p>
                      </div>

                      <div className="property-actions">
                        {!property.status?.sellerApproved && (
                          <button
                            className="btn-approve"
                            onClick={() => handleApproveSale(property.id)}
                          >
                            Approve Sale
                          </button>
                        )}

                        {property.status?.sellerApproved &&
                          property.status?.buyerApproved &&
                          property.status?.lenderApproved &&
                          property.status?.inspectionPassed && (
                            <button
                              className="btn-finalize"
                              onClick={() => handleFinalizeSale(property.id)}
                            >
                              Finalize Sale
                            </button>
                          )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SellerDashboard;
