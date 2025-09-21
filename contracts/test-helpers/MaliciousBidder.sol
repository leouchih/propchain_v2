// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface IEscrow_Bid {
    function placeBid(uint256 _nftID) external payable;
    function withdrawBid(uint256 _nftID) external;
}

contract MaliciousBidder {
    IEscrow_Bid public escrow;
    uint256 public nftId;
    bool public reentryTried;
    bool public reentryOk;

    constructor(address _escrow, uint256 _nftId) {
        escrow = IEscrow_Bid(_escrow);
        nftId = _nftId;
    }

    function bid() external payable {
        escrow.placeBid{value: msg.value}(nftId);
    }

    receive() external payable {
        reentryTried = true;
        // Try to reenter via withdrawBid during refund from _refundOtherBidders().
        (bool ok, ) = address(escrow).call(
            abi.encodeWithSelector(IEscrow_Bid.withdrawBid.selector, nftId)
        );
        // This SHOULD fail (nonReentrant + bid already zeroed).
        reentryOk = ok;
    }
}
