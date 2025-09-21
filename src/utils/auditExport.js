// Enhanced version based on Document 7 with improvements
/*import { BigNumber, Contract, providers, utils } from "ethers";

export async function exportAudit(
  escrow,
  tokenId,
  provider,
  opts = {}
) {
  const iface = escrow.interface;
  const toBlock = opts.toBlock ?? "latest";
  const fromBlock = opts.fromBlock ?? 0;

  const toTopicUint = (n) =>
    utils.hexZeroPad(BigNumber.from(n).toHexString(), 32);
  const toTopicAddr = (a) => utils.hexZeroPad(a, 32);

  function cleanArgs(args) {
    const out = {};
    for (const [k, v] of Object.entries(args)) {
      if (!isNaN(Number(k))) continue;
      if (BigNumber.isBigNumber(v)) out[k] = v.toString();
      else if (Array.isArray(v)) out[k] = v.map((x) => (BigNumber.isBigNumber(x) ? x.toString() : x));
      else out[k] = v;
    }
    return out;
  }

  // Comprehensive event list for real estate transactions
  const tokenEvents = [
    "PropertyListed",
    "ContractSigned", 
    "BidPlaced",
    "BidAccepted",
    "BidWithdrawn",
    "EarnestDeposited",
    "FundsReceived",
    "FundsTransferred",
    "InspectionUpdated",
    "SaleApproved",
    "SaleFinalized",
    "SaleCancelled",
    "PropertyStatusChanged",
    "EmergencyWithdrawal",
    "PaymentMethodSelected",
    "UnlockSet",
    "DocHashRegistered",
  ];

  const tokenTopic = toTopicUint(tokenId);
  const collectedLogs = [];

  // Collect property-specific events
  for (const name of tokenEvents) {
    try {
      const topic0 = iface.getEventTopic(name);
      const logs = await provider.getLogs({
        address: escrow.address,
        topics: [topic0, tokenTopic],
        fromBlock,
        toBlock,
      });
      collectedLogs.push(...logs);
    } catch (error) {
      console.warn(`Failed to fetch ${name} events:`, error);
      // Continue with other events instead of failing completely
    }
  }

  // Include compliance events for specific wallet (optional)
  if (opts.includeComplianceFor) {
    const acctTopic = toTopicAddr(opts.includeComplianceFor);
    for (const name of ["AllowlistUpdated", "CredentialHashSet"]) {
      try {
        const topic0 = iface.getEventTopic(name);
        const logs = await provider.getLogs({
          address: escrow.address,
          topics: [topic0, acctTopic],
          fromBlock,
          toBlock,
        });
        collectedLogs.push(...logs);
      } catch (error) {
        console.warn(`Failed to fetch ${name} events:`, error);
      }
    }
  }

  // Include NFT Transfer events (optional)
  if (opts.nft) {
    try {
      const transferTopic = opts.nft.interface.getEventTopic("Transfer");
      const logs = await provider.getLogs({
        address: opts.nft.address,
        topics: [transferTopic, null, null, toTopicUint(tokenId)],
        fromBlock,
        toBlock,
      });
      collectedLogs.push(...logs);
    } catch (error) {
      console.warn("Failed to fetch NFT Transfer events:", error);
    }
  }

  // Sort chronologically
  collectedLogs.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.logIndex - b.logIndex));

  // Cache timestamps for efficiency
  const tsCache = new Map();
  const getTs = async (bn) => {
    if (!tsCache.has(bn)) {
      try {
        const block = await provider.getBlock(bn);
        tsCache.set(bn, block.timestamp);
      } catch (error) {
        console.warn(`Failed to get block ${bn} timestamp:`, error);
        tsCache.set(bn, 0); // fallback
      }
    }
    return tsCache.get(bn);
  };

  const events = [];

  // Parse all collected logs
  for (const log of collectedLogs) {
    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch {
      // Try NFT interface if escrow parsing fails
      if (opts.nft) {
        try {
          parsed = opts.nft.interface.parseLog(log);
        } catch {
          console.warn("Failed to parse log:", log);
          continue;
        }
      } else {
        continue;
      }
    }

    if (!parsed) continue;

    events.push({
      name: parsed.name,
      address: log.address,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      transactionHash: log.transactionHash,
      timestamp: await getTs(log.blockNumber),
      args: cleanArgs(parsed.args),
    });
  }

  // Get network info
  const net = await provider.getNetwork();

  const payload = {
    tokenId,
    escrow: escrow.address,
    network: { chainId: net.chainId, name: net.name },
    fromBlock,
    toBlock,
    count: events.length,
    generatedAt: new Date().toISOString(),
    events,
  };

  // Download as JSON
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit_property_${tokenId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    
    return payload;
  } catch (error) {
    console.error("Failed to download audit file:", error);
    throw new Error("Export failed: Could not generate download file");
  }
}*/