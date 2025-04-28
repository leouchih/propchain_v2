import { useState } from "react";
import { ethers } from "ethers";
import axios from "axios";

const CreateProperty = ({
  provider,
  account,
  realEstate,
  escrow,
  setToggleCreate,
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
  });
  const [image, setImage] = useState(null);
  const [previewURL, setPreviewURL] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [createStep, setCreateStep] = useState(1); // Track progress: 1=Form, 2=Uploading, 3=Minting, 4=Approving, 5=Listing
  const [progressMessage, setProgressMessage] = useState("");

  // Pinata configuration
  const PINATA_API_KEY = "7c7efd18b47965858e73"; // From your document
  const PINATA_SECRET_API_KEY =
    "55ba7e605ec5e1e2ec0a90c49911d3d2a68ac6a2853d7a8138b02ba79bdcd7d3"; // From your document
  const PINATA_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value,
    });
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImage(file);
      setPreviewURL(URL.createObjectURL(file));
    }
  };

  const uploadToPinata = async () => {
    if (!image) {
      setError("Please select an image");
      return null;
    }

    try {
      setProgressMessage("Uploading image to IPFS...");

      // Upload image to IPFS via Pinata
      const formDataImage = new FormData();
      formDataImage.append("file", image);

      const imageUploadResponse = await axios.post(
        PINATA_ENDPOINT,
        formDataImage,
        {
          headers: {
            "Content-Type": "multipart/form-data",
            pinata_api_key: PINATA_API_KEY,
            pinata_secret_api_key: PINATA_SECRET_API_KEY,
          },
        }
      );

      const imageIpfsHash = imageUploadResponse.data.IpfsHash;
      const imageURI = `https://gateway.pinata.cloud/ipfs/${imageIpfsHash}`;

      setProgressMessage("Creating metadata...");

      // Create metadata
      const metadata = {
        name: formData.name,
        description: formData.description,
        image: imageURI,
        address: formData.address,
        attributes: [
          {
            trait_type: "Price",
            value: formData.price,
          },
          {
            trait_type: "PropertyType",
            value: formData.propertyType,
          },
          {
            trait_type: "Bedrooms",
            value: formData.bedrooms,
          },
          {
            trait_type: "Bathrooms",
            value: formData.bathrooms,
          },
          {
            trait_type: "SquareFeet",
            value: formData.sqft,
          },
          {
            trait_type: "YearBuilt",
            value: formData.yearBuilt,
          },
        ],
      };

      setProgressMessage("Uploading metadata to IPFS...");

      // Upload metadata JSON to IPFS via Pinata
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
      const metadataURI = `https://gateway.pinata.cloud/ipfs/${metadataIpfsHash}`;

      return metadataURI;
    } catch (error) {
      console.error("Error uploading to IPFS:", error);
      setError("Failed to upload to IPFS. Please check your Pinata API keys.");
      return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // 1. Upload image and metadata to IPFS via Pinata
      setCreateStep(2);
      const metadataURI = await uploadToPinata();
      if (!metadataURI) {
        setLoading(false);
        return;
      }

      // 2. Mint the NFT
      setCreateStep(3);
      setProgressMessage("Minting property NFT...");
      const signer = await provider.getSigner();
      let transaction = await realEstate.connect(signer).mint(metadataURI);
      await transaction.wait();

      // 3. Get the latest token ID
      const totalSupply = await realEstate.totalSupply();
      const tokenId = totalSupply.toNumber();

      // 4. Approve the escrow contract to manage the NFT
      setCreateStep(4);
      setProgressMessage("Approving transaction...");
      transaction = await realEstate
        .connect(signer)
        .approve(escrow.address, tokenId);
      await transaction.wait();

      // 5. List the property on the escrow contract
      setCreateStep(5);
      setProgressMessage("Listing property...");
      const purchasePrice = ethers.utils.parseEther(formData.price);
      const escrowAmount = ethers.utils.parseEther(formData.escrowAmount);

      transaction = await escrow.connect(signer).list(
        tokenId,
        //account, // Initially set buyer as self, will be updated when a buyer wants to purchase
        purchasePrice,
        escrowAmount
      );
      await transaction.wait();

      // 6. Refresh the property list and close the form
      setProgressMessage("Success! Refreshing property list...");
      if (refreshProperties) {
        await refreshProperties();
      }
      setToggleCreate(false);
    } catch (error) {
      console.error("Error creating property:", error);
      setError("Transaction failed. Please check your inputs and try again.");
    }

    setLoading(false);
  };

  return (
    <div className="create-property">
      <div className="create-property__content">
        <h2>List Your Property</h2>

        {error && <div className="error-message">{error}</div>}

        {/* Show progress indicator when performing blockchain transactions */}
        {loading && createStep > 1 && (
          <div className="transaction-progress-indicator">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${(createStep - 1) * 25}%` }}
              ></div>
            </div>
            <p className="progress-message">{progressMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Property Image</label>
            <input
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              required
              disabled={loading}
            />
            {previewURL && (
              <img
                src={previewURL}
                alt="Property Preview"
                className="image-preview"
              />
            )}
          </div>

          <div className="form-group">
            <label>Property Name</label>
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
            <label>Address</label>
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

          <div className="form-row">
            <div className="form-group half">
              <label>Price (ETH)</label>
              <input
                type="number"
                name="price"
                value={formData.price}
                onChange={handleInputChange}
                placeholder="10"
                step="0.01"
                min="0.01"
                required
                disabled={loading}
              />
            </div>
            <div className="form-group half">
              <label>Escrow Amount (ETH)</label>
              <input
                type="number"
                name="escrowAmount"
                value={formData.escrowAmount}
                onChange={handleInputChange}
                placeholder="2"
                step="0.01"
                min="0.01"
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group third">
              <label>Bedrooms</label>
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
              <label>Bathrooms</label>
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
              <label>Square Feet</label>
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
          </div>

          <div className="form-row">
            <div className="form-group half">
              <label>Year Built</label>
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
            <div className="form-group half">
              <label>Property Type</label>
              <select
                name="propertyType"
                value={formData.propertyType}
                onChange={handleInputChange}
                disabled={loading}
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

          <div className="form-group">
            <label>Description</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              placeholder="Describe your property..."
              rows="4"
              required
              disabled={loading}
            ></textarea>
          </div>

          <div className="form-buttons">
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
  );
};

export default CreateProperty;
