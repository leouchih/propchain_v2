import { ethers } from "ethers";
import { useEffect, useState } from "react";
import logo from "../assets/logo.png";

const Navigation = ({
  account,
  setAccount,
  toggleCreateForm,
  toggleAdminPanel,   // NEW
  escrow,
  realEstate          // NEW
}) => {
  const [isSeller, setIsSeller] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const fmt = (a) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "");

  // Seller check
  useEffect(() => {
    const checkIsSeller = async () => {
      if (!account || !escrow) return setIsSeller(false);
      try {
        const seller = await escrow.getSeller();
        setIsSeller(!!seller && seller.toLowerCase() === account.toLowerCase());
      } catch (e) {
        console.error("Error checking seller:", e);
        setIsSeller(false);
      }
    };
    checkIsSeller();
  }, [account, escrow]);

  // Admin check (Escrow and/or RealEstate)
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

  const connectHandler = async () => {
    try {
      if (!window.ethereum) {
        console.warn("No wallet detected.");
        return;
      }
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const addr = ethers.utils.getAddress(accounts[0]);
      setAccount(addr);
      setIsMenuOpen(false);
    } catch (error) {
      console.error("Connection error:", error);
    }
  };

  const toggleMenu = () => setIsMenuOpen((s) => !s);

  return (
    <nav className="navigation">
      <div className="nav__brand">
        <img src={logo} alt="Logo" className="nav__logo" />
        <h1 className="nav__title">PropChain</h1>
      </div>

      <button
        className="nav__menu-toggle"
        onClick={toggleMenu}
        aria-expanded={isMenuOpen}
        aria-label="Toggle menu"
      >
        <span></span><span></span><span></span>
      </button>

      <div className={`nav__actions ${isMenuOpen ? "nav__actions--active" : ""}`}>
        {account ? (
          <>
            {isAdmin && (
              <button
                type="button"
                className="btn btn--warning"
                onClick={() => { toggleAdminPanel?.(); setIsMenuOpen(false); }}
              >
                <i className="fa fa-shield-alt"></i> Admin
              </button>
            )}

            {isSeller && (
              <div className="seller-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => { toggleCreateForm(); setIsMenuOpen(false); }}
                >
                  <i className="fa fa-plus-circle"></i> List Property
                </button>
              </div>
            )}

            <button type="button" className="btn btn--wallet" title={account}>
              <span className="wallet-icon"><i className="fa fa-wallet"></i></span>
              {fmt(account)}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--connect" onClick={connectHandler}>
            <i className="fa fa-plug"></i> Connect Wallet
          </button>
        )}
      </div>
    </nav>
  );
};

export default Navigation;
