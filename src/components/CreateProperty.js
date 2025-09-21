import { useState } from "react";
import { ethers } from "ethers";
import axios from "axios";
import { useToast } from "../ToastContext";
import closeIcon from "../assets/close.svg";

const CreateProperty = ({
  provider,
  account,
  signer,           // use signer passed from App
  realEstate,
  escrow,
  setToggleCreate,
  togglePop,
  close,
  refreshProperties,
}) => {
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    address: "",
    price: "",
    escrowAmount: "",
    bedrooms: "",
    bathrooms: "",
    sqft: "",
    yearBuilt: "",
    propertyType: "House",
    listingType: "FixedPrice", 
  });
  /*const [image, setImage] = useState(null);
  const [previewURL, setPreviewURL] = useState("");*/
  const [images, setImages] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [createStep, setCreateStep] = useState(1);
  const [progressMessage, setProgressMessage] = useState("");

  const toast = useToast();

  // Pinata Configuration
  const PINATA_API_KEY = process.env.REACT_APP_PINATA_API_KEY;
  const PINATA_SECRET_API_KEY = process.env.REACT_APP_PINATA_SECRET_API_KEY;
  const PINATA_ENDPOINT = process.env.REACT_APP_PINATA_ENDPOINT || "https://api.pinata.cloud/pinning/pinFileToIPFS";
  
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((s) => ({ ...s, [name]: value }));
  };

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files || []);
    const newImages = [...images, ...files];
    const newPreviews = [...previews, ...files.map(f => URL.createObjectURL(f))];
    
    setImages(newImages);
    setPreviews(newPreviews);
  };

  const removeImage = (index) => {
    const newImages = images.filter((_, i) => i !== index);
    const newPreviews = previews.filter((_, i) => i !== index);
    
    // Revoke the URL to prevent memory leaks
    URL.revokeObjectURL(previews[index]);
    
    setImages(newImages);
    setPreviews(newPreviews);
  };

  const uploadToPinata = async () => {
    /*if (!image) {
      setError("Please select an image");
      return null;
    }*/
    if (!images.length) { setError("Please select at least one image"); return null; }

    try {
      /*setProgressMessage("Uploading image to IPFS...");

      const formDataImage = new FormData();
      formDataImage.append("file", image);

      const imageUploadResponse = await axios.post(PINATA_ENDPOINT, formDataImage, {
        headers: {
          "Content-Type": "multipart/form-data",
          pinata_api_key: PINATA_API_KEY,
          pinata_secret_api_key: PINATA_SECRET_API_KEY,
        },
      });

      const imageIpfsHash = imageUploadResponse.data.IpfsHash;
      const imageURI = `https://gateway.pinata.cloud/ipfs/${imageIpfsHash}`;*/
      setProgressMessage("Uploading images to IPFS...");
      const imageURLs = [];
      for (const file of images) {
        const form = new FormData();
        form.append("file", file);
        const { data } = await axios.post(PINATA_ENDPOINT, form, {
          headers: {
            "Content-Type": "multipart/form-data",
            pinata_api_key: PINATA_API_KEY,
            pinata_secret_api_key: PINATA_SECRET_API_KEY,
          },
        });
        imageURLs.push(`https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`);
      }
      const coverImage = imageURLs[0];

      setProgressMessage("Creating metadata...");

      const metadata = {
        name: formData.name,
        description: formData.description,
        /*image: imageURI,*/
        image: coverImage,
        images: imageURLs,
        address: formData.address,
        attributes: [
          { trait_type: "PriceOrMinBid", value: formData.price },
          { trait_type: "PropertyType", value: formData.propertyType },
          { trait_type: "Bedrooms", value: formData.bedrooms },
          { trait_type: "Bathrooms", value: formData.bathrooms },
          { trait_type: "SquareFeet", value: formData.sqft },
          { trait_type: "YearBuilt", value: formData.yearBuilt },
          { trait_type: "ListingType", value: formData.listingType },
          { trait_type: "ImageCount", value: imageURLs.length }
        ],
      };

      setProgressMessage("Uploading metadata to IPFS...");

      const jsonResponse = await axios.post(
        "https://api.pinata.cloud/pinning/pinJSONToIPFS",
        metadata,
        {
          headers: {
            pinata_api_key: PINATA_API_KEY,
            pinata_secret_api_key: PINATA_SECRET_API_KEY,
          },
        }
      );

      const metadataIpfsHash = jsonResponse.data.IpfsHash;
      return `https://gateway.pinata.cloud/ipfs/${metadataIpfsHash}`;
    } catch (err) {
      console.error("Error uploading to IPFS:", err);
      setError("Failed to upload to IPFS. Please check your Pinata API keys.");
      return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (!signer) throw new Error("Wallet not connected.");
      if (!realEstate || !escrow) throw new Error("Contracts not loaded.");

      // Only seller can list
      const seller = await escrow.getSeller();
      if (!account || account.toLowerCase() !== seller.toLowerCase()) {
        throw new Error("Only the seller address can list properties.");
      }

      // Validation
      if (!formData.price || Number(formData.price) <= 0) throw new Error("Invalid price.");
      if (!formData.escrowAmount || Number(formData.escrowAmount) <= 0) throw new Error("Invalid escrow amount.");
      if (Number(formData.escrowAmount) > Number(formData.price)) {
        throw new Error("Escrow amount cannot exceed price/min-bid.");
      }

      // 1) Upload to IPFS
      setCreateStep(2);
      const metadataURI = await uploadToPinata();
      if (!metadataURI) {
        setLoading(false);
        return;
      }

      // 2) Mint NFT — caller must be an authorized minter
      setCreateStep(3);
      setProgressMessage("Minting property NFT...");
      const mintTx = await realEstate.connect(signer)["mint(string)"](metadataURI);
      await mintTx.wait();

      // 3) tokenId
      const totalSupply = await realEstate.totalSupply();
      const tokenId = totalSupply.toNumber();

      // 4) Approve Escrow
      setCreateStep(4);
      setProgressMessage("Approving escrow to transfer NFT...");
      const approveTx = await realEstate.connect(signer).approve(escrow.address, tokenId);
      await approveTx.wait();

      // 5) List with explicit SaleConditions + selected listing type
      setCreateStep(5);
      setProgressMessage("Listing property...");

      const priceWei  = ethers.utils.parseEther(formData.price);
      const escrowWei = ethers.utils.parseEther(formData.escrowAmount);
      const latest = await provider.getBlock("latest");
      const now = latest.timestamp;

      const saleConditions = {
        inspectionPeriod: 7 * 24 * 60 * 60,
        financingPeriod: 30 * 24 * 60 * 60,
        requiresInspection: true,
        requiresFinancing: false,
        listingExpiry: now + 90 * 24 * 60 * 60,
      };

      const listingTypeEnum = formData.listingType === "Auction" ? 1 : 0;

      // Resolve lender address for per-property param.
      // If you have a UI field, use that; otherwise default to the Escrow’s global lender.
      let lenderAddress = formData.lenderAddress?.trim();
      if (!lenderAddress) {
        lenderAddress = await escrow.lender(); // uses the constructor-set lender
      }

      let tx;
      try {
        // NEW primary signature (with lender + conditions)
        // list(uint256,uint256,uint256,uint8,address,(...))
        tx = await escrow.connect(signer)
          ["list(uint256,uint256,uint256,uint8,address,(uint256,uint256,bool,bool,uint256))"](
            tokenId, priceWei, escrowWei, listingTypeEnum, lenderAddress, saleConditions
          );
      } catch (_) {
        try {
          // Alternative with implicit FixedPrice + lender + conditions
          // list(uint256,uint256,uint256,address,(...))
          tx = await escrow.connect(signer)
            ["list(uint256,uint256,uint256,address,(uint256,uint256,bool,bool,uint256))"](
              tokenId, priceWei, escrowWei, lenderAddress, saleConditions
            );
        } catch (_) {
          try {
            // With listing type and lender but default conditions
            // list(uint256,uint256,uint256,uint8,address)
            tx = await escrow.connect(signer)
              ["list(uint256,uint256,uint256,uint8,address)"](
                tokenId, priceWei, escrowWei, listingTypeEnum, lenderAddress
              );
          } catch (errFinal) {
            console.error("All list() overloads failed", errFinal);
            throw errFinal;
          }
        }
      }

      await tx.wait();

      setProgressMessage("Success! Refreshing listings...");
      if (refreshProperties) await refreshProperties();
      setToggleCreate(false);
    } catch (err) {
      console.error("Error creating property:", err);
      setError(err?.data?.message || err.message || "Transaction failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const priceLabel =
    formData.listingType === "Auction" ? "Minimum Bid (ETH)" : "Price (ETH)";

  return (
    <div className="create-property">
      <div className="create-property__content">
        {/* Header */}
        <div className="form-header">
          <h2>List Your Property</h2>
          <button onClick={() => setToggleCreate(false)} className="close-btn">
            <img src={closeIcon} alt="Close" />
          </button>
        </div>

        {/* Progress + Errors just below header */}
        {error && <div className="error-message">{error}</div>}
        {loading && createStep > 1 && (
          <div className="transaction-progress-indicator">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${(createStep - 1) * 25}%` }}
              />
            </div>
            <p className="progress-message">{progressMessage}</p>
          </div>
        )}
        
        {/* Scrollable form body */}
        <div className="form-body">
          <form onSubmit={handleSubmit}>
            <div className="form-layout">
              {/* Left Column - Image Upload */}
              <div className="form-column image-column">
                <div className="section-card">
                  <h3 className="section-title">Property Images</h3>
                  <div className="image-upload-container">
                    <input 
                      type="file" 
                      accept="image/*" 
                      multiple 
                      onChange={handleImageChange} 
                      required
                      disabled={loading}
                      className="image-input"
                      id="property-images"
                    />
                    <label htmlFor="property-images" className="file-input-label">
                      <div className="file-input-icon">📷</div>
                      <span>Choose Images</span>
                    </label>
                  </div>
                  
                  {previews.length > 0 && (
                    <div className="image-gallery">
                      <div className="gallery-header">
                        <span className="image-count">{previews.length} image{previews.length !== 1 ? 's' : ''} selected</span>
                      </div>
                      <div className="image-grid">
                        {previews.map((src, index) => (
                          <div key={index} className="image-item">
                            <img src={src} alt={`Preview ${index + 1}`} className="image-preview" />
                            <button
                              type="button"
                              onClick={() => removeImage(index)}
                              className="remove-image-btn"
                              disabled={loading}
                              title="Remove image"
                            >
                              ✕
                            </button>
                            {index === 0 && (
                              <div className="cover-badge">Cover Photo</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* Right column – info */}
              <div className="form-column info-column">
                {/* Basic Information Section */}
                <div className="section-card">
                  <h3 className="section-title">Basic Information</h3>
                  
                  <div className="form-group">
                    <label>Property Name  <span className="required">*</span></label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      placeholder="e.g., Modern Downtown Apartment"
                      required
                      disabled={loading}
                    />
                  </div>

                  <div className="form-group">
                    <label>Address  <span className="required">*</span></label>
                    <input
                      type="text"
                      name="address"
                      value={formData.address}
                      onChange={handleInputChange}
                      placeholder="123 Main St, City, State"
                      required
                      disabled={loading}
                    />
                  </div>

                  <div className="form-group">
                    <label>Description</label>
                    <textarea
                      name="description"
                      value={formData.description}
                      onChange={handleInputChange}
                      placeholder="Describe your property features, location benefits, and unique selling points..."
                      rows="4"
                      disabled={loading}
                    />
                  </div>
                </div>

                {/* Pricing Section */}
                <div className="section-card">
                  <h3 className="section-title">Pricing & Listing</h3>
                  
                  <div className="form-row">
                    <div className="form-group half">
                      <label>Listing Type  <span className="required">*</span></label>
                      <select
                        name="listingType"
                        value={formData.listingType}
                        onChange={handleInputChange}
                        disabled={loading}
                      >
                        <option value="FixedPrice">Fixed Price</option>
                        <option value="Auction">Auction</option>
                      </select>
                    </div>
                    <div className="form-group half">
                      <label>{priceLabel}  <span className="required">*</span></label>
                      <input
                        type="number"
                        name="price"
                        value={formData.price}
                        onChange={handleInputChange}
                        placeholder={formData.listingType === "Auction" ? "e.g., 5" : "e.g., 10"}
                        step="0.01"
                        min="0.01"
                        required
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group half">
                      <span>
                        <label>Escrow Amount (ETH)  <span className="required">*</span></label>
                        <small className="hint">
                          Must be ≤ {priceLabel.replace(" (ETH)", "")}.
                        </small>
                      </span>

                      <input
                        type="number"
                        name="escrowAmount"
                        value={formData.escrowAmount}
                        onChange={handleInputChange}
                        placeholder="e.g., 2"
                        step="0.01"
                        min="0.01"
                        required
                        disabled={loading}
                      />

                    </div>
                    <div className="form-group half">
                      <label>Property Type  <span className="required">*</span></label>
                      <select
                        name="propertyType"
                        value={formData.propertyType}
                        onChange={handleInputChange}
                        disabled={loading}
                        required
                      >
                        <option value="House">House</option>
                        <option value="Apartment">Apartment</option>
                        <option value="Condo">Condo</option>
                        <option value="Townhouse">Townhouse</option>
                        <option value="Land">Land</option>
                        <option value="Commercial">Commercial</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Property Details Section */}
                <div className="section-card">
                  <h3 className="section-title">Property Details</h3>
                  
                  <div className="form-row">
                    <div className="form-group third">
                      <label>Bedrooms   <span className="required">*</span></label>
                      <input
                        type="number"
                        name="bedrooms"
                        value={formData.bedrooms}
                        onChange={handleInputChange}
                        placeholder="3"
                        min="0"
                        required
                        disabled={loading}
                      />
                    </div>
                    <div className="form-group third">
                      <label>Bathrooms  <span className="required">*</span></label>
                      <input
                        type="number"
                        name="bathrooms"
                        value={formData.bathrooms}
                        onChange={handleInputChange}
                        placeholder="2"
                        min="0"
                        step="0.5"
                        required
                        disabled={loading}
                      />
                    </div>
                    <div className="form-group third">
                      <label>Square Feet  <span className="required">*</span></label>
                      <input
                        type="number"
                        name="sqft"
                        value={formData.sqft}
                        onChange={handleInputChange}
                        placeholder="1500"
                        min="0"
                        required
                        disabled={loading}
                      />
                    </div>
                    <div className="form-group third">
                      <label>Year Built  <span className="required">*</span></label>
                      <input
                        type="number"
                        name="yearBuilt"
                        value={formData.yearBuilt}
                        onChange={handleInputChange}
                        placeholder="2020"
                        min="1800"
                        max={new Date().getFullYear()}
                        required
                        disabled={loading}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Form Actions */}
            <div className="form-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setToggleCreate(false)}
                disabled={loading}
              >
                Cancel
              </button>
              <button type="submit" className="btn-submit" disabled={loading}>
                {loading ? "Processing..." : "List Property"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CreateProperty;
