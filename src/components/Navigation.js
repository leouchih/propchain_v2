import { ethers } from "ethers";
import { useEffect, useState } from "react";
import logo from "../assets/logo.png";

const Navigation = ({
  account,
  setAccount,
  toggleCreateForm,
  toggleSellerDashboard,
  escrow,
}) => {
  const [isSeller, setIsSeller] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Check if connected account is the seller
  useEffect(() => {
    const checkIsSeller = async () => {
      if (account && escrow) {
        try {
          const seller = await escrow.seller();
          setIsSeller(seller.toLowerCase() === account.toLowerCase());
        } catch (error) {
          console.error("Error checking seller:", error);
          setIsSeller(false);
        }
      } else {
        setIsSeller(false);
      }
    };

    checkIsSeller();
  }, [account, escrow]);

  const connectHandler = async () => {
    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      const account = ethers.utils.getAddress(accounts[0]);
      setAccount(account);
    } catch (error) {
      console.error("Connection error:", error);
    }
  };

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  return (
    <nav className="navigation">
      <div className="nav__brand">
        <img src={logo} alt="Logo" className="nav__logo" />
        <h1 className="nav__title">PropChain</h1>
      </div>

      {/* Hamburger menu for mobile */}
      <div className="nav__menu-toggle" onClick={toggleMenu}>
        <span></span>
        <span></span>
        <span></span>
      </div>

      <ul className={`nav__links ${isMenuOpen ? "nav__links--active" : ""}`}>
        <li>
          <a href="#" className="nav__link">
            Buy
          </a>
        </li>
        <li>
          <a href="#" className="nav__link">
            Rent
          </a>
        </li>
        <li>
          <a href="#" className="nav__link">
            Sell
          </a>
        </li>
      </ul>

      <div
        className={`nav__actions ${isMenuOpen ? "nav__actions--active" : ""}`}
      >
        {account ? (
          <>
            {isSeller && (
              <div className="seller-actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={toggleSellerDashboard}
                >
                  <i className="fa fa-building"></i> My Properties
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={toggleCreateForm}
                >
                  <i className="fa fa-plus-circle"></i> List Property
                </button>
              </div>
            )}
            <button type="button" className="btn btn--wallet">
              <span className="wallet-icon">
                <i className="fa fa-wallet"></i>
              </span>
              {account.slice(0, 6) + "..." + account.slice(38, 42)}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--connect"
            onClick={connectHandler}
          >
            <i className="fa fa-plug"></i> Connect Wallet
          </button>
        )}
      </div>
    </nav>
  );
};

export default Navigation;
