import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { useToast } from "../ToastContext";

const hashStr = (s) => ethers.utils.id(s || ""); // simple string→keccak256

// Form Field Component (reused from AdminPanel)
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

// Action Card Component (reused from AdminPanel)
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

// Status Badge Component
const StatusBadge = ({ status, children }) => (
  <span className={`status-badge ${status}`}>{children}</span>
);

export default function CompliancePanel({ escrow, signer, account,asGridChildren = false }) {
  const toast = useToast();
  const wrapperClass = asGridChildren ? "grid-contents" : "admin-box";

  // State for form inputs
  const [addr, setAddr] = useState("");
  const [allow, setAllow] = useState(true);
  const [cred, setCred] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [unlockAt, setUnlockAt] = useState("");
  const [deed, setDeed] = useState("");
  const [inspection, setInspection] = useState("");
  const [disclosure, setDisclosure] = useState("");
  
  // State for compliance status display
  const [statusAddr, setStatusAddr] = useState("");
  const [complianceStatus, setComplianceStatus] = useState({
    isAllowlisted: false,
    hasCredential: false,
    unlockTime: 0
  });
  
  // State for authorization check
  const [hasComplianceRole, setHasComplianceRole] = useState(false);
  // Check if user has COMPLIANCE_ROLE
  useEffect(() => {
    const checkRole = async () => {
      if (!escrow || !account) return;
      try {
        const COMPLIANCE_ROLE = ethers.utils.id("COMPLIANCE_ROLE");
        const hasRole = await escrow.hasRole(COMPLIANCE_ROLE, account);
        setHasComplianceRole(hasRole);
      } catch (error) {
        console.error("Error checking compliance role:", error);
        setHasComplianceRole(false);
      }
    };
    checkRole();
  }, [escrow, account]);

  if (!escrow || !signer) {
    return <div className="admin-box">Connect wallet as admin to manage compliance.</div>;
  }

  if (!hasComplianceRole) {
    return (
      <div className="admin-box">
        <p>You need COMPLIANCE_ROLE to manage compliance settings.</p>
        <p>Current account: {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : 'Not connected'}</p>
      </div>
    );
  }

  const withSigner = escrow.connect(signer);

  // Check compliance status for an address
  const checkComplianceStatus = async () => {
    if (!statusAddr || !ethers.utils.isAddress(statusAddr)) {
      toast.error("Enter a valid address");
      return;
    }
    
    try {
      const [isAllowed, hasCred] = await Promise.all([
        escrow.isAllowlisted(statusAddr),
        escrow.hasCredential(statusAddr)
      ]);
      
      // Get unlock time for a specific token if provided
      let unlockTime = 0;
      if (tokenId) {
        const id = parseInt(tokenId, 10);
        if (id > 0) {
          unlockTime = await escrow.getUnlockAt(id);
        }
      }
      
      setComplianceStatus({
        isAllowlisted: isAllowed,
        hasCredential: hasCred,
        unlockTime: Number(unlockTime)
      });
      
      toast.success("Compliance status retrieved");
    } catch (error) {
      toast.error("Failed to check compliance status");
      console.error(error);
    }
  };

  async function updateAllowlist() {
    if (!addr || !ethers.utils.isAddress(addr)) {
      toast.error("Enter a valid address");
      return;
    }
    
    try {
      const tx = await withSigner.setAllowlist(addr, allow);
      toast.info("Updating allowlist...");
      await tx.wait();
      toast.success(`Address ${allow ? 'added to' : 'removed from'} allowlist`);
    } catch (e) {
      toast.error(e?.data?.message || e.message || "Transaction failed");
    }
  }

  async function setCredential() {
    if (!addr || !ethers.utils.isAddress(addr)) {
      toast.error("Enter a valid address");
      return;
    }
    
    try {
      const credHash = cred ? hashStr(cred) : ethers.constants.HashZero;
      const tx = await withSigner.setCredentialHash(addr, credHash);
      toast.info("Setting credential hash...");
      await tx.wait();
      toast.success(cred ? "Credential hash set" : "Credential hash cleared");
    } catch (e) {
      toast.error(e?.data?.message || e.message || "Transaction failed");
    }
  }

  async function setLockup() {
    const id = parseInt(tokenId || "0", 10);
    if (id <= 0) {
      toast.error("Enter a valid token ID");
      return;
    }
    
    try {
      const ts = parseInt(unlockAt || "0", 10);
      const tx = await withSigner.setUnlockAt(id, ts);
      toast.info("Setting lockup...");
      await tx.wait();
      toast.success(ts > 0 ? `Lockup set until ${new Date(ts * 1000).toLocaleString()}` : "Lockup cleared");
    } catch (e) {
      toast.error(e?.data?.message || e.message || "Transaction failed");
    }
  }

  async function registerDocs() {
    const id = parseInt(tokenId || "0", 10);
    if (id <= 0) {
      toast.error("Enter a valid token ID");
      return;
    }
    
    if (!deed && !inspection && !disclosure) {
      toast.error("Enter at least one document");
      return;
    }
    
    try {
      const DOC_DEED = await escrow.DOC_DEED();
      const DOC_INSPECTION = await escrow.DOC_INSPECTION();
      const DOC_DISCLOSURE = await escrow.DOC_DISCLOSURE();

      toast.info("Registering documents...");
      
      const promises = [];
      if (deed) {
        promises.push(withSigner.registerDocHash(id, DOC_DEED, hashStr(deed)));
      }
      if (inspection) {
        promises.push(withSigner.registerDocHash(id, DOC_INSPECTION, hashStr(inspection)));
      }
      if (disclosure) {
        promises.push(withSigner.registerDocHash(id, DOC_DISCLOSURE, hashStr(disclosure)));
      }

      const txs = await Promise.all(promises);
      await Promise.all(txs.map(tx => tx.wait()));

      toast.success("Documents registered successfully");
    } catch (e) {
      toast.error(e?.data?.message || e.message || "Transaction failed");
    }
  }

  // Helper to format timestamp
  const formatTimestamp = (timestamp) => {
    if (!timestamp || timestamp === 0) return "No lockup";
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const isActive = date > now;
    return `${date.toLocaleString()} ${isActive ? '(ACTIVE)' : '(expired)'}`;
  };

  return (
    <div className={wrapperClass}>
      <ActionCard title="Check Compliance Status">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!statusAddr?.trim()) return; // no-op if empty
            checkComplianceStatus();
          }}
        >
          <FormField label="Address" required htmlFor="compliance-address">
            <input
              id="compliance-address"
              name="address"
              type="text"
              placeholder="0xAddress to check…"
              value={statusAddr}
              onChange={(e) => setStatusAddr(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              inputMode="latin"
            />
          </FormField>

          <FormField label="Token ID (optional)" htmlFor="compliance-token">
            <input
              id="compliance-token"
              name="tokenId"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="e.g. 12"
              value={tokenId}
              onChange={(e) => setTokenId(e.target.value)}
              autoComplete="off"
            />
          </FormField>

          <button
            className="btn btn-primary"
            type="submit"
            disabled={!statusAddr?.trim()}
            aria-disabled={!statusAddr?.trim()}
          >
            Check Status
          </button>
        </form>

        {statusAddr?.trim() && complianceStatus && (
          <div className="compliance-status">
            <p><strong>Address:</strong> {statusAddr}</p>
            <p><strong>Allowlisted:</strong> {complianceStatus.isAllowlisted ? '✅ Yes' : '❌ No'}</p>
            <p><strong>Has Credential:</strong> {complianceStatus.hasCredential ? '✅ Yes' : '❌ No'}</p>
            <p><strong>Lockup:</strong> {formatTimestamp(complianceStatus.unlockTime)}</p>
          </div>
        )}
      </ActionCard>
      {/* Allowlist Management */}
      <ActionCard title="Manage Allowlist">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!addr?.trim()) return;
            updateAllowlist();
          }}
        >
          <FormField label="Wallet Address" required htmlFor="aw-address">
            <input
              id="aw-address"
              name="allowlistAddress"
              type="text"
              placeholder="0xWallet address…"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              inputMode="latin"
            />
          </FormField>

          <FormField label="Action" htmlFor="aw-action">
            <select
              id="aw-action"
              className="admin-select"
              value={allow ? "1" : "0"}
              onChange={(e) => setAllow(e.target.value === "1")}
            >
              <option value="1">Allow</option>
              <option value="0">Disallow</option>
            </select>
          </FormField>

          <button
            className="btn btn-primary"
            type="submit"
            disabled={!/^0x[a-fA-F0-9]{40}$/.test(addr || "")}
            aria-disabled={!/^0x[a-fA-F0-9]{40}$/.test(addr || "")}
          >
            Update Allowlist
          </button>
        </form>
      </ActionCard>

      {/* Credential Management */}
      <ActionCard title="Manage Credentials">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // credential can be empty to clear; only guard address
            if (!/^0x[a-fA-F0-9]{40}$/.test(addr || "")) return;
            setCredential();
          }}
        >
          <FormField label="Address (reused from Allowlist field)" required htmlFor="cm-address">
            <input
              id="cm-address"
              type="text"
              placeholder="0xWallet address…"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>

          <FormField label="KYC Credential" htmlFor="cm-cred" hint="Leave empty to clear credential">
            <input
              id="cm-cred"
              type="text"
              placeholder="KYC credential string"
              value={cred}
              onChange={(e) => setCred(e.target.value)}
              autoComplete="off"
            />
          </FormField>

          <button
            className="btn btn-primary"
            type="submit"
            disabled={!/^0x[a-fA-F0-9]{40}$/.test(addr || "")}
          >
            Set Credential
          </button>
        </form>
      </ActionCard>

      {/* Lockup Management */}
      <ActionCard title="Manage Lockups">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!tokenId?.trim()) return;
            setLockup();
          }}
        >
          <FormField label="Token ID" required htmlFor="lu-token">
            <input
              id="lu-token"
              name="tokenId"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Token ID"
              value={tokenId}
              onChange={(e) => setTokenId(e.target.value)}
              autoComplete="off"
            />
          </FormField>

          <FormField
            label="Unlock Timestamp"
            htmlFor="lu-unlock"
            hint={`Use Unix time. Example: ${Math.floor(Date.now() / 1000 + 86400)} (24h from now). Use 0 to clear.`}
          >
            <input
              id="lu-unlock"
              name="unlockAt"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Unix timestamp (0 to clear)"
              value={unlockAt}
              onChange={(e) => setUnlockAt(e.target.value)}
              autoComplete="off"
            />
          </FormField>

          <button
            className="btn btn-primary"
            type="submit"
            disabled={!/^\d+$/.test(tokenId || "") || !/^\d+$/.test((unlockAt || "0").toString())}
          >
            Set Lockup
          </button>
        </form>
      </ActionCard>
    </div>

  );
}