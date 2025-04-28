import { useEffect, useState } from "react";
import { ethers } from "ethers";

// Components
import Navigation from "./components/Navigation";
import Search from "./components/Search";
import Home from "./components/Home";
import CreateProperty from "./components/CreateProperty";
import SellerDashboard from "./components/SellerDashboard"; // Import the SellerDashboard component

// ABIs
import RealEstate from "./abis/RealEstate.json";
import Escrow from "./abis/Escrow.json";

// Config
import config from "./config.json";

function App() {
  const [provider, setProvider] = useState(null);
  const [escrow, setEscrow] = useState(null);
  const [realEstate, setRealEstate] = useState(null);

  const [account, setAccount] = useState(null);

  const [homes, setHomes] = useState([]);
  const [home, setHome] = useState({});
  const [toggle, setToggle] = useState(false);
  const [toggleCreate, setToggleCreate] = useState(false);
  const [toggleSellerDashboard, setToggleSellerDashboard] = useState(false); // Add state for SellerDashboard toggle

  // New state for search functionality
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredHomes, setFilteredHomes] = useState([]);

  const loadBlockchainData = async () => {
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      setProvider(provider);
      const network = await provider.getNetwork();

      // Load RealEstate contract
      const realEstate = new ethers.Contract(
        config[network.chainId].realEstate.address,
        RealEstate,
        provider
      );
      setRealEstate(realEstate);

      // Load Escrow contract
      const escrow = new ethers.Contract(
        config[network.chainId].escrow.address,
        Escrow,
        provider
      );
      setEscrow(escrow);

      // Load properties
      await loadProperties(realEstate);

      // Handle account changes
      window.ethereum.on("accountsChanged", async () => {
        const accounts = await window.ethereum.request({
          method: "eth_requestAccounts",
        });
        const account = ethers.utils.getAddress(accounts[0]);
        setAccount(account);
      });
    } catch (error) {
      console.error("Error loading blockchain data:", error);
    }
  };

  const loadProperties = async (realEstateContract) => {
    try {
      const totalSupply = await realEstateContract.totalSupply();
      const homes = [];

      for (var i = 1; i <= totalSupply; i++) {
        const uri = await realEstateContract.tokenURI(i);
        const response = await fetch(uri);
        const metadata = await response.json();
        metadata.id = i; // Add the token ID to the metadata
        homes.push(metadata);
      }

      setHomes(homes);
      setFilteredHomes(homes);
    } catch (error) {
      console.error("Error loading properties:", error);
    }
  };

  // Function to refresh properties after adding a new one
  const refreshProperties = async () => {
    if (realEstate) {
      await loadProperties(realEstate);
    }
  };

  // Handle search functionality
  const handleSearchChange = (query) => {
    setSearchQuery(query);
    if (query.trim() === "") {
      setFilteredHomes(homes);
    } else {
      const filtered = homes.filter(
        (home) =>
          home.address.toLowerCase().includes(query.toLowerCase()) ||
          (home.attributes &&
            home.attributes.some((attr) =>
              attr.value.toString().toLowerCase().includes(query.toLowerCase())
            ))
      );
      setFilteredHomes(filtered);
    }
  };

  useEffect(() => {
    loadBlockchainData();
  }, []);

  const togglePop = (home) => {
    setHome(home);
    toggle ? setToggle(false) : setToggle(true);
  };

  const toggleCreateForm = () => {
    setToggleCreate(!toggleCreate);
  };

  // Add function to toggle the seller dashboard
  const toggleSellerDashboardForm = () => {
    setToggleSellerDashboard(!toggleSellerDashboard);
  };

  return (
    <div>
      <Navigation
        account={account}
        setAccount={setAccount}
        toggleCreateForm={toggleCreateForm}
        toggleSellerDashboard={toggleSellerDashboardForm}
        escrow={escrow} // Add the escrow contract
      />
      <Search searchQuery={searchQuery} setSearchQuery={handleSearchChange} />

      <div className="cards__section">
        <h3>Homes For You</h3>
        <hr />

        <div className="cards">
          {filteredHomes.length > 0 ? (
            filteredHomes.map((home, index) => (
              <div className="card" key={index} onClick={() => togglePop(home)}>
                <div className="card__image">
                  <img src={home.image} alt="Home" />
                </div>
                <div className="card__info">
                  <h4>{home.attributes[0].value} ETH</h4>
                  <p>
                    <strong>{home.attributes[2].value}</strong> bds |
                    <strong>{home.attributes[3].value}</strong> ba |
                    <strong>{home.attributes[4].value}</strong> sqft
                  </p>
                  <p>{home.address}</p>
                </div>
                {/* Status indicator */}
                {home.id && (
                  <TransactionStatus
                    nftId={home.id}
                    escrow={escrow}
                    account={account}
                  />
                )}
              </div>
            ))
          ) : (
            <p className="no-results">
              No properties found matching your search criteria.
            </p>
          )}
        </div>
      </div>

      {toggle && (
        <Home
          home={home}
          provider={provider}
          account={account}
          escrow={escrow}
          togglePop={togglePop}
        />
      )}

      {toggleCreate && (
        <CreateProperty
          provider={provider}
          account={account}
          realEstate={realEstate}
          escrow={escrow}
          setToggleCreate={setToggleCreate}
          refreshProperties={refreshProperties}
        />
      )}

      {/* Add the SellerDashboard component */}
      {toggleSellerDashboard && (
        <SellerDashboard
          provider={provider}
          account={account}
          realEstate={realEstate}
          escrow={escrow}
          toggleDashboard={toggleSellerDashboardForm}
        />
      )}
    </div>
  );
}

// Component to display transaction status
const TransactionStatus = ({ nftId, escrow, account }) => {
  const [status, setStatus] = useState("Loading...");

  useEffect(() => {
    const fetchStatus = async () => {
      if (!escrow || !nftId) return;

      try {
        const isListed = await escrow.isListed(nftId);
        if (!isListed) {
          setStatus("Sold");
          return;
        }

        const buyer = await escrow.buyer(nftId);
        const seller = await escrow.seller();

        // Check if no buyer is assigned yet (zero address)
        if (buyer === "0x0000000000000000000000000000000000000000") {
          setStatus("For Sale");
          return;
        }

        // Rest of the existing logic
        if (account === buyer) {
          const hasBought = await escrow.approval(nftId, buyer);
          setStatus(hasBought ? "Awaiting Others" : "Action Required");
        } else if (account === seller) {
          const hasSold = await escrow.approval(nftId, seller);
          setStatus(hasSold ? "Awaiting Others" : "Awaiting Approval");
        } else {
          const inspectionPassed = await escrow.inspectionPassed(nftId);
          setStatus(
            inspectionPassed ? "Inspection Passed" : "Awaiting Inspection"
          );
        }
      } catch (error) {
        console.error("Error fetching status:", error);
        setStatus("Status Unavailable");
      }
    };

    fetchStatus();
  }, [nftId, escrow, account]);

  return (
    <div className="transaction-status">
      <span
        className={`status-badge status-${status
          .toLowerCase()
          .replace(/\s+/g, "-")}`}
      >
        {status}
      </span>
    </div>
  );
};

export default App;
