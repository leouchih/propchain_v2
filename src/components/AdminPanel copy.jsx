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

  // setBaseURI(string)
  const [baseURI, setBaseURI] = useState("");

  const updateBaseURI = async () => {
    try {
      if (!canREMeta) return toast.error("Not authorized to set base URI.");
      if (!amReOwner) return toast.error("Only RealEstate owner can set base URI.");
      if (!baseURI) return toast.error("Base URI cannot be empty.");
      const tx = await realEstate.connect(signer).setBaseURI(baseURI);
      toast.info?.("Setting base URI…");
      await tx.wait();
      toast.success("Base URI updated.");
    } catch (e) {
      toast.error(parseErr(e));
    }
  };

  // batchMint(address[] recipients, string[] uris, PropertyInfo[] propertyDataArray)
  // We’ll accept JSON arrays in three textareas to keep UI simple.
  const [bmRecipients, setBmRecipients] = useState('["0x..."]');
  const [bmUris, setBmUris] = useState('["ipfs://..."]');
  const [bmProps, setBmProps] = useState(
    `[
  {
    "propertyType": "residential",
    "squareFootage": 1200,
    "location": "City, State",
    "yearBuilt": 2020,
    "bedrooms": 3,
    "bathrooms": 2,
    "isActive": true
  }
]`
  );

  const doBatchMint = async () => {
    try {
      if (!canREAdmin) return toast.error("Not authorized to batch mint.");
      if (!amReOwner) return toast.error("Only RealEstate owner can batch mint.");
      let recipients = JSON.parse(bmRecipients);
      let uris = JSON.parse(bmUris);
      let props = JSON.parse(bmProps);
      if (!Array.isArray(recipients) || !Array.isArray(uris) || !Array.isArray(props)) {
        return toast.error("All three inputs must be JSON arrays.");
      }
      if (!(recipients.length && recipients.length === uris.length && uris.length === props.length)) {
        return toast.error("Arrays must have the same non-zero length.");
      }
      if (!recipients.every(isAddr)) return toast.error("Recipients contain invalid address(es).");

      // Ethers can pass struct arrays directly when fields match
      const tx = await realEstate.connect(signer).batchMint(recipients, uris, props);
      toast.info?.("Batch minting…");
      await tx.wait();
      toast.success("Batch mint completed.");
    } catch (e) {
      toast.error(parseErr(e));
    }
  };

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

  const doUpdatePropertyInfo = async () => {
    try {
      if (!canREAdmin) return toast.error("Not authorized to update info.");
      if (!amReOwner) return toast.error("Only RealEstate owner can update info (or token owner).");
      const id = Number(upiToken);
      if (!Number.isInteger(id) || id <= 0) return toast.error("Enter a valid token ID.");
      const info = JSON.parse(upiJson);
      const tx = await realEstate.connect(signer).updatePropertyInfo(id, info);
      toast.info?.("Updating property info…");
      await tx.wait();
      toast.success("Property info updated.");
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
    <div className="admin-panel">
      <div className="admin-card">
        <div className="admin-header">
          <h2>Admin Panel</h2>
          {onClose && (
            <button className="btn btn--icon" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>

        {/* Ownership summary */}
        <div className="grid two">
          <div className="panel">
            <h4>Escrow</h4>
            <p><b>Owner:</b> {escrowOwner ? cut(escrowOwner) : "—"}</p>
            <p><b>Paused:</b> {paused ? "Yes" : "No"}</p>
            <p><b>You:</b> {cut(account)} {amEscrowOwner ? "(owner)" : ""}</p>
          </div>
          <div className="panel">
            <h4>RealEstate</h4>
            <p><b>Owner:</b> {reOwner ? cut(reOwner) : "—"}</p>
            <p><b>You:</b> {cut(account)} {amReOwner ? "(owner)" : ""}</p>
          </div>
        </div>

        {/* ESCROW CONTROLS */}
        <section className="section">
          <h3>Escrow Controls</h3>

          <div className="row">
            <button className="btn btn--secondary" disabled={!canPause || paused} onClick={doPause}>Pause</button>
            <button className="btn btn--primary" disabled={!canPause || !paused} onClick={doUnpause}>Unpause</button>
          </div>

          <div className="grid two">
            <div className="panel">
              <label>Platform Fee (bps 0–1000)</label>
              <input
                type="number"
                min="0"
                max="1000"
                value={platformFee}
                onChange={(e) => setPlatformFee(e.target.value)}
              />
              <button className="btn btn--primary" disabled={!canFees} onClick={updatePlatformFee}>Update Fee</button>
            </div>

            <div className="panel">
              <label>Fee Recipient</label>
              <input
                type="text"
                value={feeRecipient}
                placeholder="0x…"
                onChange={(e) => setFeeRecipient(e.target.value)}
              />
              <button className="btn btn--primary" disabled={!canFees} onClick={updateFeeRecipient}>Update Recipient</button>
            </div>
          </div>

          <div className="grid two">
            <div className="panel">
              <h4>Emergency Cancel Sale</h4>
              <label>NFT ID</label>
              <input type="number" value={emgCancelId} onChange={(e) => setEmgCancelId(e.target.value)} />
              <label>Refund Recipient</label>
              <input type="text" value={emgCancelRecipient} onChange={(e) => setEmgCancelRecipient(e.target.value)} placeholder="0x…" />
              <button className="btn btn--danger" disabled={!canEmergency} onClick={doEmergencyCancel}>Emergency Cancel</button>
            </div>

            <div className="panel">
              <h4>Emergency Withdraw</h4>
              <label>Recipient</label>
              <input type="text" value={emgWRecipient} onChange={(e) => setEmgWRecipient(e.target.value)} placeholder="0x…" />
              <label>Amount (ETH)</label>
              <input type="number" min="0" step="0.0001" value={emgWAmount} onChange={(e) => setEmgWAmount(e.target.value)} />
              <button className="btn btn--danger" disabled={!canEmergency} onClick={doEmergencyWithdraw}>Emergency Withdraw</button>
            </div>
          </div>
        </section>

        <section className="section">
          <h3 style={{marginTop: 24}}>Compliance</h3>
          <CompliancePanel escrow={escrow} signer={signer} account={account} />
        </section>

        {/* REALESTATE CONTROLS */}
        <section className="section">
          <h3>RealEstate Controls</h3>

          <div className="grid two">
            <div className="panel">
              <h4>Authorized Minter</h4>
              <label>Address</label>
              <input type="text" value={minterAddr} onChange={(e) => setMinterAddr(e.target.value)} placeholder="0x…" />
              <div className="row">
                <label className="checkbox">
                  <input type="checkbox" checked={minterAuth} onChange={(e) => setMinterAuth(e.target.checked)} />
                  <span>Authorized</span>
                </label>
              </div>
              <button className="btn btn--primary" disabled={!canREAdmin} onClick={setAuthorizedMinter}>Update Minter</button>
            </div>

            <div className="panel">
              <h4>Base URI</h4>
              <label>Base URI</label>
              <input type="text" value={baseURI} onChange={(e) => setBaseURI(e.target.value)} placeholder="https://gateway.pinata.cloud/ipfs/" />
              <button className="btn btn--primary" disabled={!canREMeta} onClick={updateBaseURI}>Set Base URI</button>
            </div>
          </div>

          {/*<div className="panel">
            <h4>Batch Mint</h4>
            <div className="grid three">
              <div>
                <label>Recipients (JSON array)</label>
                <textarea rows="6" value={bmRecipients} onChange={(e) => setBmRecipients(e.target.value)} />
              </div>
              <div>
                <label>URIs (JSON array)</label>
                <textarea rows="6" value={bmUris} onChange={(e) => setBmUris(e.target.value)} />
              </div>
              <div>
                <label>PropertyInfo[] (JSON array)</label>
                <textarea rows="6" value={bmProps} onChange={(e) => setBmProps(e.target.value)} />
              </div>
            </div>
            <button className="btn btn--primary" disabled={!canREAdmin} onClick={doBatchMint}>Batch Mint</button>
            <p className="hint">
              Each <code>PropertyInfo</code> object should include: <code>propertyType</code>, <code>squareFootage</code>, <code>location</code>, <code>yearBuilt</code>, <code>bedrooms</code>, <code>bathrooms</code>, <code>isActive</code>.
            </p>
          </div>*/}

          <div className="grid two">
            <div className="panel">
              <h4>Update Property Info</h4>
              <label>Token ID</label>
              <input type="number" value={upiToken} onChange={(e) => setUpiToken(e.target.value)} />
              <label>PropertyInfo (JSON)</label>
              <textarea rows="6" value={upiJson} onChange={(e) => setUpiJson(e.target.value)} />
              <button className="btn btn--primary" disabled={!canREAdmin} onClick={doUpdatePropertyInfo}>Update Info</button>
            </div>

            <div className="panel">
              <h4>Set Property Active</h4>
              <label>Token ID</label>
              <input type="number" value={spaToken} onChange={(e) => setSpaToken(e.target.value)} />
              <div className="row">
                <label className="checkbox">
                  <input type="checkbox" checked={spaActive} onChange={(e) => setSpaActive(e.target.checked)} />
                  <span>Active</span>
                </label>
              </div>
              <button className="btn btn--primary" disabled={!canREAdmin} onClick={doSetPropertyActive}>Update Active</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------- errors ----------
function parseErr(e) {
  return e?.error?.message || e?.data?.message || e?.reason || e?.message || "Transaction failed";
}
