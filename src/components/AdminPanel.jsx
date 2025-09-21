import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useToast } from "../ToastContext";
import CompliancePanel from "./CompliancePanel";

// Small helpers
const cut = (a) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "");
const isAddr = (a) => /^0x[a-fA-F0-9]{40}$/.test(a || "");

const ROLES = {
  ADMIN:     ethers.utils.id("ADMIN_ROLE"),
  PAUSER:    ethers.utils.id("PAUSER_ROLE"),
  TREASURER: ethers.utils.id("TREASURER_ROLE"),
  EMERGENCY: ethers.utils.id("EMERGENCY_ROLE"),
  METADATA:  ethers.utils.id("METADATA_ROLE"),
};

const TABS = {
  OVERVIEW:    "overview",
  ESCROW:      "escrow",
  PROPERTIES:  "properties",
  COMPLIANCE:  "compliance",
};


// Status Badge Component
const StatusBadge = ({ status, children }) => (
  <span className={`status-badge ${status}`}>{children}</span>
);

// Section Header Component
const SectionHeader = ({ icon, title, description }) => (
  <div className="section-header">
    <div className="section-icon">{icon}</div>
    <div>
      <h3>{title}</h3>
      {description && <p className="section-description">{description}</p>}
    </div>
  </div>
);

// Form Field Component
const FormField = ({ label, children, hint, error, required }) => (
  <div className="form-field">
    <label className={required ? 'required' : ''}>
      {label}
      {required && <span className="required-asterisk">*</span>}
    </label>
    {children}
    {hint && <div className="field-hint">{hint}</div>}
    {error && <div className="field-error">{error}</div>}
  </div>
);

// Action Card Component
const ActionCard = ({ title, description, children, variant = "default" }) => (
  <div className={`action-card ${variant}`}>
    <div className="action-card-header">
      <h4>{title}</h4>
      {description && <p>{description}</p>}
    </div>
    <div className="action-card-content">
      {children}
    </div>
  </div>
);

