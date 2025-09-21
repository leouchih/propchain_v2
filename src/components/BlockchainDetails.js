import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

const BlockchainDetails = ({ home, escrow, provider, account, nftAddress, owner }) => {
  const [networkInfo, setNetworkInfo] = useState({
    name: 'Unknown',
    chainId: null,
    explorer: null
  });
  const [totalSupply, setTotalSupply] = useState(null);
  const [isLocalDev, setIsLocalDev] = useState(false);

  useEffect(() => {
    const fetchNetworkInfo = async () => {
      if (!provider) return;
      
      try {
        const network = await provider.getNetwork();
        const chainId = network.chainId;
        
        // Known public explorers
        const explorerMap = {
          1: { name: 'Ethereum Mainnet', url: 'https://etherscan.io' },
          5: { name: 'Goerli Testnet', url: 'https://goerli.etherscan.io' },
          11155111: { name: 'Sepolia Testnet', url: 'https://sepolia.etherscan.io' },
          137: { name: 'Polygon Mainnet', url: 'https://polygonscan.com' },
          80001: { name: 'Mumbai Testnet', url: 'https://mumbai.polygonscan.com' },
        };

        const networkConfig = explorerMap[chainId];
        const isLocal = chainId === 31337; // Hardhat default

        setNetworkInfo({
          name: networkConfig?.name || (isLocal ? 'Hardhat Local' : `Chain ${chainId}`),
          chainId: chainId,
          explorer: networkConfig?.url || null
        });
        setIsLocalDev(isLocal);
      } catch (error) {
        console.error('Error fetching network info:', error);
      }
    };

    fetchNetworkInfo();
  }, [provider]);

  useEffect(() => {
    const fetchTotalSupply = async () => {
      if (!provider || !nftAddress) return;

      try {
        // First try standard ERC721Enumerable totalSupply()
        const nftContract = new ethers.Contract(
          nftAddress,
          [
            "function totalSupply() view returns (uint256)",
            "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
          ],
          provider
        );

        try {
          const supply = await nftContract.totalSupply();
          setTotalSupply(supply.toNumber());
          return;
        } catch {
          // Contract doesn't implement totalSupply, count mints manually
        }

        // Fallback: Count unique mints by parsing Transfer events from zero address
        const transferFilter = {
          address: nftAddress,
          topics: [
            nftContract.interface.getEventTopic("Transfer"),
            ethers.utils.hexZeroPad(ethers.constants.AddressZero, 32) // from zero address (minting)
          ],
          fromBlock: 0,
          toBlock: 'latest'
        };

        const logs = await provider.getLogs(transferFilter);
        const uniqueTokenIds = new Set();
        
        logs.forEach(log => {
          try {
            const parsed = nftContract.interface.parseLog(log);
            uniqueTokenIds.add(parsed.args.tokenId.toString());
          } catch (e) {
            // Skip unparseable logs
          }
        });

        setTotalSupply(uniqueTokenIds.size);
      } catch (error) {
        console.error('Error fetching total supply:', error);
        setTotalSupply(null);
      }
    };

    fetchTotalSupply();
  }, [provider, nftAddress]);

  const formatAddress = (addr) => 
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : 'Unknown';

  const ExplorerLink = ({ address, type = 'address', tokenId, children }) => {
    if (!networkInfo.explorer) {
      return <code className="address-display">{address}</code>;
    }

    let url = `${networkInfo.explorer}/${type}/${address}`;
    if (type === 'token' && tokenId) {
      url += `?a=${tokenId}`;
    }

    return (
      <a 
        href={url} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="explorer-link"
        title={`View on ${networkInfo.explorer.split('//')[1]}`}
      >
        {children}
        <i className="fa fa-external-link-alt external-icon"></i>
      </a>
    );
  };

  return (
    <div className="blockchain-details-panel">
      <h3>⛓️ Blockchain Details</h3>
      
      <div className="detail-grid">
        <div className="detail-row">
          <span className="label">Network:</span>
          <span className="value">
            {networkInfo.name}
            {isLocalDev && <span className="dev-badge">Local Dev</span>}
          </span>
        </div>

        <div className="detail-row">
          <span className="label">Property ID:</span>
          <span className="value">#{home?.id || 'Unknown'}</span>
        </div>

        {nftAddress && (
          <div className="detail-row">
            <span className="label">NFT Contract:</span>
            <span className="value">
              <ExplorerLink address={nftAddress}>
                {formatAddress(nftAddress)}
              </ExplorerLink>
            </span>
          </div>
        )}

        {escrow?.address && (
          <div className="detail-row">
            <span className="label">Escrow Contract:</span>
            <span className="value">
              <ExplorerLink address={escrow.address}>
                {formatAddress(escrow.address)}
              </ExplorerLink>
            </span>
          </div>
        )}

        {owner && (
          <div className="detail-row">
            <span className="label">Current Owner:</span>
            <span className="value">
              <ExplorerLink address={owner}>
                {formatAddress(owner)}
              </ExplorerLink>
              {account && owner.toLowerCase() === account.toLowerCase() && (
                <span className="owner-badge">You</span>
              )}
            </span>
          </div>
        )}

        {totalSupply !== null && (
          <div className="detail-row">
            <span className="label">Total Properties:</span>
            <span className="value">{totalSupply.toLocaleString()}</span>
          </div>
        )}
      </div>

      {isLocalDev ? (
        <div className="dev-notice">
          <i className="fa fa-info-circle"></i>
          <span>
            Running on local development network. Deploy to a testnet like Sepolia 
            to see live blockchain explorer links.
          </span>
        </div>
      ) : (
        <div className="verification-actions">
          <h4>🔍 Verification Tools</h4>
          <div className="action-buttons">
            {nftAddress && (
              <ExplorerLink address={nftAddress} type="token" tokenId={home?.id}>
                <button className="btn btn--outline">
                  <i className="fa fa-search"></i>
                  View NFT Details
                </button>
              </ExplorerLink>
            )}
            {escrow?.address && (
              <ExplorerLink address={escrow.address}>
                <button className="btn btn--outline">
                  <i className="fa fa-file-contract"></i>
                  View Escrow Contract
                </button>
              </ExplorerLink>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BlockchainDetails;