import { useEffect, useState, useMemo } from "react";
import { ethers } from "ethers";
import { ToastProvider } from "./ToastContext";

// Components
import Navigation from "./components/Navigation";
import Search from "./components/Search";
import Home from "./components/Home";
import CreateProperty from "./components/CreateProperty";
import AdminPanel from "./components/AdminPanel";

// ABIs
import RealEstate from "./abis/RealEstate.json";
import Escrow from "./abis/Escrow.json";

// Config
import config from "./config.json";

const PropertyStatus = {
  NotListed: 0,
  Listed: 1,
  UnderContract: 2,
  InspectionPending: 3,
  AwaitingApprovals: 4,
  ReadyToClose: 5,
  Sold: 6,
  Cancelled: 7,
};

const PaymentMethod = {
  DirectPurchase: 0,
  DepositAndLender: 1,
};

function App() {
  const [readProvider, setReadProvider] = useState(null);
  const [web3Provider, setWeb3Provider] = useState(null);
  const [signer, setSigner] = useState(null);

  const [escrow, setEscrow] = useState(null);
  const [realEstate, setRealEstate] = useState(null);

  const [account, setAccount] = useState(null);
  const [view, setView] = useState("market");
  const [homes, setHomes] = useState([]);
  const [home, setHome] = useState({});
  const [toggle, setToggle] = useState(false);
  const [toggleCreate, setToggleCreate] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredHomes, setFilteredHomes] = useState([]);
  const [chainPulse, setChainPulse] = useState(0);
  const bumpChain = () => setChainPulse((x) => x + 1);

  // ---- Role flags
  const [isSeller, setIsSeller] = useState(false);
  const [isInspector, setIsInspector] = useState(false);
  const [isLender, setIsLender] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminProperties, setAdminProperties] = useState({
    notListed: [],
    listed: [],
    underContract: [],
    inspectionPending: [],
    awaitingApprovals: [],
    readyToClose: [],
    sold: [],
    cancelled: []
  });

  // ---- Role data buckets
  const [buyerForSale, setBuyerForSale] = useState([]);
  const [buyerInvolving, setBuyerInvolving] = useState([]);
  const [buyerHistory, setBuyerHistory] = useState([]);

  const [sellerMyProps, setSellerMyProps] = useState([]);
  const [sellerCancelled, setSellerCancelled] = useState([]);

  const [inspectorAwaiting, setInspectorAwaiting] = useState([]);
  const [inspectorPending, setInspectorPending] = useState([]);
  const [inspectorPassed, setInspectorPassed] = useState([]);

  const [lenderAwaiting, setLenderAwaiting] = useState([]);
  const [lenderFunded, setLenderFunded] = useState([]);

  // Active tab (changes with role)
  const [activeRoleTab, setActiveRoleTab] = useState(null);
  const [statusById, setStatusById] = useState({});          // { [id]: 0..7 }
  const [listingTypeById, setListingTypeById] = useState({}); // { [id]: 0 Fixed, 1 Auction }
  const [paymentMethodById, setPaymentMethodById] = useState({}); // { [id]: 0 Direct, 1 Deposit+Lender }
  const [uiFilters, setUiFilters] = useState({
    status: new Set(),            // e.g. "Listed", "UnderContract", ...
    listingType: new Set(),       // "FixedPrice", "Auction"
    paymentMethod: new Set(),     // "Direct", "DepositAndLender"
    minPrice: "", maxPrice: "",
    minBeds: "", minBaths: ""
  });
  const [uiSort, setUiSort] = useState("relevance");

  // Map status number → name for the filter panel
  const statusNameOf = (n) =>
    ["NotListed","Listed","UnderContract","InspectionPending","AwaitingApprovals","ReadyToClose","Sold","Cancelled"][n] ?? "Unknown";

  // small helper for toggling a value in a Set immutably
  const toggleSetValue = (setObj, val) => {
    const next = new Set(setObj);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  };

  const toHttp = (u) =>
    u?.startsWith("ipfs://")
      ? u.replace("ipfs://", "https://gateway.pinata.cloud/ipfs/")
      : u;

  const coverOf = (home) => {
    const merged = [
      ...(home.image ? [home.image] : []),
      ...(Array.isArray(home.images) ? home.images : []),
    ];
    const imgs = [...new Set(merged.map(toHttp))];
    return imgs[0];
  };

  // ===== Load properties from NFT =====
  const loadProperties = async (realEstateContract) => {
    try {
      let totalSupply;
      try {
        totalSupply = await realEstateContract.totalSupply({ blockTag: "latest" });
      } catch {
        totalSupply = ethers.constants.Zero;
      }
      const homes = [];
      const n = totalSupply.toNumber ? totalSupply.toNumber() : Number(totalSupply);
      for (let i = 1; i <= n; i++) {
        let uri = await realEstateContract.tokenURI(i);
        if (uri.startsWith("ipfs://")) {
          uri = uri.replace("ipfs://", "https://gateway.pinata.cloud/ipfs/");
        }
        try {
          const response = await fetch(uri);
          if (!response.ok) throw new Error(`Fetch ${response.status}`);
          const metadata = await response.json();
          metadata.id = i;
          homes.push(metadata);
        } catch (e) {
          console.warn(`Failed to load metadata for token ${i} at ${uri}:`, e);
        }
      }
      setHomes(homes);
      setFilteredHomes(homes);
    } catch (error) {
      console.error("Error loading properties:", error);
    }
  };

  function FiltersPanel({ uiFilters, setUiFilters, uiSort, setUiSort }) {
    const onCheck = (group, value) => {
      setUiFilters(f => ({ ...f, [group]: toggleSetValue(f[group], value) }));
    };
    const onInput = (patch) => setUiFilters(f => ({ ...f, ...patch }));

    return (
      <aside className="filters-panel">
        <div className="filters-header">
          <h4>Filters</h4>
          <button
            className="link-reset"
            onClick={() => setUiFilters({
              status: new Set(), listingType: new Set(), paymentMethod: new Set(),
              minPrice: "", maxPrice: "", minBeds: "", minBaths: ""
            })}
          >
            Clear all
          </button>
        </div>

        {/*<section className="filter-group">
          <h5>Status</h5>
          {["Listed","UnderContract","InspectionPending","AwaitingApprovals","ReadyToClose","Sold","Cancelled"].map(s => (
            <label key={s} className="tick">
              <input type="checkbox"
                checked={uiFilters.status.has(s)}
                onChange={() => onCheck("status", s)} />
              <span>{s}</span>
            </label>
          ))}
        </section>*/}

        <section className="filter-group">
          <h5>Listing Type</h5>
          {["FixedPrice","Auction"].map(s => (
            <label key={s} className="tick">
              <input type="checkbox"
                checked={uiFilters.listingType.has(s)}
                onChange={() => onCheck("listingType", s)} />
              <span>{s}</span>
            </label>
          ))}
        </section>

        <section className="filter-group">
          <h5>Payment Method</h5>
          {["Direct","DepositAndLender"].map(s => (
            <label key={s} className="tick">
              <input type="checkbox"
                checked={uiFilters.paymentMethod.has(s)}
                onChange={() => onCheck("paymentMethod", s)} />
              <span>{s}</span>
            </label>
          ))}
        </section>

        <section className="filter-group two-col">
          <h5>Price (ETH)</h5>
          <input type="number" placeholder="Min"
            value={uiFilters.minPrice}
            onChange={e => onInput({ minPrice: e.target.value })} />
          <input type="number" placeholder="Max"
            value={uiFilters.maxPrice}
            onChange={e => onInput({ maxPrice: e.target.value })} />
        </section>

        <section className="filter-group two-col">
          <h5>Beds / Baths</h5>
          <input type="number" placeholder="Min beds"
            value={uiFilters.minBeds}
            onChange={e => onInput({ minBeds: e.target.value })} />
          <input type="number" placeholder="Min baths"
            value={uiFilters.minBaths}
            onChange={e => onInput({ minBaths: e.target.value })} />
        </section>

        <section className="filter-group">
          <h5>Sort</h5>
          <select value={uiSort} onChange={(e)=>setUiSort(e.target.value)}>
            <option value="relevance">Relevance</option>
            <option value="priceAsc">Price: Low → High</option>
            <option value="priceDesc">Price: High → Low</option>
            <option value="newest">Newest</option>
            <option value="beds">Beds (desc)</option>
            <option value="baths">Baths (desc)</option>
          </select>
        </section>
      </aside>
    );
  }


  const refreshProperties = async () => {
    if (realEstate) await loadProperties(realEstate);
  };

  const handleSearchChange = (query) => {
    setSearchQuery(query);
    if (query.trim() === "") {
      setFilteredHomes(homes);
    } else {
      const filtered = homes.filter(
        (home) =>
          (home.address || "").toLowerCase().includes(query.toLowerCase()) ||
          (home.attributes &&
            home.attributes.some((attr) =>
              String(attr.value || "")
                .toLowerCase()
                .includes(query.toLowerCase())
            ))
      );
      setFilteredHomes(filtered);
    }
  };

  // Wallet listeners
  useEffect(() => {
    if (!window.ethereum) return;
    const handleChain = () => window.location.reload();
    const handleAccounts = () => window.location.reload();
    window.ethereum.on("chainChanged", handleChain);
    window.ethereum.on("accountsChanged", handleAccounts);
    return () => {
      window.ethereum.removeListener("chainChanged", handleChain);
      window.ethereum.removeListener("accountsChanged", handleAccounts);
    };
  }, []);

  // Boot providers/contracts + initial data
  useEffect(() => {
    if (!window.ethereum) return;

    let handleAccountsChanged, handleChainChanged;

    const init = async () => {
      
      // 1) Use the wallet provider to detect network
      const wp = new ethers.providers.Web3Provider(window.ethereum, "any");
      setWeb3Provider(wp);
      const signer = wp.getSigner();
      setSigner(signer);

      const accounts = await wp.send("eth_requestAccounts", []);
      setAccount(ethers.utils.getAddress(accounts[0]));

      // 2) Get the network FROM wp (not rp)
      const net = await wp.getNetwork();

      // 3) Option A: use the wallet provider for reads too (simplest)
      const RPCS = {
        31337: "http://127.0.0.1:8545",
        11155111: process.env.REACT_APP_SEPOLIA_RPC, // Infura/Alchemy URL
      };

      // Fallback to wallet provider if you don't have a separate RPC for that chain
      const rpUrl = RPCS[net.chainId];
      const rp = rpUrl ? new ethers.providers.JsonRpcProvider(rpUrl) : wp;
      setReadProvider(rp);

      // 4) Load addresses for the wallet’s chain
      const chainCfg = config[net.chainId];
      if (!chainCfg) { console.error(`No config for chainId ${net.chainId}`); return; }

      // 5) Build contracts with the read provider that matches that chain
      const realEstate = new ethers.Contract(chainCfg.realEstate.address, RealEstate, wp);
      const escrow     = new ethers.Contract(chainCfg.escrow.address,     Escrow,     wp);
      setRealEstate(realEstate);
      setEscrow(escrow);

      await loadProperties(realEstate);

      handleAccountsChanged = async () => {
        const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
        setAccount(ethers.utils.getAddress(accs[0]));
        setSigner(wp.getSigner());
      };
      handleChainChanged = () => window.location.reload();

      window.ethereum.on("accountsChanged", handleAccountsChanged);
      window.ethereum.on("chainChanged", handleChainChanged);
    };

    init();

    return () => {
      if (window.ethereum) {
        if (handleAccountsChanged) window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
        if (handleChainChanged) window.ethereum.removeListener("chainChanged", handleChainChanged);
      }
    };
  }, []);

  // Chain event → pulse
  useEffect(() => {
    if (!escrow) return;
    const onStatus = () => setChainPulse((x) => x + 1);
    const onFinalized = () => setChainPulse((x) => x + 1);
    escrow.on("PropertyStatusChanged", onStatus);
    escrow.on("SaleFinalized", onFinalized);
    return () => {
      escrow.off("PropertyStatusChanged", onStatus);
      escrow.off("SaleFinalized", onFinalized);
    };
  }, [escrow]);

  const togglePop = (home) => { setHome(home); setToggle((t) => !t); };
  const toggleCreateForm = () => setToggleCreate((t) => !t);

  // ===== Role detection (from contract singletons) =====
  useEffect(() => {
    (async () => {
      try {
        if (!escrow || !account) {
          setIsSeller(false); setIsInspector(false); setIsLender(false);
          return;
        }
        const [seller, inspector, lender] = await Promise.all([
          escrow.getSeller(),
          escrow.inspector(),
          escrow.lender(),
        ]);
        setIsSeller(seller?.toLowerCase?.() === account.toLowerCase());
        setIsInspector(inspector?.toLowerCase?.() === account.toLowerCase());
        setIsLender(lender?.toLowerCase?.() === account.toLowerCase());
      } catch (e) {
        console.warn("role detection failed", e);
        setIsSeller(false); setIsInspector(false); setIsLender(false);
      }
    })();
  }, [escrow, account, chainPulse]);
  
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        if (!account || !escrow) return setIsAdmin(false);
        const ADMIN_ROLE = ethers.utils.id("ADMIN_ROLE");
        const onEscrow = await escrow.hasRole(ADMIN_ROLE, account);
        let onRealEstate = false;
        if (realEstate?.hasRole) {
          onRealEstate = await realEstate.hasRole(ADMIN_ROLE, account);
        }
        setIsAdmin(onEscrow || onRealEstate);
      } catch (e) {
        console.error("checkAdmin failed:", e);
        setIsAdmin(false);
      }
    };
    checkAdmin();
  }, [account, escrow, realEstate]);

  useEffect(() => {
    const organizePropertiesByStatus = async () => {
      if (!escrow || !isAdmin || homes.length === 0) return;
      
      const statusBuckets = {
        notListed: [],
        listed: [],
        underContract: [],
        inspectionPending: [],
        awaitingApprovals: [],
        readyToClose: [],
        sold: [],
        cancelled: []
      };
      
      for (const home of homes) {
        if (!home.id) continue;
        
        try {
          const details = await escrow.getPropertyDetails(home.id);
          const status = Number(details[4]);
          
          switch (status) {
            case PropertyStatus.NotListed:
              statusBuckets.notListed.push(home);
              break;
            case PropertyStatus.Listed:
              statusBuckets.listed.push(home);
              break;
            case PropertyStatus.UnderContract:
              statusBuckets.underContract.push(home);
              break;
            case PropertyStatus.InspectionPending:
              statusBuckets.inspectionPending.push(home);
              break;
            case PropertyStatus.AwaitingApprovals:
              statusBuckets.awaitingApprovals.push(home);
              break;
            case PropertyStatus.ReadyToClose:
              statusBuckets.readyToClose.push(home);
              break;
            case PropertyStatus.Sold:
              statusBuckets.sold.push(home);
              break;
            case PropertyStatus.Cancelled:
              statusBuckets.cancelled.push(home);
              break;
          }
        } catch (e) {
          console.error(`Failed to get details for property ${home.id}:`, e);
        }
      }
      
      setAdminProperties(statusBuckets);
    };
    
    organizePropertiesByStatus();
  }, [escrow, homes, isAdmin, chainPulse]);

  // ===== Build role buckets from on-chain reads + events =====
  useEffect(() => {
    (async () => {
      if (!escrow || !readProvider || homes.length === 0) return;

      // Common helpers
      const getDetails = async (id) => {
        const d = await escrow.getPropertyDetails(id, { blockTag: "latest" });
        return {
          price: d[0],
          escrowAmt: d[1],
          paidAmount: d[2],
          buyer: d[3],
          status: Number(d[4]),
          listingType: Number(d[5]),
          paymentMethod: Number(d[6]),
          inspectionPassed: Boolean(d[7]),
          conditions: d[8],
          listedAt: d[9],
          contractSignedAt: d[10],
        };
      };

      const inBidders = async (id, who) => {
        try {
          const addrs = await escrow.getBidders(id);
          if (!addrs || !addrs.length) return false;
          if (!who) return false;
          const found = addrs.some((a) => a?.toLowerCase?.() === who.toLowerCase());
          if (!found) return false;
          const amt = await escrow.getBidAmount(id, who);
          return amt.gt(0);
        } catch {
          return false;
        }
      };

      // Buyer tabs
      const buyerForSale = [];
      const buyerInvolving = [];
      const buyerHistory = [];

      // Seller tabs
      const sellerMine = [];
      const sellerCancelled = [];

      // Inspector tabs
      const inspectorAwait = [];
      const inspectorPending = [];
      const inspectorPassed = [];

      // Lender tabs
      const lenderAwait = [];
      const lenderFunded = [];

      // Pre-fetch fixed singletons
      let sellerAddr = null, inspectorAddr = null, lenderAddr = null;
      try {
        [sellerAddr, inspectorAddr, lenderAddr] = await Promise.all([
          escrow.getSeller(),
          escrow.inspector(),
          escrow.lender(),
        ]);
      } catch {}

      // Buyer history: SaleFinalized(buyer==account)
      let buyerFinalizedByEvent = new Set();
      if (account) {
        try {
          const fromBlock = 0, toBlock = "latest";
          const filter = escrow.filters.SaleFinalized(null, account, null);
          const logs = await escrow.queryFilter(filter, fromBlock, toBlock);
          logs.forEach((log) => buyerFinalizedByEvent.add(Number(log.args?.nftId ?? log.args?.[0])));
        } catch (e) {
          console.warn("SaleFinalized query failed", e);
        }
      }

      // Inspector passed by-me: InspectionUpdated(passed=true, inspector==account)
      let passedByMe = new Set();
      if (isInspector && account) {
        try {
          const fromBlock = 0, toBlock = "latest";
          const filter = escrow.filters.InspectionUpdated(); // no args
          const logs = await escrow.queryFilter(filter, fromBlock, toBlock);
          for (const log of logs) {
            const passed = Boolean(log.args?.passed ?? log.args?.[1]);
            const who    = String(log.args?.inspector ?? log.args?.[2]).toLowerCase();
            if (passed && who === account.toLowerCase()) {
              passedByMe.add(Number(log.args?.nftId ?? log.args?.[0]));
            }
          }
        } catch (e) {
          console.warn("InspectionUpdated query failed", e);
        }
      }

      // Lender funded: FundsReceived(from==lenderAddr)
      let fundedByLender = new Set();

      try {
        const fromBlock = 0, toBlock = "latest";

        // If you want "Funded (by me)" -> filter by the connected account
        if (account) {
          const filterByMe = escrow.filters.FundsReceived(null, account, null);
          const logsByMe = await escrow.queryFilter(filterByMe, fromBlock, toBlock);
          logsByMe.forEach(log => {
            fundedByLender.add(Number(log.args?.nftId ?? log.args?.[0]));
          });
        }

        // If you ALSO want “Funded by protocol lender address” (optional)
        // keep this block, otherwise delete it.
        if (lenderAddr) {
          const filterByLenderAddr = escrow.filters.FundsReceived(null, lenderAddr, null);
          const logsByLenderAddr = await escrow.queryFilter(filterByLenderAddr, fromBlock, toBlock);
          logsByLenderAddr.forEach(log => {
            fundedByLender.add(Number(log.args?.nftId ?? log.args?.[0]));
          });
        }
      } catch (e) {
        console.warn("FundsReceived query failed", e);
      }

      // Walk all homes once
      const _statusById = {};
      const _listingTypeById = {};
      const _paymentMethodById = {};

      for (const h of homes) {
        const id = h.id;
        if (!id) continue;

        let det;
        try { det = await getDetails(id); } catch { continue; }
        _statusById[id]       = det.status;
        _listingTypeById[id]  = det.listingType;
        _paymentMethodById[id]= det.paymentMethod;

        // Buyer
        if (det.status === PropertyStatus.Listed) {
          buyerForSale.push(h);
        }
        if (account) {
          const isBuyer = det.buyer && det.buyer.toLowerCase() === account.toLowerCase();
          const hasBid = det.listingType === 1 && det.status === PropertyStatus.Listed
            ? await inBidders(id, account)
            : false;

          if (isBuyer || hasBid) buyerInvolving.push(h);
          if (buyerFinalizedByEvent.has(id) || det.status === PropertyStatus.Sold && isBuyer) {
            buyerHistory.push(h);
          }
        }

        // Seller
        if (sellerAddr) {
          // All properties in this dapp are minted by the seller wallet and escrowed, so “mine” can be every token.
          // If you want only active: filter by not Cancelled
          if (det.status !== PropertyStatus.Cancelled) sellerMine.push(h);
          if (det.status === PropertyStatus.Cancelled) sellerCancelled.push(h);
        }

        // Inspector
        if (inspectorAddr) {
          // Awaiting inspection = UnderContract & requiresInspection & !inspectionPassed
          const requires = Boolean(det?.conditions?.requiresInspection);
          if (det.status === PropertyStatus.UnderContract && requires && !det.inspectionPassed) {
            inspectorAwait.push(h);
          }
          if (det.status === PropertyStatus.InspectionPending && requires && !det.inspectionPassed) {
            inspectorPending.push(h);
          }
          if (passedByMe.has(id)) inspectorPassed.push(h);
        }

        // Lender
        if (lenderAddr) {
          const awaiting = det.status === PropertyStatus.AwaitingApprovals &&
                           det.paymentMethod === PaymentMethod.DepositAndLender;
          if (awaiting) {
            try {
              const [bOK, sOK, lOK] = await escrow.getApprovalStatus(id);
              if (!lOK) lenderAwait.push(h);
            } catch {}
          }
          if (fundedByLender.has(id)) lenderFunded.push(h);
        }
      }

      setStatusById(_statusById);
      setListingTypeById(_listingTypeById);
      setPaymentMethodById(_paymentMethodById);

      setBuyerForSale(buyerForSale);
      setBuyerInvolving(buyerInvolving);
      setBuyerHistory(buyerHistory);

      setSellerMyProps(sellerMine);
      setSellerCancelled(sellerCancelled);

      setInspectorAwaiting(inspectorAwait);
      setInspectorPending(inspectorPending);
      setInspectorPassed(inspectorPassed);

      setLenderAwaiting(lenderAwait);
      setLenderFunded(lenderFunded);
    })();
}, [escrow, readProvider, homes, account, isInspector, isLender, chainPulse]);

  // Pick default active tab when role changes
  useEffect(() => {
    if (isAdmin) {
      setActiveRoleTab("admin:all");
    } else if (isSeller) {
      setActiveRoleTab("seller:mine");
    } else if (isInspector) {
      setActiveRoleTab("inspector:await");
    } else if (isLender) {
      setActiveRoleTab("lender:await");
    } else {
      setActiveRoleTab("buyer:forSale");
    }
  }, [isSeller, isInspector, isLender, isAdmin]);


  useEffect(() => {
    const go = () => setView("admin");
    window.addEventListener("NAV:GOTO_ADMIN", go);
    return () => window.removeEventListener("NAV:GOTO_ADMIN", go);
  }, []);

  const priceOf = (h) => Number(h.attributes?.[0]?.value || 0);
  const bedsOf  = (h) => Number(h.attributes?.[2]?.value || 0);
  const bathsOf = (h) => Number(h.attributes?.[3]?.value || 0);

  const applySearch = (arr) => {
    if (!searchQuery) return arr;
    const q = searchQuery.toLowerCase();
    return arr.filter((h) =>
      (h.address || "").toLowerCase().includes(q) ||
      (h.attributes || []).some(a => String(a.value || "").toLowerCase().includes(q))
    );
  };

  const applyFilters = (arr) => {
    if (!arr?.length) return arr;
    return arr.filter(h => {
      const id = h.id;
      const statusNum       = statusById[id];
      const listingTypeNum  = listingTypeById[id];
      const paymentMethodNum= paymentMethodById[id];

      // Status
      /*if (uiFilters.status.size) {
        const name = statusNameOf(statusNum);
        if (!uiFilters.status.has(name)) return false;
      }*/

      // Listing type
      if (uiFilters.listingType.size) {
        const isAuction = listingTypeNum === 1;
        if (uiFilters.listingType.has("Auction") && !isAuction) return false;
        if (uiFilters.listingType.has("FixedPrice") && isAuction) return false;
      }

      // Payment method
      if (uiFilters.paymentMethod.size) {
        const isDeposit = paymentMethodNum === 1;
        if (uiFilters.paymentMethod.has("Direct") && isDeposit) return false;
        if (uiFilters.paymentMethod.has("DepositAndLender") && !isDeposit) return false;
      }

      // Price / beds / baths
      const p = priceOf(h), b = bedsOf(h), ba = bathsOf(h);
      if (uiFilters.minPrice && p < Number(uiFilters.minPrice)) return false;
      if (uiFilters.maxPrice && p > Number(uiFilters.maxPrice)) return false;
      if (uiFilters.minBeds  && b < Number(uiFilters.minBeds))  return false;
      if (uiFilters.minBaths && ba < Number(uiFilters.minBaths)) return false;

      return true;
    });
  };

  const applySort = (arr) => {
    const copy = [...arr];
    switch (uiSort) {
      case "priceAsc":  return copy.sort((a,b) => priceOf(a) - priceOf(b));
      case "priceDesc": return copy.sort((a,b) => priceOf(b) - priceOf(a));
      case "beds":      return copy.sort((a,b) => bedsOf(b)  - bedsOf(a));
      case "baths":     return copy.sort((a,b) => bathsOf(b) - bathsOf(a));
      case "newest":
        // If you track listedAt/mintedAt in metadata, sort by that here.
        // For now keep the existing order:
        return copy;
      default:          return copy; // relevance keeps role bucket order
    }
  };



  // Cards to show for the current role tab (with search filter applied)
  const currentCards = useMemo(() => {
    // 1) Choose base array by role tab
    let base;
    if (activeRoleTab?.startsWith("admin:")) {
      switch (activeRoleTab) {
        case "admin:all":        base = homes; break;
        case "admin:notListed":  base = adminProperties.notListed; break;
        case "admin:listed":     base = adminProperties.listed; break;
        case "admin:contract":   base = adminProperties.underContract; break;
        case "admin:inspection": base = adminProperties.inspectionPending; break;
        case "admin:approvals":  base = adminProperties.awaitingApprovals; break;
        case "admin:sold":       base = adminProperties.sold; break;
        case "admin:cancelled":  base = adminProperties.cancelled; break;
        default:                 base = homes;
      }
    } else {
      switch (activeRoleTab) {
        case "buyer:forSale":     base = buyerForSale; break;
        case "buyer:involv":      base = buyerInvolving; break;
        case "buyer:history":     base = buyerHistory; break;

        case "seller:mine":       base = sellerMyProps; break;
        case "seller:cancel":     base = sellerCancelled; break;

        case "inspector:await":   base = inspectorAwaiting; break;
        case "inspector:pending": base = inspectorPending; break;
        case "inspector:pass":    base = inspectorPassed; break;

        case "lender:await":      base = lenderAwaiting; break;
        case "lender:funded":     base = lenderFunded; break;

        default:                  base = filteredHomes;
      }
    }

    // 2) Pipe through search → filters → sort
    return applySort(applyFilters(applySearch(base || [])));
  }, [
    activeRoleTab,                       // tab switch
    homes, adminProperties,              // admin data
    buyerForSale, buyerInvolving, buyerHistory,
    sellerMyProps, sellerCancelled,
    inspectorAwaiting, inspectorPending, inspectorPassed,
    lenderAwaiting, lenderFunded,
    filteredHomes,                       // fallback
    // lookup maps & UI
    statusById, listingTypeById, paymentMethodById,
    uiFilters, uiSort, searchQuery
  ]);


  const RoleTabs = () => {
    // Build the tab strip based on detected role
    const tabs = [];

    // Admin tabs (priority if admin)
    if (isAdmin) {
      tabs.push(
        { id: "admin:all", label: "All Properties", className: "admin-tab" },
        { id: "admin:listed", label: "Listed" },
        { id: "admin:contract", label: "Under Contract" },
        { id: "admin:inspection", label: "Inspection" },
        { id: "admin:approvals", label: "Approvals" },
        { id: "admin:sold", label: "Sold" },
        { id: "admin:cancelled", label: "Cancelled" }
      );
    } else if (!isSeller && !isInspector && !isLender) {
      tabs.push(
        { id: "buyer:forSale", label: "For Sale" },
        { id: "buyer:involv",  label: "My Activity" },
        { id: "buyer:history", label: "My Purchases" }
      );
    }

    if (isSeller) {
      tabs.push(
        { id: "seller:mine",   label: "My Properties" },
        { id: "seller:cancel", label: "Cancelled" },
      );
    }
    if (isInspector) {
      tabs.push(
        { id: "inspector:await", label: "Awaiting Inspection" },
        { id: "inspector:pending", label: "Inspection Pending" },
        { id: "inspector:pass",  label: "Passed (by me)" },
      );
    }
    if (isLender) {
      tabs.push(
        { id: "lender:await",  label: "Awaiting Lender" },
        { id: "lender:funded", label: "Funded (by me)" },
      );
    }


    return (
      <div className="role-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveRoleTab(t.id)}
            className={`role-tab ${activeRoleTab === t.id ? "active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>
    );
  };

  const AdminStatistics = () => {
    if (!isAdmin) return null;

    const stats = {
      total: homes.length,
      listed: adminProperties.listed.length,
      underContract: adminProperties.underContract.length,
      pending: adminProperties.inspectionPending.length + adminProperties.awaitingApprovals.length,
      sold: adminProperties.sold.length,
      cancelled: adminProperties.cancelled.length
    };

    return (
      <div className="admin-stats-bar">
        <div className="stat-item">
          <span className="stat-label">Total</span>
          <span className="stat-value">{stats.total}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Listed</span>
          <span className="stat-value text-success">{stats.listed}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">In Progress</span>
          <span className="stat-value text-warning">{stats.underContract}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Pending</span>
          <span className="stat-value text-info">{stats.pending}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Sold</span>
          <span className="stat-value">{stats.sold}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Cancelled</span>
          <span className="stat-value text-danger">{stats.cancelled}</span>
        </div>
      </div>
    );
  };

  return (
    <div>
      <ToastProvider>
        <Navigation
          account={account}
          setAccount={setAccount}
          toggleCreateForm={toggleCreateForm}
          toggleAdminPanel={() => setShowAdmin((v) => !v)}
          escrow={escrow}
          realEstate={realEstate}
        />

        <Search searchQuery={searchQuery} setSearchQuery={handleSearchChange} />

        {/* Admin Statistics Bar */}
        {isAdmin && <AdminStatistics />}

        <div className="market-layout">
          <FiltersPanel
            uiFilters={uiFilters}
            setUiFilters={setUiFilters}
            uiSort={uiSort}
            setUiSort={setUiSort}
          />
          {/* Role-based tab strip */}
          <div className="cards__section">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <h3>{isAdmin ? "🛡️ Admin Dashboard" : "Marketplace"}</h3>
              <RoleTabs />
            </div>
            <hr />
      
            <div className="cards">
              {currentCards.length > 0 ? (
                currentCards.map((home, index) => (
                  <div className="card" key={`${home.id}-${index}`} onClick={() => togglePop(home)}>
                    <div className="card__image">
                      <img src={coverOf(home)} alt="Home" />
                    </div>
                    <div className="card__info">
                      <h4>{home.attributes?.[0]?.value ?? "—"} ETH</h4>
                      <p>
                        <strong>{home.attributes?.[2]?.value ?? "—"}</strong> bds |{" "}
                        <strong>{home.attributes?.[3]?.value ?? "—"}</strong> ba |{" "}
                        <strong>{home.attributes?.[4]?.value ?? "—"}</strong> sqft
                      </p>
                      <p>{home.address ?? "—"}</p>
                    </div>

                    {home.id && (
                      <TransactionStatus
                        nftId={home.id}
                        escrow={escrow}
                        account={account}
                        chainPulse={chainPulse}
                        isAdmin={isAdmin}
                      />
                    )}
                  </div>
                ))
              ) : (
                <p className="no-results">
                  {isAdmin ? "No properties found in this status category." : "No properties found for this tab."}
                </p>
              )}
            </div>
          </div>
        </div>


        {toggle && (
          <Home
            home={home}
            provider={readProvider}
            signer={signer}
            account={account}
            escrow={escrow}
            realEstate={realEstate}
            togglePop={togglePop}
            onChainUpdate={bumpChain}
            isAdmin={isAdmin}
          />
        )}

        {toggleCreate && (
          <CreateProperty
            provider={readProvider}
            account={account}
            signer={signer}
            realEstate={realEstate}
            escrow={escrow}
            setToggleCreate={setToggleCreate}
            refreshProperties={refreshProperties}
          />
        )}

        {showAdmin && (
          <AdminPanel
            provider={readProvider}
            signer={signer}
            account={account}
            escrow={escrow}
            realEstate={realEstate}
            onClose={() => setShowAdmin(false)}
            adminProperties={adminProperties}
            isAdmin={isAdmin}
          />
        )}
      </ToastProvider>
    </div>
  );
}

// === Status badge ===
const TransactionStatus = ({ nftId, escrow, account, chainPulse, isAdmin }) => {
  const [status, setStatus] = useState("Loading...");
  const [buyer, setBuyer] = useState(null);

  useEffect(() => {
    const fetchStatus = async () => {
      if (!escrow || !nftId) return;
      try {
        const d = await escrow.getPropertyDetails(nftId);
        const buyerAddr = d[3];
        const propertyStatus = Number(d[4]);
        const inspectionPassed = Boolean(d[7]);
        const seller = await escrow.getSeller();

        setBuyer(buyerAddr !== ethers.constants.AddressZero ? buyerAddr : null);

        switch (propertyStatus) {
          case 0: setStatus("Not Listed"); break;
          case 1: {
            if (buyerAddr === ethers.constants.AddressZero) {
              setStatus("For Sale");
            } else if (!isAdmin && account && buyerAddr && account.toLowerCase() === buyerAddr.toLowerCase()) {
              const approved = await escrow.getApproval(nftId, buyerAddr);
              setStatus(approved ? "Awaiting Others" : "Action Required");
            } else if (!isAdmin && account && seller && account.toLowerCase() === seller.toLowerCase()) {
              const approved = await escrow.getApproval(nftId, seller);
              setStatus(approved ? "Awaiting Others" : "Awaiting Approval");
            } else {
              setStatus(inspectionPassed ? "Inspection Passed" : "Awaiting Inspection");
            }
            break;
          }
          case 2: setStatus("Under Contract"); break;
          case 3: setStatus("Inspection Pending"); break;
          case 4: setStatus("Awaiting Approvals"); break;
          case 5: setStatus("Ready To Close"); break;
          case 6: setStatus("Sold"); break;
          case 7: setStatus("Cancelled"); break;
          default: setStatus("Status Unknown");
        }
      } catch (err) {
        console.error("Error fetching status:", err);
        setStatus("Status Unavailable");
      }
    };
    fetchStatus();
  }, [nftId, escrow, account, chainPulse, isAdmin]);

  return (
    <div className="transaction-status">
      <span className={`status-badge status-${status.toLowerCase().replace(/\s+/g, "-")}`}>
        {status}
      </span>
    </div>
  );
};

export default App;