export default function AdminPanel({
  provider,
  signer,
  account,
  escrow,       // ethers.Contract (Escrow)
  realEstate,   // ethers.Contract (RealEstate)
  onClose,      // optional: close panel callback
}) {
  const toast = useToast();

  const [escrowOwner, setEscrowOwner] = useState("");
  const [reOwner, setReOwner] = useState("");
  const [platformFee, setPlatformFee] = useState(""); // basis points (e.g. 250)
  const [feeRecipient, setFeeRecipient] = useState("");
  const [paused, setPaused] = useState(false);
  const [escrowRoleFlags, setEscrowRoleFlags] = useState({
    ADMIN: false, PAUSER: false, TREASURER: false, EMERGENCY: false,
  });
  
  const [activeTab, setActiveTab] = useState(TABS.OVERVIEW);
  const [reRoleFlags, setReRoleFlags] = useState({
    ADMIN: false, METADATA: false,
  });

  const amEscrowOwner = useMemo(
    () => account && escrowOwner && account.toLowerCase() === escrowOwner.toLowerCase(),
    [account, escrowOwner]
  );
  const amReOwner = useMemo(
    () => account && reOwner && account.toLowerCase() === reOwner.toLowerCase(),
    [account, reOwner]
  );
  const canPause = useMemo(
    () => (amEscrowOwner || escrowRoleFlags.PAUSER || escrowRoleFlags.ADMIN) && !!signer,
    [amEscrowOwner, escrowRoleFlags, signer]
  );
  const canFees = useMemo(
    () => (amEscrowOwner || escrowRoleFlags.TREASURER || escrowRoleFlags.ADMIN) && !!signer,
    [amEscrowOwner, escrowRoleFlags, signer]
  );
  const canEmergency = useMemo(
    () => (amEscrowOwner || escrowRoleFlags.EMERGENCY || escrowRoleFlags.ADMIN) && !!signer,
    [amEscrowOwner, escrowRoleFlags, signer]
  );
  const canREAdmin = useMemo(
    () => (amReOwner || reRoleFlags.ADMIN) && !!signer,
    [amReOwner, reRoleFlags, signer]
  );
  const canREMeta = useMemo(
    () => (amReOwner || reRoleFlags.METADATA || reRoleFlags.ADMIN) && !!signer,
    [amReOwner, reRoleFlags, signer]
  );

  // ---------- bootstrap ----------
  useEffect(() => {
    (async () => {
      try {
        if (!escrow || !realEstate || !account) return;

        // Owners
        const [eo, ro] = await Promise.all([
          escrow.owner().catch(() => ""),
          realEstate.owner().catch(() => ""),
        ]);
        setEscrowOwner(eo || "");
        setReOwner(ro || "");

        // Fee + paused
        const pf = await escrow.platformFee().catch(() => null);
        if (pf != null) setPlatformFee(pf.toString());
        const fr = await escrow.feeRecipient().catch(() => null);
        if (fr) setFeeRecipient(fr);
        const pz = await escrow.paused?.().catch(() => false);
        setPaused(Boolean(pz));

        // ---- role checks (feature-detected) ----
        const canCheckEscrow = typeof escrow.hasRole === "function";
        if (canCheckEscrow) {
          const [a, p, t, e] = await Promise.all([
            escrow.hasRole(ROLES.ADMIN, account).catch(() => false),
            escrow.hasRole(ROLES.PAUSER, account).catch(() => false),
            escrow.hasRole(ROLES.TREASURER, account).catch(() => false),
            escrow.hasRole(ROLES.EMERGENCY, account).catch(() => false),
          ]);
          setEscrowRoleFlags({ ADMIN: a, PAUSER: p, TREASURER: t, EMERGENCY: e });
        } else {
          setEscrowRoleFlags({ ADMIN: false, PAUSER: false, TREASURER: false, EMERGENCY: false });
        }

        const canCheckRE = typeof realEstate.hasRole === "function";
        if (canCheckRE) {
          const [a, m] = await Promise.all([
            realEstate.hasRole(ROLES.ADMIN, account).catch(() => false),
            realEstate.hasRole(ROLES.METADATA, account).catch(() => false),
          ]);
          setReRoleFlags({ ADMIN: a, METADATA: m });
        } else {
          setReRoleFlags({ ADMIN: false, METADATA: false });
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [escrow, realEstate, account]);


  // ---------- Escrow actions ----------
  const doPause = async () => {
    try {
      if (!canPause) return toast.error("Not authorized to pause.");
      const tx = await escrow.connect(signer).pause();
      toast.info?.("Pausing…");
      await tx.wait();
      setPaused(true);
      toast.success("Contract paused.");
    } catch (e) { toast.error(parseErr(e)); }
  };

  const doUnpause = async () => {
    try {
      if (!canPause) return toast.error("Not authorized to unpause.");
      const tx = await escrow.connect(signer).unpause();
      toast.info?.("Unpausing…");
      await tx.wait();
      setPaused(false);
      toast.success("Contract unpaused.");
    } catch (e) { toast.error(parseErr(e)); }
  };

  const updatePlatformFee = async () => {
    try {
      if (!canFees) return toast.error("Not authorized to set fee.");
      const bps = Number(platformFee);
      if (!Number.isFinite(bps) || bps < 0 || bps > 1000) {
        return toast.error("Platform fee must be 0–1000 (max 10%).");
      }
      const tx = await escrow.connect(signer).setPlatformFee(bps);
      toast.info?.("Updating platform fee…");
      await tx.wait();
      toast.success("Platform fee updated.");
    } catch (e) { toast.error(parseErr(e)); }
  };

  const updateFeeRecipient = async () => {
    try {
      if (!canFees) return toast.error("Not authorized to set recipient.");
      if (!isAddr(feeRecipient)) return toast.error("Invalid recipient address.");
      const tx = await escrow.connect(signer).setFeeRecipient(feeRecipient);
      toast.info?.("Updating fee recipient…");
      await tx.wait();
      toast.success("Fee recipient updated.");
    } catch (e) { toast.error(parseErr(e)); }
  };

  // emergencyCancelSale(uint256 _nftID, address _refundRecipient)
  const [emgCancelId, setEmgCancelId] = useState("");
  const [emgCancelRecipient, setEmgCancelRecipient] = useState("");

  const doEmergencyCancel = async () => {
    try {
      if (!canEmergency) return toast.error("Not authorized to emergency-cancel.");
      if (!amEscrowOwner) return toast.error("Only Escrow owner can emergency-cancel.");
      const id = Number(emgCancelId);
      if (!Number.isInteger(id) || id <= 0) return toast.error("Enter a valid NFT ID.");
      if (!isAddr(emgCancelRecipient)) return toast.error("Enter a valid refund recipient.");
      const tx = await escrow.connect(signer).emergencyCancelSale(id, emgCancelRecipient);
      toast.info?.("Emergency cancelling…");
      await tx.wait();
      toast.success(`Sale #${id} emergency-cancelled.`);
    } catch (e) {
      toast.error(parseErr(e));
    }
  };

  // emergencyWithdraw(address payable _recipient, uint256 _amount)
  const [emgWRecipient, setEmgWRecipient] = useState("");
  const [emgWAmount, setEmgWAmount] = useState(""); // ETH

  const doEmergencyWithdraw = async () => {
    try {
      if (!canEmergency) return toast.error("Not authorized to emergency-withdraw.");
      if (!amEscrowOwner) return toast.error("Only Escrow owner can emergency-withdraw.");
      if (!isAddr(emgWRecipient)) return toast.error("Invalid recipient.");
      if (!emgWAmount || Number(emgWAmount) <= 0) return toast.error("Enter an amount.");
      const wei = ethers.utils.parseEther(emgWAmount);
      const tx = await escrow.connect(signer).emergencyWithdraw(emgWRecipient, wei);
      toast.info?.("Withdrawing…");
      await tx.wait();
      toast.success("Emergency withdraw completed.");
    } catch (e) {
      toast.error(parseErr(e));
    }
  };

  // ---------- RealEstate actions ----------
  // setAuthorizedMinter(address,bool)
  const [minterAddr, setMinterAddr] = useState("");
  const [minterAuth, setMinterAuth] = useState(true);

  const setAuthorizedMinter = async () => {
    try {
      if (!canREAdmin) return toast.error("Not authorized to set minters.");
      if (!amReOwner) return toast.error("Only RealEstate owner can set minters.");
      if (!isAddr(minterAddr)) return toast.error("Invalid minter address.");
      const tx = await realEstate.connect(signer).setAuthorizedMinter(minterAddr, Boolean(minterAuth));
      toast.info?.("Updating authorized minter…");
      await tx.wait();
      toast.success("Authorized minter updated.");
    } catch (e) {
      toast.error(parseErr(e));
    }
  };

  // --- helpers (top-level in AdminPanel) ---
  const PropertyStatus = {
    NotListed: 0, Listed: 1, UnderContract: 2, InspectionPending: 3,
    AwaitingApprovals: 4, ReadyToClose: 5, Sold: 6, Cancelled: 7,
  };

  // Only allow non-material keys
  const ALLOWED_INFO_KEYS = new Set([
    "propertyType", "squareFootage", "location",
    "yearBuilt", "bedrooms", "bathrooms", "isActive"
  ]);

  async function canEditPropertyInfo(escrow, tokenId) {
    try {
      const d = await escrow.getPropertyDetails(tokenId);
      const status       = Number(d[4]);
      const buyer        = d[3];
      const paidAmount   = d[2];         // BigNumber
      const lenderPaid   = d?.lenderPaid ?? 0; // if you have it in struct; otherwise ignore

      if (status === PropertyStatus.NotListed || status === PropertyStatus.Cancelled) return true;

      if (status === PropertyStatus.Listed) {
        const hasBuyer  = buyer && buyer !== ethers.constants.AddressZero;
        const hasFunds  = paidAmount && !paidAmount.isZero?.() && Number(paidAmount) > 0;
        const lenderHas = typeof lenderPaid === "object" ? !lenderPaid.isZero?.() : Boolean(lenderPaid);
        return !hasBuyer && !hasFunds && !lenderHas;
      }
      return false; // anything in-flight or sold
    } catch {
      return false;
    }
  }

  function parseInfoJson(s) {
    let obj;
    try { obj = JSON.parse(s); } catch { return { ok:false, err:"JSON is invalid." }; }
    if (typeof obj !== "object" || Array.isArray(obj) || obj == null)
      return { ok:false, err:"JSON must be an object." };

    // Reject unknown keys
    const keys = Object.keys(obj);
    const unknown = keys.filter(k => !ALLOWED_INFO_KEYS.has(k));
    if (unknown.length) {
      return { ok:false, err:`Unsupported field(s): ${unknown.join(", ")}.` };
    }
    return { ok:true, value: obj };
  }


  // updatePropertyInfo(uint256 tokenId, PropertyInfo)
  const [upiToken, setUpiToken] = useState("");
  const [upiJson, setUpiJson] = useState(
    `{
  "propertyType": "residential",
  "squareFootage": 1400,
  "location": "New City, State",
  "yearBuilt": 2021,
  "bedrooms": 4,
  "bathrooms": 3,
  "isActive": true
}`
  );
  const [upiLocked, setUpiLocked] = useState(false);
  useEffect(() => {
    (async () => {
      const id = Number(upiToken);
      if (!escrow || !id || id <= 0) { setUpiLocked(false); return; }
      const ok = await canEditPropertyInfo(escrow, id);
      setUpiLocked(!ok);
    })();
  }, [upiToken, escrow]);

  const doUpdatePropertyInfo = async () => {
    try {
      if (!canREAdmin) return toast.error("Not authorized to update info.");
      if (!amReOwner)  return toast.error("Only RealEstate owner can update info (or token owner).");

      const id = Number(upiToken);
      if (!Number.isInteger(id) || id <= 0) return toast.error("Enter a valid token ID.");

      // Check status one last time (race safety)
      const editable = await canEditPropertyInfo(escrow, id);
      if (!editable) return toast.error("Editing is locked for this token’s current status.");

      const parsed = parseInfoJson(upiJson);
      if (!parsed.ok) return toast.error(parsed.err);
      const info = parsed.value;

      // Optional: fetch current for a diff (if contract exposes it)
      // const current = await realEstate.propertyInfo(id).catch(()=>null);

      toast.info?.("Updating property info…");
      const tx = await realEstate.connect(signer).updatePropertyInfo(id, info);
      await tx.wait();

      toast.success(`Property #${id} info updated.`);
    } catch (e) {
      toast.error(parseErr(e));
    }
  };

  // setPropertyActive(uint256 tokenId, bool)
  const [spaToken, setSpaToken] = useState("");
  const [spaActive, setSpaActive] = useState(true);

  const doSetPropertyActive = async () => {
    try {
      if (!canREAdmin) return toast.error("Not authorized to set active.");
      if (!amReOwner) return toast.error("Only RealEstate owner can set active state.");
      const id = Number(spaToken);
      if (!Number.isInteger(id) || id <= 0) return toast.error("Enter a valid token ID.");
      const tx = await realEstate.connect(signer).setPropertyActive(id, Boolean(spaActive));
      toast.info?.("Updating active flag…");
      await tx.wait();
      toast.success("Property active state updated.");
    } catch (e) {
      toast.error(parseErr(e));
    }
  };

  return (
    <div className="admin-panel-overlay">
      <div className="admin-panel-container">
        {/* Header */}
        <div className="admin-panel-header">
          <div className="header-content">
            <div>
              <h1>Platform Administration</h1>
              <p>Manage escrow contracts, real estate tokens, and system settings</p>
            </div>
          </div>
          {onClose && (
            <button className="close-button" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="admin-nav-tabs" role="tablist" aria-label="Admin sections">
          <button
            className={`nav-tab ${activeTab === TABS.OVERVIEW ? "active" : ""}`}
            role="tab"
            aria-selected={activeTab === TABS.OVERVIEW}
            onClick={() => setActiveTab(TABS.OVERVIEW)}
          >
            📊 Overview
          </button>

          <button
            className={`nav-tab ${activeTab === TABS.ESCROW ? "active" : ""}`}
            role="tab"
            aria-selected={activeTab === TABS.ESCROW}
            onClick={() => setActiveTab(TABS.ESCROW)}
          >
            🏠 Escrow
          </button>

          <button
            className={`nav-tab ${activeTab === TABS.PROPERTIES ? "active" : ""}`}
            role="tab"
            aria-selected={activeTab === TABS.PROPERTIES}
            onClick={() => setActiveTab(TABS.PROPERTIES)}
          >
            🏘️ Properties
          </button>

          <button
            className={`nav-tab ${activeTab === TABS.COMPLIANCE ? "active" : ""}`}
            role="tab"
            aria-selected={activeTab === TABS.COMPLIANCE}
            onClick={() => setActiveTab(TABS.COMPLIANCE)}
          >
            ⚖️ Compliance
          </button>
        </div>


        <div className="admin-panel-content">
          {activeTab === TABS.OVERVIEW && (
            <section className="admin-section">
              {/* System Overview */}
              <SectionHeader 
                icon="📊" 
                title="System Overview" 
                description="Current system status and your permissions"
              />
              
              <div className="overview-cards">
                <div className="overview-card">
                  <div className="card-header">
                    <h4>🔐 Escrow Contract</h4>
                    <StatusBadge status={paused ? "status-cancelled" : "status-for-sale"}>
                      {paused ? "Paused" : "Active"}
                    </StatusBadge>
                  </div>
                  <div className="card-content">
                    <div className="info-row">
                      <span>Owner:</span>
                      <code>{cut(escrowOwner)}</code>
                    </div>
                    <div className="info-row">
                      <span>Your Role:</span>
                      <span>{amEscrowOwner ? "Owner" : "User"}</span>
                    </div>
                    <div className="permissions">
                      {escrowRoleFlags.ADMIN && <span className="permission-badge">Admin</span>}
                      {escrowRoleFlags.PAUSER && <span className="permission-badge">Pauser</span>}
                      {escrowRoleFlags.TREASURER && <span className="permission-badge">Treasurer</span>}
                      {escrowRoleFlags.EMERGENCY && <span className="permission-badge">Emergency</span>}
                    </div>
                  </div>
                </div>

                <div className="overview-card">
                  <div className="card-header">
                    <h4>🏘️ RealEstate NFT</h4>
                    <StatusBadge status="status-for-sale">Active</StatusBadge>
                  </div>
                  <div className="card-content">
                    <div className="info-row">
                      <span>Owner:</span>
                      <code>{cut(reOwner)}</code>
                    </div>
                    <div className="info-row">
                      <span>Your Role:</span>
                      <span>{amReOwner ? "Owner" : "User"}</span>
                    </div>
                    <div className="permissions">
                      {reRoleFlags.ADMIN && <span className="permission-badge">Admin</span>}
                      {reRoleFlags.METADATA && <span className="permission-badge">Metadata</span>}
                    </div>
                  </div>
                </div>

                <div className="overview-card">
                  <div className="card-header">
                    <h4>💰 Platform Fees</h4>
                  </div>
                  <div className="card-content">
                    <div className="info-row">
                      <span>Current Fee:</span>
                      <span>{platformFee ? `${(Number(platformFee) / 100).toFixed(2)}%` : "—"}</span>
                    </div>
                    <div className="info-row">
                      <span>Recipient:</span>
                      <code>{cut(feeRecipient)}</code>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === TABS.ESCROW && (
            <section className="admin-section">
              {/* Escrow Management */}
              <SectionHeader 
                icon="🏠" 
                title="Escrow Management" 
                description="Control contract state and emergency operations"
              />
              
              <div className="section-grid">
                {/* Contract Controls */}
                <ActionCard 
                  title="Contract State" 
                  description="Pause or unpause the escrow contract"
                >
                  <div className="button-group">
                    <button 
                      className="btn btn-warning" 
                      disabled={!canPause || paused} 
                      onClick={doPause}
                    >
                      ⏸️ Pause Contract
                    </button>
                    <button 
                      className="btn btn-success" 
                      disabled={!canPause || !paused} 
                      onClick={doUnpause}
                    >
                      ▶️ Resume Contract
                    </button>
                  </div>
                </ActionCard>

                {/* Fee Management */}
                <ActionCard 
                  title="Platform Fees" 
                  description="Manage platform fee rates and recipients"
                >
                  <div className="form-group">
                    <FormField 
                      label="Fee Rate (basis points)" 
                      hint="Enter 0-1000 (0% to 10%)"
                    >
                      <input
                        type="number"
                        min="0"
                        max="1000"
                        value={platformFee}
                        onChange={(e) => setPlatformFee(e.target.value)}
                        placeholder="250"
                      />
                    </FormField>
                    <button 
                      className="btn btn-primary" 
                      disabled={!canFees} 
                      onClick={updatePlatformFee}
                    >
                      Update Fee Rate
                    </button>
                  </div>

                  <div className="form-group">
                    <FormField 
                      label="Fee Recipient Address"
                    >
                      <input
                        type="text"
                        value={feeRecipient}
                        onChange={(e) => setFeeRecipient(e.target.value)}
                        placeholder="0x..."
                      />
                    </FormField>
                    <button 
                      className="btn btn-primary" 
                      disabled={!canFees} 
                      onClick={updateFeeRecipient}
                    >
                      Update Recipient
                    </button>
                  </div>
                </ActionCard>
              </div>

              {/* Emergency Controls */}
              <div className="emergency-section">
                <h4>🚨 Emergency Controls</h4>
                <p className="warning-text">These actions should only be used in emergency situations</p>
                
                <div className="emergency-grid">
                  <ActionCard 
                    title="Emergency Cancel Sale" 
                    description="Force cancel a sale and refund buyer"
                    variant="danger"
                  >
                    <FormField label="NFT ID" required>
                      <input
                        type="number"
                        value={emgCancelId}
                        onChange={(e) => setEmgCancelId(e.target.value)}
                        placeholder="Token ID"
                      />
                    </FormField>
                    <FormField label="Refund Recipient" required>
                      <input
                        type="text"
                        value={emgCancelRecipient}
                        onChange={(e) => setEmgCancelRecipient(e.target.value)}
                        placeholder="0x..."
                      />
                    </FormField>
                    <button 
                      className="btn btn-danger" 
                      disabled={!canEmergency} 
                      onClick={doEmergencyCancel}
                    >
                      🚨 Emergency Cancel
                    </button>
                  </ActionCard>

                  <ActionCard 
                    title="Emergency Withdraw" 
                    description="Withdraw funds from escrow contract"
                    variant="danger"
                  >
                    <FormField label="Recipient Address" required>
                      <input
                        type="text"
                        value={emgWRecipient}
                        onChange={(e) => setEmgWRecipient(e.target.value)}
                        placeholder="0x..."
                      />
                    </FormField>
                    <FormField label="Amount (ETH)" required>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={emgWAmount}
                        onChange={(e) => setEmgWAmount(e.target.value)}
                        placeholder="0.0000"
                      />
                    </FormField>
                    <button 
                      className="btn btn-danger" 
                      disabled={!canEmergency} 
                      onClick={doEmergencyWithdraw}
                    >
                      💸 Emergency Withdraw
                    </button>
                  </ActionCard>
                </div>
              </div>
            </section>
          )}

          {activeTab === TABS.PROPERTIES && (
            <section className="admin-section">
              {/* Property Management */}
              <SectionHeader 
                icon="🏘️" 
                title="Property Management" 
                description="Manage NFT properties and authorized minters"
              />
              
              <div className="section-grid">
                <ActionCard 
                  title="Authorized Minters" 
                  description="Grant or revoke minting permissions"
                >
                  <FormField label="Minter Address" required>
                    <input
                      type="text"
                      value={minterAddr}
                      onChange={(e) => setMinterAddr(e.target.value)}
                      placeholder="0x..."
                    />
                  </FormField>
                  <div className="checkbox-field">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={minterAuth}
                        onChange={(e) => setMinterAuth(e.target.checked)}
                      />
                      <span>Authorized to mint</span>
                    </label>
                  </div>
                  <button 
                    className="btn btn-primary" 
                    disabled={!canREAdmin} 
                    onClick={setAuthorizedMinter}
                  >
                    Update Minter Status
                  </button>
                </ActionCard>

                <ActionCard 
                  title="Property Information" 
                  description="Update property metadata"
                >
                  <FormField 
                    label="Token ID" 
                    required
                    hint={upiLocked ? "Editing locked for current status" : "Enter the NFT token ID"}
                    error={upiLocked ? "Property cannot be edited in current state" : null}
                  >
                    <input
                      type="number"
                      value={upiToken}
                      onChange={(e) => setUpiToken(e.target.value)}
                      placeholder="e.g. 12"
                    />
                  </FormField>
                  
                  <FormField label="Property Info (JSON)" required>
                    <textarea
                      rows="8"
                      value={upiJson}
                      onChange={(e) => setUpiJson(e.target.value)}
                      placeholder='{"bedrooms":3,"bathrooms":2,"squareFootage":1200}'
                      className="code-textarea"
                    />
                  </FormField>
                  
                  <button
                    className="btn btn-primary"
                    disabled={!canREAdmin || upiLocked}
                    onClick={doUpdatePropertyInfo}
                  >
                    📝 Update Property Info
                  </button>
                </ActionCard>

                <ActionCard 
                  title="Property Status" 
                  description="Enable or disable property"
                >
                  <FormField label="Token ID" required>
                    <input
                      type="number"
                      value={spaToken}
                      onChange={(e) => setSpaToken(e.target.value)}
                      placeholder="Token ID"
                    />
                  </FormField>
                  <div className="checkbox-field">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={spaActive}
                        onChange={(e) => setSpaActive(e.target.checked)}
                      />
                      <span>Property is active</span>
                    </label>
                  </div>
                  <button 
                    className="btn btn-primary" 
                    disabled={!canREAdmin} 
                    onClick={doSetPropertyActive}
                  >
                    Update Status
                  </button>
                </ActionCard>
              </div>
            </section>
          )}

          {activeTab === TABS.COMPLIANCE && (
            <section className="admin-section">
              {/* Compliance & Monitoring */}
              <SectionHeader 
                icon="⚖️" 
                title="Compliance & Monitoring" 
                description="System compliance checks and regulatory controls"
              />
              <div className="section-grid">
                <CompliancePanel escrow={escrow} signer={signer} account={account} asGridChildren />
              </div>
            </section>
          )} 
        </div>
      </div>
    </div>
  );
}

// ---------- errors ----------
function parseErr(e) {
  return e?.error?.message || e?.data?.message || e?.reason || e?.message || "Transaction failed";
}
