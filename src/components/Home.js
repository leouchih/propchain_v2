import { ethers } from "ethers";
import { useEffect, useState } from "react";
import { useToast } from "../ToastContext";
import close from "../assets/close.svg";
import EnhancedImageGallery from "./EnhancedImageGallery";
import BlockchainDetails from './BlockchainDetails'

async function api(path, options = {}) {
  const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.REACT_APP_BACKEND_TOKEN}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export const PropertyStatus = {
  NotListed: 0,
  Listed: 1,
  UnderContract: 2,
  InspectionPending: 3,
  AwaitingApprovals: 4,
  ReadyToClose: 5,
  Sold: 6,
  Cancelled: 7,
};

export const PaymentMethod = {
  DirectPurchase: 0,
  DepositAndLender: 1,
};

const Home = ({ home, provider, signer, account, escrow, togglePop, refreshData, onChainUpdate }) => {
  const [hasBought, setHasBought] = useState(false);
  const [hasLended, setHasLended] = useState(false);
  const [hasInspected, setHasInspected] = useState(false);
  const [hasSold, setHasSold] = useState(false);

  const [isAllowlisted, setIsAllowlisted] = useState(false);
  const [hasCredential, setHasCredential] = useState(false);
  const [unlockAt, setUnlockAt] = useState(0);
  const [inspectionDeadline, setInspectionDeadline] = useState(null); 
  const [inspectionExpired, setInspectionExpired] = useState(false);
  const [buyer, setBuyer] = useState(null);
  const [lender, setLender] = useState(null);
  const [inspector, setInspector] = useState(null);
  const [seller, setSeller] = useState(null);
  const [owner, setOwner] = useState(null);
  const [nftAddress, setNftAddress] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState('details');

  const amSeller    = !!(account && seller    && account.toLowerCase() === seller.toLowerCase());
  const amLender    = !!(account && lender    && account.toLowerCase() === lender.toLowerCase());
  const amInspector = !!(account && inspector && account.toLowerCase() === inspector.toLowerCase());
  const isPrivileged = amSeller || amLender || amInspector || isAdmin;

  // toast/snackbar
  const toast = useToast();

  const [kycStatus, setKycStatus] = useState("UNKNOWN"); // UNKNOWN | UNVERIFIED | PENDING | APPROVED | VERIFIED | FAILED
  const [verifying, setVerifying] = useState(false);
  const [kycUrl, setKycUrl] = useState(null);
  const [kycErr, setKycErr] = useState(null);

  const nudge = () => onChainUpdate?.();

  const toHttp = (u) =>
    u?.startsWith("ipfs://")
      ? u.replace("ipfs://", "https://gateway.pinata.cloud/ipfs/")
      : u;

  const merged = [
    ...(home?.image ? [home.image] : []),
    ...(Array.isArray(home?.images) ? home.images : []),
  ];
  const images = [...new Set(merged.map(toHttp))];

  // State aligned to Escrow.sol
  const [propertyStatus, setPropertyStatus] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [purchasePrice, setPurchasePrice] = useState(ethers.constants.Zero);
  const [escrowAmount, setEscrowAmount] = useState(ethers.constants.Zero);
  const [canPlaceBid, setCanPlaceBid] = useState(false);
  const [canPurchaseDirectly, setCanPurchaseDirectly] = useState(false);
  const [bidAmount, setBidAmount] = useState("");
  const [userBid, setUserBid] = useState(ethers.constants.Zero);
  const [bidders, setBidders] = useState([]);
  const [highest, setHighest] = useState(null);
  const [listingType, setListingType] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState(0);
  const [bidMethod, setBidMethod] = useState(PaymentMethod.DirectPurchase);
  const [auctionInfo, setAuctionInfo] = useState(null);

  /*const PropertyStatus = {
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
  };*/

  const startKyc = async () => {
    try {
      if (kycStatus === 'VERIFIED') {
        toast.success("You're already verified.");
        return;
      }
      if (!account) { toast.error("Connect your wallet first"); return; }
      setVerifying(true); setKycErr(null);
      /*const body = {
        userRef: account,
        vendor_data: account,
        minimum_age: Number(process.env.REACT_APP_KYC_MINIMUM_AGE || 18),
        perform_document_liveness: (process.env.REACT_APP_KYC_DOC_LIVENESS || "true") === "true",
        invalid_mrz_action: process.env.REACT_APP_KYC_INVALID_MRZ_ACTION || "DECLINE",
        expiration_date_not_detected_action: process.env.REACT_APP_KYC_EXP_DATE_NOT_DETECTED_ACTION || "DECLINE",
        inconsistent_data_action: process.env.REACT_APP_KYC_INCONSISTENT_DATA_ACTION || "DECLINE",
      };*/
      const { sessionUrl } = await api("/api/verification/session", {
        method: "POST",
        body: JSON.stringify({ userRef: account }),
      });
      setKycUrl(sessionUrl);
      // open in a new tab so your dapp stays mounted
      window.open(sessionUrl, "_blank", "noopener,noreferrer");
      toast.info?.("Verification window opened. I’ll watch for approval…");
    } catch (err) {
      console.error("KYC session error:", err);
      setKycErr(err.message);
      toast.error("Could not start verification");
    } finally {
      setVerifying(false);
    }
  };

    // poll the backend status endpoint so UI flips quickly after Didit webhook
  useEffect(() => {
    let t;
    const tick = async () => {
      try {
        if (!account) {
          setKycStatus("UNKNOWN");
          return;
        }

        // fetch off-chain KYC status
        const data = await api(`/api/verification/status/${account}`, { method: "GET" });
        let s = (data?.status || "UNVERIFIED").toUpperCase();

        if (s === "APPROVED") {
          // webhook approved but contract might not be updated yet
          s = "PENDING";
        }

        // update status first
        setKycStatus(s);

        // if pending or already verified, check contract state
        if (s === "PENDING" || s === "VERIFIED") {
          try {
            const [allow, cred] = await Promise.all([
              escrow?.isAllowlisted?.(account),
              escrow?.hasCredential?.(account),
            ]);

            setIsAllowlisted(Boolean(allow));
            setHasCredential(Boolean(cred));

            // 👇 flip to VERIFIED once both contract checks pass
            if (s === "PENDING" && allow && cred) {
              setKycStatus("VERIFIED");
            }
          } catch (err) {
            console.error("on-chain compliance check failed", err);
          }
        }
      } catch (e) {
        // don’t crash UI if backend is offline
        console.warn("kyc polling error", e);
      } finally {
        // poll every 5s until verified
        t = setTimeout(tick, 5000);
      }
    };

    tick();
    return () => t && clearTimeout(t);
  }, [account, escrow]);

  useEffect(() => {
    let alive = true;
    async function syncKyc() {
      if (!account) { setKycStatus('UNKNOWN'); return; }
      try {
        const res = await api(`/api/verification/status/${account}`);
        if (!alive) return;
        setKycStatus((res?.status || 'UNKNOWN').toUpperCase());
      } catch (e) {
        if (!alive) return;
        setKycStatus('UNKNOWN');
      }
    }
    syncKyc();
    // optional: re-poll every 5–10s while not verified
    const t = setInterval(() => { if (kycStatus !== 'VERIFIED') syncKyc(); }, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [account, kycStatus]);


  const fmtEth = (bn) => (bn ? ethers.utils.formatEther(bn) : "0");
  const cut = (addr) => (addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "");

  const fetchDetails = async () => {
    try {
      if (!escrow || !home?.id) return;

      const _nftAddress = await escrow.nftAddress();
      setNftAddress(_nftAddress);

      const details = await escrow.getPropertyDetails(home.id, { blockTag: "latest" });
      
      const [
        price,
        escrowAmt,
        /* paidAmount */,
        currentBuyer,
        status,
        _listingType,
        _paymentMethod,
        inspectionStatus,
        conditions, 
        _listedAt,           
        _contractSignedAt
      ] = details;

      setPurchasePrice(price);
      setEscrowAmount(escrowAmt);
      setBuyer(currentBuyer);
      setPropertyStatus(Number(status));
      setHasInspected(Boolean(inspectionStatus));
      setListingType(Number(_listingType));
      setPaymentMethod(Number(_paymentMethod));
      setHasInspected(Boolean(inspectionStatus));

      try {
        const deadline = Number(_contractSignedAt) + Number(conditions?.inspectionPeriod || 0);
        setInspectionDeadline(deadline || null);

        // you can compute locally, or query the contract’s isInspectionPeriodExpired
        const expired = deadline ? (Math.floor(Date.now()/1000) > deadline) : false;
        setInspectionExpired(expired);
      } catch {}

      if (Number(status) === PropertyStatus.Sold && _nftAddress && provider) {
        try {
          const nftContract = new ethers.Contract(
            _nftAddress,
            ["function ownerOf(uint256) view returns (address)"],
            provider
          );
          const currentOwner = await nftContract.ownerOf(home.id);
          setOwner(currentOwner);
        } catch (e) {
          console.error("ownerOf failed", e);
        }
      }

      const step = await escrow.getCurrentStep(home.id, { blockTag: "latest" });
      setCurrentStep(Number(step));

      const _inspector = await escrow.inspector({ blockTag: "latest" });
      const _lender = await escrow.lender({ blockTag: "latest" });
      const _seller = await escrow.getSeller({ blockTag: "latest" });
      setInspector(_inspector);
      setLender(_lender);
      setSeller(_seller);

      if (currentBuyer && currentBuyer !== ethers.constants.AddressZero) {
        const [buyerApproved, sellerApproved, lenderApproved] = await escrow.getApprovalStatus(home.id);
        setHasBought(Boolean(buyerApproved));
        setHasSold(Boolean(sellerApproved));
        setHasLended(Boolean(lenderApproved));
      } else {
        setHasBought(false);
        setHasSold(false);
        setHasLended(false);
      }

      const canBid = await escrow.canPlaceBid(home.id, { blockTag: "latest" });
      const canPurchase = await escrow.canPurchaseDirectly(home.id, { blockTag: "latest" });
      setCanPlaceBid(Boolean(canBid));
      setCanPurchaseDirectly(Boolean(canPurchase));

      if (Number(status) === PropertyStatus.Listed && account) {
        const currentBid = await escrow.getBidAmount(home.id, account, { blockTag: "latest" });
        setUserBid(currentBid);
      } else {
        setUserBid(ethers.constants.Zero);
      }
    } catch (error) {
      console.error("Error fetching property details:", error);
    }
  };

  async function requireBuyerCompliance(escrow, account, toast, amSeller, amLender, amInspector, isAdmin) {
    if (amSeller || amLender || amInspector || isAdmin) return true;
    
    const isAllowed = await escrow.isAllowlisted(account);
    const hasCred   = await escrow.hasCredential(account);
    if (!isAllowed) { toast.error("Your wallet is not allowlisted."); return false; }
    if (!hasCred)   { toast.error("Missing KYC credential for this wallet."); return false; }
    return true;
  }
  
  const setInspectionHandler = async (passed) => {
    try {
      if (inspectionExpired) {
        return toast.error("Inspection period has expired");
      }
      toast.info(passed ? "Marking inspection PASS…" : "Marking inspection FAIL…");
      const tx = await escrow.connect(signer).updateInspectionStatus(home.id, passed);
      await tx.wait();
      toast.success(passed ? "Inspection approved." : "Inspection marked as failed.");
      await fetchDetails();
      nudge?.();
    } catch (error) {
      console.error("Error updating inspection:", error);
      toast.error(error?.data?.message || error.message || "Inspection update failed");
    }
  };

  const placeBidHandler = async () => {
    if (kycStatus !== "VERIFIED") { toast.error("KYC required for buyer."); return; }
    if (!(await requireBuyerCompliance(escrow, account, toast, amSeller, amLender, amInspector, isAdmin))) return;
    try {
      /*if (!bidAmount || parseFloat(bidAmount) <= 0) {
        toast.error("Please enter a valid bid amount");
        return;
      }
      const bidValue = ethers.utils.parseEther(bidAmount);

      if (bidValue.lt(purchasePrice)) {
        toast.error(`Bid must be ≥ ${fmtEth(purchasePrice)} ETH`);
        return;
      }

      toast.info?.("Placing bid...");
      const tx = await escrow.connect(signer).placeBid(home.id, { value: bidValue });*/
      
      // amount = buyer’s total intended price (always required by contract)
      if (!bidAmount || parseFloat(bidAmount) <= 0) {
        toast.error("Enter a total bid amount");
        return;
      }
      const amountWei = ethers.utils.parseEther(bidAmount);

      // For DirectPurchase bids, post full cash now and enforce min price
      let valueWei = ethers.constants.Zero;
      if (bidMethod === PaymentMethod.DirectPurchase) {
        if (amountWei.lt(purchasePrice)) {
          toast.error(`Cash bid must be ≥ ${fmtEth(purchasePrice)} ETH`);
          return;
        }
        valueWei = amountWei; // post the full cash now
      } else {
        // DepositLender: only escrow is due now
        if (escrowAmount.lte(0)) {
          toast.error("Escrow amount not set on listing");
          return;
        }
        valueWei = escrowAmount;
      }

      toast.info?.("Placing bid...");
      const tx = await escrow
        .connect(signer)
        .placeBid(home.id, bidMethod, amountWei, { value: valueWei });
      await tx.wait();

      toast.success("Bid placed successfully!")
      setBidAmount("");
      await fetchDetails();
      nudge();
    } catch (error) {
      console.error("Error placing bid:", error);
      toast.error(`Failed to place bid: ${error?.data?.message || error.message}`);
    }
  };

  const withdrawBidHandler = async () => {
    if (!(await requireBuyerCompliance(escrow, account, toast, amSeller, amLender, amInspector, isAdmin))) return;
    try {
      toast.info("Withdrawing bid…");
      const tx = await escrow.connect(signer).withdrawBid(home.id);
      await tx.wait();

      toast.success("Bid withdrawn successfully!");
      setUserBid(ethers.constants.Zero);
      await fetchDetails();
      nudge();
    } catch (error) {
      console.error("Error withdrawing bid:", error);
      toast.error(`Failed to withdraw bid: ${error?.data?.message || error.message}`);
    }
  };

  const purchaseDirectlyHandler = async () => {
    if (!(await requireBuyerCompliance(escrow, account, toast, amSeller, amLender, amInspector, isAdmin))) return;
    try {
      toast.info("Processing direct purchase…");
      const tx = await escrow.connect(signer).purchaseDirectly(home.id, { value: purchasePrice });
      await tx.wait();

      toast.success("Purchase initiated successfully!");
      await fetchDetails();
      nudge();
    } catch (error) {
      console.error("Error in direct purchase:", error);
      toast.error(`Purchase failed: ${error?.data?.message || error.message}`);
    }
  };

  const payDepositHandler = async () => {
    if (!(await requireBuyerCompliance(escrow, account, toast, amSeller, amLender, amInspector, isAdmin))) return;
    try {
      toast.info("Paying deposit…");
      const tx = await escrow.connect(signer).purchaseWithDeposit(home.id, { value: escrowAmount });
      await tx.wait();

      toast.success("Deposit paid, contract is now Under Contract.");
      await fetchDetails();
      nudge();
    } catch (error) {
      console.error("Error paying deposit:", error);
      toast.error(`Deposit failed: ${error?.data?.message || error.message}`);
    }
  };

  const buyHandler = async () => {
    if (!(await requireBuyerCompliance(escrow, account, toast, amSeller, amLender, amInspector, isAdmin))) return;
    try {
      toast.info("Approving purchase…");
      const tx = await escrow.connect(signer).approveSale(home.id);
      await tx.wait();

      toast.success("Purchase approved successfully!");
      setHasBought(true);
      await fetchDetails();
      nudge();
    } catch (error) {
      console.error("Error in buy process:", error);
      toast.error(`Transaction failed: ${error?.data?.message || error.message}`);
    }
  };

  const lendHandler = async () => {
    try {
      toast.info("Processing lender funding…");
      const remaining = purchasePrice.sub(escrowAmount);

      const fundTx = await escrow.connect(signer).fundByLender(home.id, { value: remaining });
      await fundTx.wait();

      const approveTx = await escrow.connect(signer).approveSale(home.id);
      await approveTx.wait();

      toast.success("Lending process completed successfully!");
      setHasLended(true);
      await fetchDetails();
      nudge();
    } catch (error) {
      console.error("Error in lending process:", error);
      toast.error(`Lending process failed: ${error?.data?.message || error.message}`);
    }
  };

  const approveSaleSeller = async () => {
    try {
      toast.info("Approving sale…");
      const tx = await escrow.connect(signer).approveSale(home.id);
      await tx.wait();

      const st = Number(await escrow.getPropertyStatus(home.id));
      toast[st === 5 ? "success" : "info"](
        st === 5 ? "All approvals in. Ready to close!" : "Approval recorded. Waiting for others."
      );
      await fetchDetails();
      refreshData?.();
      nudge();
    } catch (error) {
      console.error("Seller approve failed:", error);
      toast.error(error?.data?.message || error.message || "Approve failed");
    }
  };

  const finalizeSaleSeller = async () => {
    try {
      const st = Number(await escrow.getPropertyStatus(home.id));
      if (st !== 5) {
        const [buyerApproved, sellerApproved, lenderApproved] = await escrow.getApprovalStatus(home.id);
        const details = await escrow.getPropertyDetails(home.id);
        const conditions = details[8];
        const requiresInspection = Boolean(conditions?.requiresInspection);
        const inspectionPassed = Boolean(details[7]);
        const pm = Number(await escrow.getPaymentMethod(home.id));

        let missing = [];
        if (requiresInspection && !inspectionPassed) missing.push("inspection pass");
        if (!buyerApproved)  missing.push("buyer approval");
        if (!sellerApproved) missing.push("seller approval");
        if (pm === 1 && !lenderApproved) missing.push("lender approval");

        return toast.error(
          `Not ready: ${missing.length ? missing.join(", ") : "awaiting ReadyToClose status"}`
        );
      }

      toast.info("Finalizing sale…");
      const tx = await escrow.connect(signer).finalizeSale(home.id);
      await tx.wait();
      toast.success("Sale finalized successfully!");
      await fetchDetails();
      refreshData?.();
      nudge();
    } catch (error) {
      console.error("Finalize failed:", error);
      toast.error(error?.data?.message || error.message || "Finalize failed");
    }
  };

  const cancelSaleHandler = async () => {
    try {
      toast.info("Cancelling sale…");
      const tx = await escrow.connect(signer).cancelSale(home.id, "User requested cancellation");
      await tx.wait();

      toast.success("Sale cancelled successfully!");
      await fetchDetails();
      if (refreshData) refreshData();
      nudge();
    } catch (error) {
      console.error("Error cancelling sale:", error);
      toast.error(`Failed to cancel sale: ${error?.data?.message || error.message}`);
    }
  };

  const relistHandler = async () => {
    try {
      if (!amSeller) return toast.error("Only the seller can relist");
      if (propertyStatus !== PropertyStatus.Cancelled) return toast.error("Property is not cancelled");

      // Ensure Escrow can pull the NFT back from seller
      const nft = new ethers.Contract(
        nftAddress,
        [
          "function getApproved(uint256 tokenId) view returns (address)",
          "function approve(address to, uint256 tokenId)"
        ],
        signer
      );

      const approved = await nft.getApproved(home.id);
      if (!approved || approved.toLowerCase() !== escrow.address.toLowerCase()) {
        toast.info("Approving Escrow to transfer the NFT…");
        const txA = await nft.approve(escrow.address, home.id);
        await txA.wait();
      }

      toast.info("Relisting with the same terms…");
      const tx = await escrow.connect(signer).reopenCancelled(home.id);
      await tx.wait();

      toast.success("Property relisted!");
      await fetchDetails();
      refreshData?.();
      nudge?.();
    } catch (e) {
      console.error("Relist failed:", e);
      toast.error(e?.data?.message || e.message || "Relist failed");
    }
  };

  //const acceptBidHandler = async (bidderAddress, method = PaymentMethod.DepositAndLender) => {
  const acceptBidHandler = async (bidderAddress) => {
    try {
      toast.info("Accepting bid…");
      //const tx = await escrow.connect(signer).acceptBid(home.id, bidderAddress, method);
      const tx = await escrow.connect(signer).acceptBid(home.id, bidderAddress);
      await tx.wait();

      toast.success("Bid accepted successfully!");
      await fetchDetails();
    } catch (error) {
      console.error("Error accepting bid:", error);
      toast.error(`Failed to accept bid: ${error?.data?.message || error.message}`);
    }
  };

  const addNFTToMetaMask = async () => {
    try {
      if (!window.ethereum) {
        toast.error("MetaMask is not installed");
        return;
      }
      const wasAdded = await window.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC721",
          options: {
            address: nftAddress,
            tokenId: home.id.toString(),
            symbol: "EREAL",
            image: home.image,
          },
        },
      });
      toast[wasAdded ? "success" : "error"](wasAdded ? "NFT added to MetaMask!" : "NFT wasn't added.");
    } catch (error) {
      console.error("Error adding NFT to MetaMask:", error);
      toast.error("Failed to add NFT to MetaMask.");
    }
  };

  const transactionSteps = [
    { name: "Property Listed", description: "Available for purchase/bidding" },
    { name: "Under Contract", description: "Buyer selected and earnest paid" },
    { name: "Inspection Pending", description: "Awaiting inspection results" },
    { name: "Awaiting Approvals", description: "All parties must approve" },
    { name: "Ready to Close", description: "All approvals received" },
    { name: "Sold", description: "Transaction completed" },
  ];

  const getStatusName = (status) => {
    const m = {
      0: "Not Listed", 1: "Listed", 2: "Under Contract", 3: "Inspection Pending",
      4: "Awaiting Approvals", 5: "Ready to Close", 6: "Sold", 7: "Cancelled",
    };
    return m[status] ?? "Unknown";
  };

  const getStatusColor = (status) => {
    const colors = {
      0: "#6b7280", 1: "#3b82f6", 2: "#f59e0b", 3: "#8b5cf6",
      4: "#f97316", 5: "#10b981", 6: "#059669", 7: "#dc2626"
    };
    return colors[status] || "#6b7280";
  };

  // Keep all your useEffect hooks exactly as they are...
  useEffect(() => {
    fetchDetails();
    const interval = setInterval(fetchDetails, 15000);
    return () => clearInterval(interval);
  }, [escrow, home.id, account]);

  useEffect(() => {
    (async () => {
      try {
        if (!escrow || !account) return setIsAdmin(false);
        const ADMIN_ROLE = ethers.utils.id("ADMIN_ROLE");
        const ok = await escrow.hasRole(ADMIN_ROLE, account);
        setIsAdmin(Boolean(ok));
      } catch {
        setIsAdmin(false);
      }
    })();
  }, [escrow, account]);

  useEffect(() => {
    const readCompliance = async () => {
      if (!escrow || !account || !home?.id) return;
      try {
        const [allow, cred, ts] = await Promise.all([
          escrow.isAllowlisted(account),
          escrow.hasCredential(account),
          escrow.getUnlockAt(home.id)
        ]);
        setIsAllowlisted(Boolean(allow));
        setHasCredential(Boolean(cred));
        setUnlockAt(Number(ts));
      } catch (e) { console.error("compliance read", e); }
    };
    readCompliance();
  }, [escrow, account, home?.id]);

  const locked = unlockAt && Date.now()/1000 < unlockAt;
  const canTransact = isAllowlisted && hasCredential && !locked;

  useEffect(() => {
    (async () => {
      if (!escrow || !home?.id) return;
      if (!(amSeller && listingType === 1 && propertyStatus === PropertyStatus.Listed)) {
        setBidders([]); setHighest(null); return;
      }
      const addrs = await escrow.getBidders(home.id);
      const rows = [];
      for (const a of addrs) {
        const amt = await escrow.getBidAmount(home.id, a);
        if (amt.gt(0)) rows.push({ address: a, amount: amt });
      }
      setBidders(rows);
      const hb = await escrow.getHighestBid(home.id);
      setHighest({ bidder: hb[0], amount: hb[1] });
    })();
  }, [escrow, home?.id, amSeller, listingType, propertyStatus]);

  useEffect(() => {
    (async () => {
      if (!escrow || !home?.id) return;
      if (listingType !== 1 || propertyStatus !== PropertyStatus.Listed) { // Auction & listed
        setAuctionInfo(null);
        return;
      }
      try {
        const [hb, amt, minNext, bps] = await escrow.getAuctionInfo(home.id);
        setAuctionInfo({ highestBidder: hb, highestAmount: amt, minNextBid: minNext, minIncrementBps: bps });
      } catch (e) {
        console.error("getAuctionInfo failed", e);
      }
    })();
  }, [escrow, home?.id, listingType, propertyStatus]);


  const tabs = [
    { id: 'details', label: 'Property Details', icon: '🏠' },
    { id: 'transaction', label: 'Transaction', icon: '💰' },
    { id: 'blockchain', label: 'Blockchain', icon: '⛓️' },
    { id: 'history', label: 'History', icon: '📊' }
  ];

  // ---- History state + loader (add once above return) ----
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  const formatTs = (unix) =>
    new Date(unix * 1000).toLocaleString([], { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });

  useEffect(() => {
    const cached = localStorage.getItem(`kyc:${account}`);
    if (cached) setKycStatus(cached);
  }, [account]);

  useEffect(() => {
    if (account && kycStatus) {
      localStorage.setItem(`kyc:${account}`, kycStatus);
    }
  }, [account, kycStatus]);

  useEffect(() => {
    const load = async () => {
      try {
        if (!escrow || !provider || !home?.id) return;
        setLoadingHistory(true);
        setHistoryError(null);

        const entries = [];
        // If your chain is big, consider narrowing fromBlock.
        const fromBlock = 0;
        const toBlock = 'latest';

        const add = async (filter, make) => {
          if (!filter) return;
          const logs = await escrow.queryFilter(filter, fromBlock, toBlock);
          for (const log of logs) {
            const block = await provider.getBlock(log.blockNumber);
            entries.push(make(log, block.timestamp));
          }
        };

        // Status changes (you already listen to this in App.js)
        try {
          await add(
            escrow.filters.PropertyStatusChanged(home.id, null, null),
            (log, ts) => {
              const oldS = Number(log.args?.oldStatus ?? log.args?.[1]);
              const newS = Number(log.args?.newStatus ?? log.args?.[2]);
              return {
                ts,
                icon: '🔄',
                title: 'Status Changed',
                detail: `${getStatusName(oldS)} → ${getStatusName(newS)}`,
                tx: log.transactionHash,
              };
            }
          );
        } catch {}

        // Sale finalized
        try {
          await add(
            escrow.filters.SaleFinalized(home.id, null, null),
            (log, ts) => {
              const buyerAddr = log.args?.buyer ?? log.args?.[1];
              const total = log.args?.total ?? log.args?.[2];
              return {
                ts,
                icon: '✅',
                title: 'Sale Finalized',
                detail: `Buyer ${cut(String(buyerAddr))} paid ${fmtEth(total)} ETH`,
                tx: log.transactionHash,
              };
            }
          );
        } catch {}

        // Optional events — if your contract emits these; they fail silently if not present
        try {
          await add(
            escrow.filters.BidPlaced?.(home.id, null, null),
            (log, ts) => ({
              ts,
              icon: '📈',
              title: 'Bid Placed',
              detail: `${cut(String(log.args?.bidder ?? log.args?.[1]))} bid ${fmtEth(log.args?.amount ?? log.args?.[2])} ETH`,
              tx: log.transactionHash,
            })
          );
        } catch {}
        try {
          await add(
            escrow.filters.BidWithdrawn?.(home.id, null),
            (log, ts) => ({
              ts,
              icon: '↩️',
              title: 'Bid Withdrawn',
              detail: `${cut(String(log.args?.bidder ?? log.args?.[1]))}`,
              tx: log.transactionHash,
            })
          );
        } catch {}
        try {
          await add(
            escrow.filters.ApprovalGiven?.(home.id, null),
            (log, ts) => ({
              ts,
              icon: '📝',
              title: 'Approval Given',
              detail: `By ${cut(String(log.args?.by ?? log.args?.[1]))}`,
              tx: log.transactionHash,
            })
          );
        } catch {}
        try {
          await add(
            escrow.filters.InspectionUpdated?.(home.id, null),
            (log, ts) => ({
              ts,
              icon: '🔍',
              title: 'Inspection Updated',
              detail: (log.args?.passed ?? log.args?.[1]) ? 'Passed' : 'Failed',
              tx: log.transactionHash,
            })
          );
        } catch {}
        try {
          await add(
            escrow.filters.DepositPaid?.(home.id, null, null),
            (log, ts) => ({
              ts,
              icon: '💰',
              title: 'Deposit Paid',
              detail: `${cut(String(log.args?.by ?? log.args?.[1]))}: ${fmtEth(log.args?.amount ?? log.args?.[2])} ETH`,
              tx: log.transactionHash,
            })
          );
        } catch {}
        try {
          await add(
            escrow.filters.BidAccepted?.(home.id, null),
            (log, ts) => ({
              ts,
              icon: '🤝',
              title: 'Bid Accepted',
              detail: `${cut(String(log.args?.bidder ?? log.args?.[1]))}`,
              tx: log.transactionHash,
            })
          );
        } catch {}
        try {
          await add(
            escrow.filters.SaleCancelled?.(home.id, null),
            (log, ts) => ({
              ts,
              icon: '❌',
              title: 'Sale Cancelled',
              detail: String(log.args?.reason ?? ''),
              tx: log.transactionHash,
            })
          );
        } catch {}

        // Sort newest first
        entries.sort((a, b) => b.ts - a.ts);
        setHistory(entries);
      } catch (e) {
        setHistoryError(e?.message || 'Failed to load history');
      } finally {
        setLoadingHistory(false);
      }
    };

    load();
    // also reload when you know chain state changes
  }, [escrow, provider, home?.id, onChainUpdate, propertyStatus]);

  const activeBidders = bidders
    .filter(b => b.amount?.gt?.(0))
    .sort((a, b) => b.amount.sub(a.amount)) // descending
    .slice(0, 1); // keep only highest

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '16px',
        width: '95vw',
        maxWidth: '1200px',
        height: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
      }}>
        {/* Header */}
        <div style={{
          padding: '24px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white'
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold' }}>{home.name}</h1>
            <p style={{ margin: '4px 0 0 0', opacity: 0.9 }}>{home.address}</p>
            <div style={{
              display: 'inline-block',
              padding: '4px 12px',
              marginTop: '8px',
              backgroundColor: getStatusColor(propertyStatus),
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: '600'
            }}>
              {getStatusName(propertyStatus)}
            </div>
          </div>
          <button
            onClick={() => togglePop()}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              borderRadius: '8px',
              padding: '8px',
              cursor: 'pointer',
              color: 'white'
            }}
          >
            <img src={close} alt="Close" style={{ width: '24px', height: '24px' }} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb'
        }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: '16px',
                border: 'none',
                background: activeTab === tab.id ? 'white' : 'transparent',
                cursor: 'pointer',
                borderBottom: activeTab === tab.id ? '3px solid #3b82f6' : '3px solid transparent',
                fontWeight: activeTab === tab.id ? 'bold' : 'normal',
                color: activeTab === tab.id ? '#3b82f6' : '#6b7280',
                transition: 'all 0.2s ease'
              }}
            >
              <span style={{ marginRight: '8px' }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          
          {/* Property Details Tab */}
          {activeTab === 'details' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', height: '100%' }}>
              <div>
                <EnhancedImageGallery
                  images={images}
                  showThumbnails
                  showCounter
                  showFullscreen
                  showAutoplay
                  autoSlideDelay={4000}
                />
                
                <div style={{ 
                  padding: '20px',
                  backgroundColor: '#f8fafc',
                  borderRadius: '12px',
                  marginTop: '16px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h2 style={{ margin: 0, color: '#1f2937', fontSize: '28px' }}>{fmtEth(purchasePrice)} ETH</h2>
                    {propertyStatus === PropertyStatus.Sold && owner && (
                      <span style={{ 
                        padding: '4px 12px', 
                        backgroundColor: '#10b981', 
                        color: 'white', 
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}>
                        SOLD
                      </span>
                    )}
                  </div>
                  <p style={{ margin: 0, color: '#6b7280' }}>Escrow Amount: {fmtEth(escrowAmount)} ETH</p>
                  <div style={{ 
                    display: 'flex', 
                    gap: '16px', 
                    marginTop: '12px',
                    fontSize: '14px',
                    color: '#4b5563'
                  }}>
                    <span><strong>{home.attributes?.[2]?.value}</strong> beds</span>
                    <span><strong>{home.attributes?.[3]?.value}</strong> baths</span>
                    <span><strong>{home.attributes?.[4]?.value}</strong> sqft</span>
                  </div>
                </div>
              </div>

              <div>
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ marginBottom: '12px', color: '#1f2937' }}>Overview</h3>
                  <p style={{ lineHeight: '1.6', color: '#4b5563' }}>{home.description}</p>
                </div>

                <div>
                  <h3 style={{ marginBottom: '12px', color: '#1f2937' }}>Facts and Features</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {home.attributes?.map((attribute, index) => (
                      <div key={index} style={{
                        padding: '12px',
                        backgroundColor: '#f3f4f6',
                        borderRadius: '8px',
                        display: 'flex',
                        justifyContent: 'space-between'
                      }}>
                        <span style={{ fontWeight: '500', color: '#374151' }}>{attribute.trait_type}</span>
                        <span style={{ color: '#6b7280' }}>{attribute.value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Role Information */}
                <div style={{ marginTop: '24px' }}>
                  <h3 style={{ marginBottom: '12px', color: '#1f2937' }}>Your Role</h3>
                  <div style={{
                    padding: '12px',
                    backgroundColor: '#dbeafe',
                    borderRadius: '8px',
                    color: '#1e40af'
                  }}>
                    {account && buyer && account.toLowerCase() === buyer.toLowerCase() && "🛒 You are the buyer for this property"}
                    {account && seller && account.toLowerCase() === seller.toLowerCase() && "🏪 You are the seller of this property"}
                    {account && lender && account.toLowerCase() === lender.toLowerCase() && "🏦 You are the lender for this transaction"}
                    {account && inspector && account.toLowerCase() === inspector.toLowerCase() && "🔍 You are the inspector for this property"}
                    {!isPrivileged && "👤 You are viewing this property"}
                  </div>
                </div>
                {account && seller && account.toLowerCase() === seller.toLowerCase()
                  && propertyStatus === PropertyStatus.Cancelled && (
                    <button
                      onClick={relistHandler}
                      style={{
                        padding: '12px 16px',
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: '500',
                        marginTop: '24px'
                      }}
                    >
                      🔁 Relist (same terms)
                    </button>
                  )}
              </div>
            </div>
          )}

          {/* Transaction Tab */}
          {activeTab === 'transaction' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              {/* Transaction Flow */}
              <div style={{ marginBottom: '32px' }}>
                <h3 style={{ marginBottom: '20px', color: '#1f2937' }}>Transaction Progress</h3>
                <div style={{ position: 'relative' }}>
                  {transactionSteps.map((step, index) => (
                    <div key={index} style={{
                      display: 'flex',
                      alignItems: 'center',
                      marginBottom: '16px',
                      position: 'relative'
                    }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        backgroundColor: index === currentStep ? '#3b82f6' : 
                                       index < currentStep ? '#10b981' : '#e5e7eb',
                        color: index <= currentStep ? 'white' : '#9ca3af',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        fontSize: '16px',
                        marginRight: '16px',
                        border: index === currentStep ? '3px solid #93c5fd' : 'none'
                      }}>
                        {index < currentStep ? '✓' : index + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontWeight: index === currentStep ? 'bold' : 'normal',
                          color: index === currentStep ? '#3b82f6' : '#1f2937',
                          marginBottom: '4px'
                        }}>
                          {step.name}
                        </div>
                        <div style={{ color: '#6b7280', fontSize: '14px' }}>
                          {step.description}
                        </div>
                      </div>
                      {index < transactionSteps.length - 1 && (
                        <div style={{
                          position: 'absolute',
                          left: '19px',
                          top: '50px',
                          width: '2px',
                          height: '16px',
                          backgroundColor: index < currentStep ? '#10b981' : '#e5e7eb'
                        }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: 2 Rows */}
              <div style={{ display: 'grid', gridTemplateRows: 'auto auto', gap: '24px' }}>
                {/* Purchase Actions */}
                <div style={{
                  padding: '24px',
                  backgroundColor: '#f8fafc',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0'
                }}>
                  <h3 style={{ marginBottom: '16px', color: '#1f2937' }}>Purchase Actions</h3>
                  {/* Compliance Warning (only for buyers, not privileged roles) */}
                  {!isPrivileged && (
                    <>
                      {!canTransact && (
                        <div style={{
                          padding: '16px',
                          marginBottom: '20px',
                          backgroundColor: '#fff3cd',
                          border: '1px solid #ffeeba',
                          borderRadius: '8px',
                          color: '#856404'
                        }}>
                          {locked ? (
                            <>⚠️ This property is under a lockup period. You cannot transact yet.</>
                          ) : kycStatus === "VERIFIED" ? (
                            <>✅ You are KYC verified. Waiting for allowlist/credential approval…</>
                          ) : (
                            <>
                              ⚠️ You must complete identity verification before purchasing.
                              <div style={{ marginTop: 12 }}>
                                {kycStatus === "PENDING" && (
                                  <>✅ Identity verified. Waiting for blockchain sync…</>
                                )}

                                {kycStatus === "FAILED" && (
                                  <button onClick={startKyc}>Retry Verification</button>
                                )}

                                {kycStatus === "UNVERIFIED" && (
                                  <button onClick={startKyc} disabled={verifying}                           
                                  style={{
                                    padding: '12px 24px',
                                    backgroundColor: '#3b82f6',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontWeight: '500'
                                  }}>
                                    {verifying ? "Opening…" : "Verify Identity"}
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {propertyStatus === PropertyStatus.Sold && owner ? (
                    <div style={{ textAlign: 'center', padding: '24px' }}>
                      <div style={{ 
                        fontSize: '48px',
                        marginBottom: '12px'
                      }}>🎉</div>
                      <h4 style={{ color: '#059669', marginBottom: '8px' }}>Property Sold!</h4>
                      <p style={{ color: '#6b7280', marginBottom: '16px' }}>Owned by {cut(owner)}</p>
                      {owner && account && owner.toLowerCase() === account.toLowerCase() && (
                        <button
                          onClick={addNFTToMetaMask}
                          style={{
                            padding: '12px 24px',
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: '500'
                          }}
                        >
                          Add NFT to MetaMask
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Direct Purchase Options */}
                      {canTransact && canPurchaseDirectly && propertyStatus === PropertyStatus.Listed && (
                        <div style={{ marginBottom: '20px' }}>
                          <h4 style={{ color: '#374151', marginBottom: '12px' }}>Direct Purchase</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <button
                              onClick={purchaseDirectlyHandler}
                              style={{
                                padding: '12px 16px',
                                backgroundColor: '#10b981',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '500'
                              }}
                            >
                              Purchase Directly ({fmtEth(purchasePrice)} ETH)
                            </button>
                            <button
                              onClick={payDepositHandler}
                              style={{
                                padding: '12px 16px',
                                backgroundColor: '#f59e0b',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '500'
                              }}
                            >
                              Pay Deposit ({fmtEth(escrowAmount)} ETH)
                            </button>
                          </div>
                        </div>
                      )}
                      

                      {/* Bidding Section */}
                      {canTransact && canPlaceBid && propertyStatus === PropertyStatus.Listed && (
                        <div style={{ marginBottom: '20px' }}>
                          <h4 style={{ color: '#374151', marginBottom: '12px' }}>Place a Bid</h4>
                          {auctionInfo && (
                              <div style={{ marginTop: 8, color: '#374151' }}>
                                <div><strong>Highest:</strong> {fmtEth(auctionInfo.highestAmount)} ETH by {cut(auctionInfo.highestBidder)}</div>
                                <div><strong>Min next bid:</strong> {fmtEth(auctionInfo.minNextBid)} ETH ({auctionInfo.minIncrementBps/100}% step)</div>
                              </div>
                            )}
                          <div style={{ display: 'flex', gap: 12, marginBottom: 12, marginTop: 12 }}>
                            <label style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <input
                                type="radio"
                                name="bidMethod"
                                checked={bidMethod === PaymentMethod.DirectPurchase}
                                onChange={() => setBidMethod(PaymentMethod.DirectPurchase)}
                              />
                              Cash (Direct Purchase)
                            </label>
                            <label style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <input
                                type="radio"
                                name="bidMethod"
                                checked={bidMethod === PaymentMethod.DepositAndLender}
                                onChange={() => setBidMethod(PaymentMethod.DepositAndLender)}
                              />
                              Deposit  Lender
                            </label>
                          </div>
                          {userBid && userBid.gt(0) ? (
                            <div style={{
                              padding: '12px',
                              backgroundColor: '#dbeafe',
                              borderRadius: '8px',
                              marginBottom: '12px'
                            }}>
                              <p style={{ margin: '0 0 8px 0', color: '#1e40af' }}>
                                Your current bid: {fmtEth(userBid)} ETH
                              </p>
                              <button
                                onClick={withdrawBidHandler}
                                style={{
                                  padding: '8px 16px',
                                  backgroundColor: '#dc2626',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  fontSize: '14px'
                                }}
                              >
                                Withdraw Bid
                              </button>
                            </div>
                          ) : (
                            <div>
                              <input
                                type="number"
                                step="0.01"
                                //min={fmtEth(purchasePrice)}
                                min={bidMethod === PaymentMethod.DirectPurchase ? fmtEth(purchasePrice) : 0}
                                value={bidAmount}
                                onChange={(e) => setBidAmount(e.target.value)}
                                //placeholder={`Minimum: ${fmtEth(purchasePrice)} ETH`}
                                placeholder={bidMethod === PaymentMethod.DirectPurchase
                                  ? `Minimum: ${fmtEth(purchasePrice)} ETH (posted in full)`
                                  : `Enter your total target price (you pay only ${fmtEth(escrowAmount)} ETH now)`}
                                style={{
                                  width: '100%',
                                  padding: '12px',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '8px',
                                  marginBottom: '8px'
                                }}
                              />
                              <button
                                onClick={placeBidHandler}
                                style={{
                                  width: '100%',
                                  padding: '12px',
                                  backgroundColor: '#3b82f6',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '8px',
                                  cursor: 'pointer',
                                  fontWeight: '500'
                                }}
                              >
                                Place Bid
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {amSeller && listingType === 1 && propertyStatus === PropertyStatus.Listed && (
                        <div style={{
                          marginTop: '20px',
                          padding: '16px',
                          backgroundColor: '#f9fafb',
                          borderRadius: '12px',
                          border: '1px solid #e5e7eb'
                        }}>
                          <h4 style={{ marginBottom: '12px', color: '#1f2937' }}>Current Bids</h4>

                          {highest?.amount?.gt?.(0) && (
                            <p style={{ marginBottom: '12px', color: '#374151' }}>
                              <strong>Highest:</strong> {fmtEth(highest.amount)} ETH by {cut(highest.bidder)}
                            </p>
                          )}

                          {activeBidders.length ? activeBidders.map(b => (
                            <div
                              key={b.address}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '8px 12px',
                                marginBottom: '8px',
                                backgroundColor: '#ffffff',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px'
                              }}
                            >
                              <span style={{ color: '#111827' }}>
                                {cut(b.address)} — {fmtEth(b.amount)} ETH
                              </span>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                {/*<button
                                  onClick={() => acceptBidHandler(b.address, PaymentMethod.DirectPurchase)}
                                  style={{
                                    padding: '6px 12px',
                                    backgroundColor: '#10b981',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontWeight: '500'
                                  }}
                                >
                                  Accept (Direct)
                                </button>
                                <button
                                  onClick={() => acceptBidHandler(b.address, PaymentMethod.DepositAndLender)}
                                  style={{
                                    padding: '6px 12px',
                                    backgroundColor: '#3b82f6',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontWeight: '500'
                                  }}
                                >
                                  Accept (Deposit+Lender)
                                </button>*/}
                                <button
                                  onClick={() => acceptBidHandler(b.address)}
                                  style={{
                                    padding: '6px 12px',
                                    backgroundColor: '#10b981',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontWeight: '500'
                                  }}
                                >
                                  Accept Bid
                                </button>
                              </div>
                            </div>
                          )) : (
                            <p style={{ color: '#6b7280' }}>No active bids.</p>
                          )}
                        </div>
                      )}


                      {/* Role-based Action Buttons */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {/* Buyer approval */}
                        {account && buyer && account.toLowerCase() === buyer.toLowerCase() && 
                         propertyStatus === PropertyStatus.AwaitingApprovals && !hasBought && (
                          <button
                            onClick={buyHandler}
                            style={{
                              padding: '12px 16px',
                              backgroundColor: '#10b981',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              fontWeight: '500'
                            }}
                          >
                            ✅ Approve Sale (Buyer)
                          </button>
                        )}

                        {/* Inspector */}
                        {account && inspector && account.toLowerCase() === inspector.toLowerCase() &&
                        (propertyStatus === PropertyStatus.UnderContract || propertyStatus === PropertyStatus.InspectionPending) && (
                          <div style={{ display:'flex', gap: 8 }}>
                            <button
                              onClick={() => setInspectionHandler(true)}
                              disabled={inspectionExpired}
                              style={{
                                padding: '12px 16px',
                                backgroundColor: '#10b981',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: inspectionExpired ? 'not-allowed' : 'pointer',
                                fontWeight: '500'
                              }}
                            >
                              ✅ Mark PASS
                            </button>
                            <button
                              onClick={() => setInspectionHandler(false)}
                              disabled={inspectionExpired}
                              style={{
                                padding: '12px 16px',
                                backgroundColor: '#ef4444',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: inspectionExpired ? 'not-allowed' : 'pointer',
                                fontWeight: '500'
                              }}
                            >
                              ❌ Mark FAIL
                            </button>
                          </div>
                        )}

                        {/* Lender */}
                        {account && lender && account.toLowerCase() === lender.toLowerCase() && 
                         propertyStatus === PropertyStatus.AwaitingApprovals && 
                         paymentMethod === PaymentMethod.DepositAndLender && !hasLended && (
                          <button
                            onClick={lendHandler}
                            style={{
                              padding: '12px 16px',
                              backgroundColor: '#0891b2',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              fontWeight: '500'
                            }}
                          >
                            🏦 Fund & Approve (Lender)
                          </button>
                        )}

                        {/* Seller */}
                        {account && seller && account.toLowerCase() === seller.toLowerCase() && (
                          <>
                            {propertyStatus === PropertyStatus.AwaitingApprovals && !hasSold && (
                              <button
                                onClick={approveSaleSeller}
                                style={{
                                  padding: '12px 16px',
                                  backgroundColor: '#059669',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '8px',
                                  cursor: 'pointer',
                                  fontWeight: '500'
                                }}
                              >
                                ✅ Approve Sale (Seller)
                              </button>
                            )}
                            {propertyStatus === PropertyStatus.ReadyToClose && (
                              <button
                                onClick={finalizeSaleSeller}
                                style={{
                                  padding: '12px 16px',
                                  backgroundColor: '#dc2626',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '8px',
                                  cursor: 'pointer',
                                  fontWeight: '500'
                                }}
                              >
                                🏁 Finalize Sale
                              </button>
                            )}
                          </>
                        )}

                        {/* Cancel Sale */}
                        {(propertyStatus === PropertyStatus.Listed ||
                          propertyStatus === PropertyStatus.UnderContract ||
                          propertyStatus === PropertyStatus.InspectionPending ||
                          propertyStatus === PropertyStatus.AwaitingApprovals) &&
                          account && (buyer?.toLowerCase?.() === account.toLowerCase() ||
                                    seller?.toLowerCase?.() === account.toLowerCase()) && (
                          <button
                            onClick={cancelSaleHandler}
                            style={{
                              padding: '12px 16px',
                              backgroundColor: '#dc2626',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              fontWeight: '500'
                            }}
                          >
                            ❌ Cancel Sale
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Transaction Summary */}
                {!(amSeller && listingType === 1 && propertyStatus === PropertyStatus.Listed) && (
                  <div style={{
                    padding: '24px',
                    backgroundColor: '#f1f5f9',
                    borderRadius: '12px',
                    border: '1px solid #cbd5e1'
                  }}>
                    <h3 style={{ marginBottom: '16px', color: '#1e293b' }}>Transaction Summary</h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Purchase Price:</span>
                        <span style={{ fontWeight: 'bold' }}>{fmtEth(purchasePrice)} ETH</span>
                      </div>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Escrow Amount:</span>
                        <span style={{ fontWeight: 'bold' }}>{fmtEth(escrowAmount)} ETH</span>
                      </div>

                      {paymentMethod === PaymentMethod.DepositAndLender && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748b' }}>Lender Amount:</span>
                          <span style={{ fontWeight: 'bold' }}>{fmtEth(purchasePrice.sub(escrowAmount))} ETH</span>
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Listing Type:</span>
                        <span>{listingType === 0 ? '🏷️ Fixed Price' : '🔨 Auction'}</span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>Payment Method:</span>
                        <span>{paymentMethod === 0 ? '💰 Direct Purchase' : '🏦 Deposit + Lender'}</span>
                      </div>

                      {buyer && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748b' }}>Buyer:</span>
                          <span style={{ fontFamily: 'monospace' }}>{cut(buyer)}</span>
                        </div>
                      )}

                      {seller && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748b' }}>Seller:</span>
                          <span style={{ fontFamily: 'monospace' }}>{cut(seller)}</span>
                        </div>
                      )}

                      {lender && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748b' }}>Lender:</span>
                          <span style={{ fontFamily: 'monospace' }}>{cut(lender)}</span>
                        </div>
                      )}

                      {inspector && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748b' }}>Inspector:</span>
                          <span style={{ fontFamily: 'monospace' }}>{cut(inspector)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Blockchain Tab */}
          {activeTab === 'blockchain' && (
            <div>
              <BlockchainDetails 
                home={home}
                escrow={escrow}
                provider={provider}
                account={account}
                nftAddress={nftAddress}
                owner={owner}
              />
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="history">
              <div className="transaction-details">
                <h3>Transaction History</h3>

                {loadingHistory && (
                  <p className="loading">Loading on-chain activity…</p>
                )}

                {historyError && (
                  <div className="progress-message" style={{ backgroundColor: '#ffebee', borderLeftColor: '#ef4444', color: '#b91c1c' }}>
                    {historyError}
                  </div>
                )}

                {!loadingHistory && !historyError && history.length === 0 && (
                  <div className="progress-message">
                    No events found for this property yet.
                  </div>
                )}

                {!loadingHistory && history.length > 0 && (
                  <ul className="status-list history-list">
                    {history.map((e, idx) => (
                      <li key={`${e.tx}-${idx}`} className="history-item" style={{ alignItems: 'flex-start' }}>
                        <span className="status-icon complete" aria-hidden />
                        <div style={{ display: 'grid', gap: 2 }}>
                          <div style={{ fontWeight: 600 }}>
                            {e.icon} {e.title}
                          </div>
                          {e.detail && (
                            <div className="step-description">{e.detail}</div>
                          )}
                          <div className="hint">
                            {formatTs(e.ts)}{e.tx ? <> • <code style={{ opacity: .8 }}>{e.tx.slice(0, 10)}…</code></> : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Current Status Summary */}
              <div style={{
                marginTop: '24px',
                padding: '20px',
                backgroundColor: '#f1f5f9',
                borderRadius: '12px',
                border: '1px solid #cbd5e1'
              }}>
                <h4 style={{ marginBottom: '16px', color: '#1e293b' }}>Current Status Summary</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <h5 style={{ color: '#64748b', marginBottom: '8px' }}>Approvals Status</h5>
                    <div style={{ fontSize: '14px' }}>
                      <div style={{ marginBottom: '4px' }}>
                        <span style={{ color: hasBought ? '#059669' : '#dc2626' }}>
                          {hasBought ? '✅' : '❌'} Buyer Approved
                        </span>
                      </div>
                      <div style={{ marginBottom: '4px' }}>
                        <span style={{ color: hasSold ? '#059669' : '#dc2626' }}>
                          {hasSold ? '✅' : '❌'} Seller Approved
                        </span>
                      </div>
                      <div style={{ marginBottom: '4px' }}>
                        <span style={{ color: hasLended ? '#059669' : '#dc2626' }}>
                          {hasLended ? '✅' : '❌'} Lender Approved
                        </span>
                      </div>
                      <div>
                        <span style={{ color: hasInspected ? '#059669' : '#dc2626' }}>
                          {hasInspected ? '✅' : '❌'} Inspection Passed
                        </span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h5 style={{ color: '#64748b', marginBottom: '8px' }}>Compliance Status</h5>
                    <div style={{ fontSize: '14px' }}>
                      <div style={{ marginBottom: '4px' }}>
                        <span style={{ color: isAllowlisted ? '#059669' : '#dc2626' }}>
                          {isAllowlisted ? '✅' : '❌'} Allowlisted
                        </span>
                      </div>
                      <div style={{ marginBottom: '4px' }}>
                        <span style={{ color: hasCredential ? '#059669' : '#dc2626' }}>
                          {hasCredential ? '✅' : '❌'} KYC Verified
                        </span>
                      </div>
                      <div>
                        <span style={{ color: !locked ? '#059669' : '#dc2626' }}>
                          {!locked ? '✅' : '❌'} Not Locked
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Home;