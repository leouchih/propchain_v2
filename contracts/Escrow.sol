//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IERC721 {
    function transferFrom(
        address _from,
        address _to,
        uint256 _id 
    ) external;
}

contract Escrow {
    address public nftAddress;
    address payable public seller;
    address public inspector;
    address public lender;

    modifier onlyBuyer(uint256 _nftID) {
        require(msg.sender == buyer[_nftID], "Only buyer can call this method");
        _;
    }

    modifier onlySeller() {
        require(msg.sender == seller, "Only seller can call this method");
        _;
    }

    modifier onlyInspector() {
        require(msg.sender == inspector, "Only inspector can call this method");
        _;
    }

    mapping(uint256 => bool) public isListed;
    mapping(uint256 => uint256) public purchasePrice;
    mapping(uint256 => uint256) public escrowAmount;
    mapping(uint256 => address) public buyer;
    mapping(uint256 => bool) public inspectionPassed;
    mapping(uint256 => mapping(address => bool)) public approval;
    mapping(uint256 => uint256) public paidAmount; // Track how much has been paid

    // Events for tracking ETH movements
    event PropertyListed(uint256 indexed nftId, uint256 price, uint256 escrowAmount);
    event EarnestDeposited(uint256 indexed nftId, address indexed buyer, uint256 amount);
    event FundsReceived(uint256 indexed nftId, address indexed from, uint256 amount);
    event FundsTransferred(uint256 indexed nftId, address indexed to, uint256 amount);
    event InspectionUpdated(uint256 indexed nftId, bool passed);
    event SaleApproved(uint256 indexed nftId, address indexed approver);
    event SaleFinalized(uint256 indexed nftId, address indexed buyer, uint256 price);
    event SaleCancelled(uint256 indexed nftId, address refundRecipient, uint256 amount);

    constructor(
        address _nftAddress,
        address payable _seller,
        address _inspector,
        address _lender
    ) {
        nftAddress = _nftAddress;
        seller = _seller;
        inspector = _inspector;
        lender = _lender;
    }

    function list(
        uint256 _nftID,
        uint256 _purchasePrice,
        uint256 _escrowAmount
    ) public onlySeller {
        // Transfer NFT from seller to this contract
        IERC721(nftAddress).transferFrom(msg.sender, address(this), _nftID);

        isListed[_nftID] = true;
        purchasePrice[_nftID] = _purchasePrice;
        escrowAmount[_nftID] = _escrowAmount;
        buyer[_nftID] = address(0);
        paidAmount[_nftID] = 0; // Reset paid amount
        
        // Explicitly reset all approval statuses
        approval[_nftID][seller] = false;
        approval[_nftID][lender] = false;
        inspectionPassed[_nftID] = false;
        
        emit PropertyListed(_nftID, _purchasePrice, _escrowAmount);
    }

    function depositEarnest(uint256 _nftID) public payable {
        require(isListed[_nftID], "Property not listed");
        require(buyer[_nftID] == address(0) || buyer[_nftID] == msg.sender, "Already under contract");
        require(msg.value >= escrowAmount[_nftID], "Insufficient earnest amount");
        
        // Set the buyer when they deposit earnest money
        buyer[_nftID] = msg.sender;
        
        // Track paid amount
        paidAmount[_nftID] += msg.value;
        
        // Emit event for UI tracking
        emit EarnestDeposited(_nftID, msg.sender, msg.value);
    }

    function updateInspectionStatus(uint256 _nftID, bool _passed) public onlyInspector {
        inspectionPassed[_nftID] = _passed;
        emit InspectionUpdated(_nftID, _passed);
    }

    function fundByLender(uint256 _nftID) public payable {
        require(msg.sender == lender, "Only lender can fund");
        require(isListed[_nftID], "Property not listed");
        require(paidAmount[_nftID] + msg.value <= purchasePrice[_nftID], "Too much funding");

        paidAmount[_nftID] += msg.value;

        emit FundsReceived(_nftID, msg.sender, msg.value);
    }

    function approveSale(uint256 _nftID) public {
        approval[_nftID][msg.sender] = true;
        emit SaleApproved(_nftID, msg.sender);
    }

    function finalizeSale(uint256 _nftID) public {
        require(inspectionPassed[_nftID], "Inspection not passed");
        require(approval[_nftID][buyer[_nftID]], "Buyer has not approved");
        require(approval[_nftID][seller], "Seller has not approved");
        require(approval[_nftID][lender], "Lender has not approved");
        require(paidAmount[_nftID] >= purchasePrice[_nftID], "Insufficient funds for purchase");

        isListed[_nftID] = false;

        uint256 amount = paidAmount[_nftID];
        
        // Reset paid amount
        paidAmount[_nftID] = 0;
        
        // Transfer funds to seller
        (bool success, ) = payable(seller).call{value: amount}("");
        require(success, "Transfer to seller failed");
        
        emit FundsTransferred(_nftID, seller, amount);
        emit SaleFinalized(_nftID, buyer[_nftID], amount);

        // Transfer NFT to buyer
        IERC721(nftAddress).transferFrom(address(this), buyer[_nftID], _nftID);
    }

    function cancelSale(uint256 _nftID) public {
        require(isListed[_nftID], "Property not listed");
        require(msg.sender == buyer[_nftID] || msg.sender == seller, "Only buyer or seller can cancel");
        
        uint256 refundAmount = paidAmount[_nftID];
        address refundRecipient;
        
        if (inspectionPassed[_nftID] == false) {
            refundRecipient = buyer[_nftID];
        } else {
            refundRecipient = seller;
        }
        
        // Reset paid amount
        paidAmount[_nftID] = 0;
        
        // Return NFT to seller if cancelling
        if (buyer[_nftID] != address(0)) {
            IERC721(nftAddress).transferFrom(address(this), seller, _nftID);
        }
        
        // Reset listing
        isListed[_nftID] = false;
        buyer[_nftID] = address(0);
        
        // Transfer funds
        (bool success, ) = payable(refundRecipient).call{value: refundAmount}("");
        require(success, "Refund failed");
        
        emit SaleCancelled(_nftID, refundRecipient, refundAmount);
    }

    // Fallback function to receive ETH
    receive() external payable {
        emit FundsReceived(0, msg.sender, msg.value);
    }

    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }
    
    function getPropertyDetails(uint256 _nftID) public view returns (
        bool listed,
        uint256 price,
        uint256 escrow,
        address currentBuyer,
        bool inspectionStatus,
        uint256 paid
    ) {
        return (
            isListed[_nftID],
            purchasePrice[_nftID],
            escrowAmount[_nftID],
            buyer[_nftID],
            inspectionPassed[_nftID],
            paidAmount[_nftID]
        );
    }
}