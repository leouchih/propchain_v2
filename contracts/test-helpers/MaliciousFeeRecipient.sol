// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface IEscrow_Reenter {
    function finalizeSale(uint256 _nftID) external;
}

contract MaliciousFeeRecipient {
    IEscrow_Reenter public escrow;
    uint256 public targetId;
    bool public reentryTried;
    bool public reentryOk;

    function setTarget(address _escrow, uint256 _id) external {
        escrow = IEscrow_Reenter(_escrow);
        targetId = _id;
    }

    receive() external payable {
        reentryTried = true;
        // Attempt to reenter finalizeSale. This SHOULD fail due to nonReentrant.
        (bool ok, ) = address(escrow).call(
            abi.encodeWithSelector(IEscrow_Reenter.finalizeSale.selector, targetId)
        );
        // Do NOT revert even if blocked; we want the outer transfer to succeed.
        reentryOk = ok;
    }
}
