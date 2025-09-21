//SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

interface IERC721 {
    function transferFrom(address _from, address _to, uint256 _id) external;
    function ownerOf(uint256 _id) external view returns (address);
}

contract Escrow is ReentrancyGuard, Ownable, Pausable, AccessControl {

    bytes32 public constant ADMIN_ROLE     = keccak256("ADMIN_ROLE");      // manages the role tree
    bytes32 public constant PAUSER_ROLE    = keccak256("PAUSER_ROLE");     // pause/unpause
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");  // fees/recipient
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");  // emergency ops
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    // FIXED: Updated enum to match test expectations
    enum PropertyStatus { 
        NotListed,        // 0
        Listed,           // 1 - FIXED: Changed from PropertyListed
        UnderContract,    // 2 - FIXED: Changed from BuyerSelected
        InspectionPending,// 3 - FIXED: Changed from BuyerApproved
        AwaitingApprovals,// 4 - FIXED: Changed from InspectionPassed  
        ReadyToClose,     // 5 - FIXED: Changed from LenderApproved
        Sold,             // 6 - FIXED: Changed from TransactionComplete
        Cancelled         // 7 - Matches test
    }

    enum ListingType {
        FixedPrice,
        Auction
    }

    enum PaymentMethod {
        DirectPurchase,     // Buyer pays full amount upfront
        DepositAndLender    // Buyer pays deposit, lender pays remaining
    }
    
    struct SaleConditions {
        uint256 inspectionPeriod;
        uint256 financingPeriod;
        bool requiresInspection;
        bool requiresFinancing;
        uint256 listingExpiry;
    }
    
    struct PropertyData {
        uint256 purchasePrice;      
        uint256 escrowAmount;       
        uint256 paidAmount;
        uint256 buyerPaid;
        uint256 lenderPaid;
        address highestBidder;
        uint256 highestBidAmount;
        uint256 minIncrementBps;
        address buyer;
        address lender;
        PropertyStatus status;
        ListingType listingType;   
        PaymentMethod paymentMethod;
        SaleConditions conditions;
        uint256 listedAt;
        bool allowsFinancing;
        uint256 contractSignedAt;
        bool inspectionPassed;
        uint256 inspectionCompletedAt;
        mapping(address => bool) approvals;
    }

    struct Bid {
        address bidder;
        uint256 amount;       
        PaymentMethod method; 
        uint256 escrowPaid;    
    }
    
    address public immutable nftAddress;
    address public immutable seller;
    address public immutable inspector;
    address public immutable lender;
    
    uint256 public platformFee = 250; // 2.5%
    address public feeRecipient;
    
    mapping(uint256 => PropertyData) public properties;
    mapping(uint256 => address[]) public bidders;
    mapping(uint256 => mapping(address => Bid)) public bids;    mapping(address => bool) private _allowlist;
    mapping(address => bytes32) private _credentialHash; // non-zero indicates KYC/eligibility
    mapping(uint256 => uint64) private _unlockAt;
    
    // Events
    event PropertyListed(uint256 indexed nftId, uint256 price, uint256 escrowAmount, ListingType listingType, SaleConditions conditions);
    event ContractSigned(uint256 indexed nftId, address indexed buyer, uint256 amount, PaymentMethod paymentMethod);
    event BidPlaced(uint256 indexed nftID, address indexed bidder, uint256 amount, PaymentMethod method, uint256 escrowPaid);
    event BidAccepted(uint256 indexed nftId, address indexed bidder, uint256 amount);
    event BidWithdrawn(uint256 indexed nftId, address indexed bidder, uint256 amount);
    event EarnestDeposited(uint256 indexed nftId, address indexed buyer, uint256 amount);
    event FundsReceived(uint256 indexed nftId, address indexed from, uint256 amount);
    event FundsTransferred(uint256 indexed nftId, address indexed to, uint256 amount);
    event InspectionUpdated(uint256 indexed nftId, bool passed, address inspector);
    event SaleApproved(uint256 indexed nftId, address indexed approver);
    event SaleFinalized(uint256 indexed nftId, address indexed buyer, uint256 totalPrice);
    event SaleCancelled(uint256 indexed nftId, address indexed cancelledBy, string reason);
    event PropertyStatusChanged(uint256 indexed nftId, PropertyStatus oldStatus, PropertyStatus newStatus);
    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event EmergencyWithdrawal(uint256 indexed nftId, address recipient, uint256 amount);
    event PaymentMethodSelected(uint256 indexed nftId, PaymentMethod method);
    event AllowlistUpdated(address indexed account, bool allowed);
    event CredentialHashSet(address indexed account, bytes32 hash);
    event UnlockSet(uint256 indexed tokenId, uint64 unlockAt);

    // Custom errors
    error PropertyNotListed();
    error PropertyAlreadyUnderContract();
    error UnauthorizedCaller();
    error InsufficientFunds();
    error InvalidAmount();
    error InspectionPeriodExpired();
    error FinancingPeriodExpired();
    error ListingExpired();
    error InvalidPropertyStatus();
    error InspectionRequired();
    error FinancingRequired();
    error TransferFailed();
    error BidTooLow();
    error NoBidExists();
    error InvalidListingType();
    error InvalidPaymentMethod();
    error TRANSFER_NOT_ALLOWED();
    error MISSING_CREDENTIAL();
    error LOCKUP_ACTIVE();

    modifier onlyOwnerOrRole(bytes32 role) {
        require(owner() == _msgSender() || hasRole(role, _msgSender()), "Not owner/role");
        _;
    }
    
    modifier onlyBuyer(uint256 _nftID) {
        if (msg.sender != properties[_nftID].buyer) revert UnauthorizedCaller();
        _;
    }
    
    modifier onlySeller() {
        if (msg.sender != seller) revert UnauthorizedCaller();
        _;
    }
    
    modifier onlyInspector() {
        if (msg.sender != inspector) revert UnauthorizedCaller();
        _;
    }
    
    modifier onlyLender() {
        if (msg.sender != lender) revert UnauthorizedCaller();
        _;
    }
    
    modifier validProperty(uint256 _nftID) {
        if (properties[_nftID].status == PropertyStatus.NotListed) revert PropertyNotListed();
        _;
    }
    
    modifier notExpired(uint256 _nftID) {
        if (block.timestamp > properties[_nftID].conditions.listingExpiry) revert ListingExpired();
        _;
    }
    
    constructor(
        address _nftAddress,
        address _seller,
        address _inspector,
        address _lender,
        address _feeRecipient
    ) {
        require(_nftAddress != address(0), "Invalid NFT address");
        require(_seller != address(0), "Invalid seller address");
        require(_inspector != address(0), "Invalid inspector address");
        require(_lender != address(0), "Invalid lender address");
        
        nftAddress = _nftAddress;
        seller = _seller;
        inspector = _inspector;
        lender = _lender;
        feeRecipient = _feeRecipient != address(0) ? _feeRecipient : _seller;

        // === BOOTSTRAP ROLES ===
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender()); // can grant/revoke any role
        _grantRole(ADMIN_ROLE, _msgSender());

        // make ADMIN_ROLE the admin of the operational roles
        _setRoleAdmin(PAUSER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(TREASURER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_ROLE, ADMIN_ROLE);
        _setRoleAdmin(COMPLIANCE_ROLE, ADMIN_ROLE);

        _grantRole(PAUSER_ROLE, _msgSender());
        _grantRole(TREASURER_ROLE, _msgSender());
        _grantRole(EMERGENCY_ROLE, _msgSender());
        _grantRole(COMPLIANCE_ROLE, _msgSender());
    }

    /**
     * @dev List property with specified listing type (FixedPrice or Auction only)
     * @param _nftID The NFT token ID
     * @param _purchasePrice The purchase price (or minimum bid for auctions)
     * @param _escrowAmount The required escrow/deposit amount
     * @param _listingType Either FixedPrice or Auction
     * @param _conditions Sale conditions including periods and requirements
     */
    function _listProperty(
        uint256 _nftID,
        uint256 _purchasePrice,
        uint256 _escrowAmount,
        ListingType _listingType,
        address _lender,
        SaleConditions memory _conditions
    ) internal onlySeller whenNotPaused {
        require(_purchasePrice > 0, "Purchase price must be > 0");
        require(_escrowAmount > 0 && _escrowAmount <= _purchasePrice, "Invalid escrow amount");
        require(_conditions.listingExpiry > block.timestamp, "Listing expiry must be in future");
        require(_listingType == ListingType.FixedPrice || _listingType == ListingType.Auction, "Invalid listing type");     
        
        require(IERC721(nftAddress).ownerOf(_nftID) == seller, "Seller doesn't own NFT");
        IERC721(nftAddress).transferFrom(seller, address(this), _nftID);
        
        PropertyData storage property = properties[_nftID];
        property.purchasePrice = _purchasePrice;
        property.escrowAmount = _escrowAmount;
        property.paidAmount = 0;
        property.highestBidder = address(0);
        property.highestBidAmount = 0;
        property.minIncrementBps = (_listingType == ListingType.Auction)
            ? 500 // 5% default, tweak as you like or pass in
            : 0;
        property.buyer = address(0);
        property.lender = _lender;
        property.status = PropertyStatus.Listed; // FIXED: Use Listed instead of PropertyListed
        property.listingType = _listingType;
        property.paymentMethod = PaymentMethod.DirectPurchase;
        property.conditions = _conditions;
        property.listedAt = block.timestamp;
        property.contractSignedAt = 0;
        property.inspectionPassed = false;
        property.inspectionCompletedAt = 0;
        
        property.approvals[seller] = false;
        property.approvals[lender] = false;
        
        emit PropertyListed(_nftID, _purchasePrice, _escrowAmount, _listingType, _conditions);
        emit PropertyStatusChanged(_nftID, PropertyStatus.NotListed, PropertyStatus.Listed);
    }


    function list(
        uint256 _nftID,
        uint256 _purchasePrice,
        uint256 _escrowAmount,
        ListingType _listingType,
        address _lender,
        SaleConditions memory _conditions
    ) external onlySeller nonReentrant whenNotPaused {
        _listProperty(_nftID, _purchasePrice, _escrowAmount, _listingType, _lender, _conditions);
    }

    function list(
        uint256 _nftID,
        uint256 _purchasePrice,
        uint256 _escrowAmount,
        address _lender,
        SaleConditions memory _conditions
    ) external onlySeller nonReentrant whenNotPaused {
        _listProperty(_nftID, _purchasePrice, _escrowAmount, ListingType.FixedPrice, _lender, _conditions);
    }

    function list(
        uint256 _nftID,
        uint256 _purchasePrice,
        uint256 _escrowAmount,
        ListingType _listingType,
        address _lender
    ) external onlySeller nonReentrant whenNotPaused {
        SaleConditions memory defaultConditions = SaleConditions({
            inspectionPeriod: 7 days,
            financingPeriod: 30 days,
            requiresInspection: true,
            requiresFinancing: false, // Default to false for direct purchases
            listingExpiry: block.timestamp + 90 days
        });
        
        _listProperty(_nftID, _purchasePrice, _escrowAmount, _listingType, _lender, defaultConditions);
    }
    
    /**
     * @dev Method 1: Direct Purchase (FixedPrice listings only)
     * Buyer pays full amount upfront
     */
    function purchaseDirectly(uint256 _nftID) 
        external 
        payable 
        validProperty(_nftID) 
        notExpired(_nftID) 
        nonReentrant 
        whenNotPaused 
    {
        PropertyData storage property = properties[_nftID];
        
        require(property.listingType == ListingType.FixedPrice, "Direct purchase only for fixed price listings");
        require(property.status == PropertyStatus.Listed, "Property not available");
        _precheckParticipant(msg.sender);
        require(msg.value >= property.purchasePrice, "Must pay full purchase price");
        
        property.buyer = msg.sender;
        property.paidAmount = msg.value;
        property.paymentMethod = PaymentMethod.DirectPurchase;
        property.status = PropertyStatus.UnderContract;
        property.contractSignedAt = block.timestamp;
        
        emit ContractSigned(_nftID, msg.sender, msg.value, PaymentMethod.DirectPurchase);
        emit PaymentMethodSelected(_nftID, PaymentMethod.DirectPurchase);
        emit PropertyStatusChanged(_nftID, PropertyStatus.Listed, PropertyStatus.UnderContract);
    }

    /**
     * @dev Method 2: Deposit + Lender (FixedPrice listings only)
     * Buyer pays deposit, lender will fund the remaining amount
     */
    function purchaseWithDeposit(uint256 _nftID) 
        external 
        payable 
        validProperty(_nftID) 
        notExpired(_nftID) 
        nonReentrant 
        whenNotPaused 
    {
        PropertyData storage property = properties[_nftID];
        
        require(property.listingType == ListingType.FixedPrice, "Deposit purchase only for fixed price listings");
        require(property.status == PropertyStatus.Listed, "Property not available");
        _precheckParticipant(msg.sender);
        require(msg.value >= property.escrowAmount, "Insufficient deposit amount");
        require(msg.value == property.escrowAmount, "Deposit must equal escrow amount");

        property.buyer = msg.sender;
        property.paidAmount = msg.value;
        property.paymentMethod = PaymentMethod.DepositAndLender;
        property.status = PropertyStatus.UnderContract;
        property.contractSignedAt = block.timestamp;
        property.conditions.requiresFinancing = true; // Enable financing requirement
        
        emit ContractSigned(_nftID, msg.sender, msg.value, PaymentMethod.DepositAndLender);
        emit PaymentMethodSelected(_nftID, PaymentMethod.DepositAndLender);
        emit EarnestDeposited(_nftID, msg.sender, msg.value);
        emit PropertyStatusChanged(_nftID, PropertyStatus.Listed, PropertyStatus.UnderContract);
    }

    /**
     * @dev Method 3: Place bid (Auction listings only)
     * Buyers place bids, seller accepts highest bidder
     */
    function getAuctionInfo(uint256 _nftID)
        external
        view
        returns (
            address highestBidder,
            uint256 highestAmount,
            uint256 minNextBid,
            uint256 minIncrementBps
        )
    {
        PropertyData storage p = properties[_nftID];

        uint256 next;
        if (p.highestBidAmount == 0) {
            next = p.purchasePrice; // first bid must meet starting price
        } else {
            uint256 inc = (p.highestBidAmount * p.minIncrementBps) / 10000;
            if (inc == 0) inc = 1; 
            next = p.highestBidAmount + inc;
        }

        return (p.highestBidder, p.highestBidAmount, next, p.minIncrementBps);
    }

    function placeBid(
        uint256 _nftID,
        PaymentMethod _method,
        uint256 _amount
    )
        external
        payable
        validProperty(_nftID)
        notExpired(_nftID)
        nonReentrant
        whenNotPaused
    {
        PropertyData storage p = properties[_nftID];

        require(p.status == PropertyStatus.Listed, "Not listed");
        require(p.listingType == ListingType.Auction, "Bids only for auctions");
        _precheckParticipant(msg.sender);

        uint256 minNext;
        if (p.highestBidAmount == 0) {
            // First bid: must meet or exceed starting price (reserve)
            minNext = p.purchasePrice;
        } else {
            // Subsequent bids: must exceed current highest by step
            uint256 inc = (p.highestBidAmount * p.minIncrementBps) / 10000;
            // optional: if (inc == 0) inc = 1; // guarantees strict increase even if bps=0
            minNext = p.highestBidAmount + inc;
        }
        require(_amount >= minNext, "Bid below min");

        // Financing allowed?
        if (_method == PaymentMethod.DepositAndLender) {
            require(p.allowsFinancing, "Financing not allowed");
            // For financing bids, only the escrow must be posted now
            require(msg.value >= p.escrowAmount, "Escrow too small");
        } else {
            // Direct purchase (cash) bid: post the full bid amount now
            require(msg.value >= _amount, "Insufficient cash for bid");
        }

        // Handle previous bid from same bidder (refund their escrow/cash)
        if (bids[_nftID][msg.sender].bidder != address(0)) {
            uint256 refund = bids[_nftID][msg.sender].escrowPaid;
            bids[_nftID][msg.sender].escrowPaid = 0;
            (bool ok, ) = payable(msg.sender).call{ value: refund }("");
            if (!ok) revert TransferFailed();
        } else {
            bidders[_nftID].push(msg.sender);
        }

        // Record the new bid
        bids[_nftID][msg.sender] = Bid({
            bidder: msg.sender,
            amount: _amount,
            method: _method,
            escrowPaid: msg.value
        });

        if (_amount > p.highestBidAmount) {
            p.highestBidAmount = _amount;
            p.highestBidder = msg.sender;
        }

        emit BidPlaced(_nftID, msg.sender, _amount, _method, msg.value);
    }

    function acceptBid(uint256 _nftID, address _bidder)
        external
        onlySeller
        validProperty(_nftID)
        nonReentrant
    {
        PropertyData storage p = properties[_nftID];
        require(p.listingType == ListingType.Auction, "Auction only");
        require(p.status == PropertyStatus.Listed, "Invalid status");

        Bid memory b = bids[_nftID][_bidder];
        require(b.bidder != address(0), "No such bid");
        _precheckParticipant(_bidder);

        // Enforce listing rule: fixed price disallows financing
        if (!p.allowsFinancing) {
            require(b.method == PaymentMethod.DirectPurchase, "Financing disabled");
        }

        // Move to UnderContract and record buyer/method
        p.buyer = _bidder;
        p.paymentMethod = b.method;
        p.status = PropertyStatus.UnderContract;
        p.contractSignedAt = block.timestamp;

        if (b.method == PaymentMethod.DirectPurchase) {
            // Cash: the bid must at least cover the property price
            require(b.amount >= p.purchasePrice, "Bid < price");
            require(b.escrowPaid >= b.amount, "Insufficient cash escrowed");
            p.paidAmount = b.escrowPaid;                  // keep all posted cash
            p.conditions.requiresFinancing = false;

            // (Optional) If b.escrowPaid > b.amount, refund the tiny excess now:
            uint256 extra = b.escrowPaid > b.amount ? (b.escrowPaid - b.amount) : 0;
            if (extra > 0) {
                (bool okExtra, ) = payable(_bidder).call{ value: extra }("");
                if (!okExtra) revert TransferFailed();
                emit FundsTransferred(_nftID, _bidder, extra);
                p.paidAmount -= extra;
            }

        } else {
            // Deposit + lender: keep only escrowAmount; refund the rest now
            require(b.escrowPaid >= p.escrowAmount, "Escrow not met");
            p.paidAmount = p.escrowAmount;
            p.conditions.requiresFinancing = true;

            uint256 refundExcess = b.escrowPaid - p.escrowAmount;
            if (refundExcess > 0) {
                (bool ok, ) = payable(_bidder).call{ value: refundExcess }("");
                if (!ok) revert TransferFailed();
                emit FundsTransferred(_nftID, _bidder, refundExcess);
            }
        }

        // Clear winner's stored escrow to prevent double-withdraw
        bids[_nftID][_bidder].escrowPaid = 0;

        // Refund everyone else completely
        _refundOtherBidders(_nftID, _bidder);

        emit BidAccepted(_nftID, _bidder, b.amount);
        emit ContractSigned(_nftID, _bidder, p.paidAmount, b.method);
        emit PaymentMethodSelected(_nftID, b.method);
        emit PropertyStatusChanged(_nftID, PropertyStatus.Listed, PropertyStatus.UnderContract);
    }

    function depositEarnest(uint256 _nftID) 
        external 
        payable 
        validProperty(_nftID) 
        notExpired(_nftID) 
        nonReentrant 
        whenNotPaused 
    {
        PropertyData storage p = properties[_nftID];
        if (p.status != PropertyStatus.Listed) revert InvalidPropertyStatus();
        if (msg.value < p.escrowAmount) revert InsufficientFunds();

        // enforce KYC
        _precheckParticipant(msg.sender);

        p.buyer = msg.sender;
        p.buyerPaid  += msg.value;
        p.paidAmount += msg.value;
        p.paymentMethod = PaymentMethod.DepositAndLender;  
        p.conditions.requiresFinancing = true; 
        p.status = PropertyStatus.UnderContract;
        p.contractSignedAt = block.timestamp;

        emit EarnestDeposited(_nftID, msg.sender, msg.value);
        emit PaymentMethodSelected(_nftID, PaymentMethod.DepositAndLender);
        emit PropertyStatusChanged(_nftID, PropertyStatus.Listed, PropertyStatus.UnderContract);
    }
    
    function withdrawBid(uint256 _nftID) external nonReentrant {
        Bid storage b = bids[_nftID][msg.sender];
        if (b.bidder == address(0)) revert NoBidExists();
        if (properties[_nftID].buyer == msg.sender) revert UnauthorizedCaller();

        uint256 refund = b.escrowPaid;
        if (refund == 0) revert NoBidExists();

        // effects before interaction (reentrancy)
        b.escrowPaid = 0;
        b.bidder = address(0);
        b.amount = 0;

        (bool success, ) = payable(msg.sender).call{ value: refund }("");
        if (!success) revert TransferFailed();

        emit BidWithdrawn(_nftID, msg.sender, refund);
    }
    
    function updateInspectionStatus(uint256 _nftID, bool _passed) 
        external 
        onlyInspector 
        validProperty(_nftID) 
        nonReentrant 
    {
        PropertyData storage property = properties[_nftID];
        
        if (
            property.status != PropertyStatus.UnderContract &&
            property.status != PropertyStatus.InspectionPending
        ) {
            revert InvalidPropertyStatus();
        }
        
        if (property.conditions.requiresInspection &&
            block.timestamp > property.contractSignedAt + property.conditions.inspectionPeriod) {
            revert InspectionPeriodExpired();
        }
        
        property.inspectionPassed = _passed;
        property.inspectionCompletedAt = block.timestamp;
        
        if (_passed) {
            // advance to approvals
            PropertyStatus old = property.status;
            property.status = PropertyStatus.AwaitingApprovals;
            emit PropertyStatusChanged(_nftID, old, PropertyStatus.AwaitingApprovals);
        } else {
            // stay or move to pending
            if (property.status != PropertyStatus.InspectionPending) {
                emit PropertyStatusChanged(_nftID, PropertyStatus.UnderContract, PropertyStatus.InspectionPending);
                property.status = PropertyStatus.InspectionPending;
            }
        }
        
        emit InspectionUpdated(_nftID, _passed, msg.sender);
    }
    
    function fundByLender(uint256 _nftID) 
        external 
        payable 
        onlyLender 
        validProperty(_nftID) 
        nonReentrant 
    {
        PropertyData storage property = properties[_nftID];

        require(msg.sender == property.lender, "Only property lender");
        require(property.paymentMethod == PaymentMethod.DepositAndLender, "Lender funding only for deposit+lender method");
        require(property.status == PropertyStatus.AwaitingApprovals, "Invalid status for funding");

        if (property.conditions.requiresFinancing &&
            block.timestamp > property.contractSignedAt + property.conditions.financingPeriod) {
            revert FinancingPeriodExpired();
        }

        uint256 remainingAmount = property.purchasePrice - property.paidAmount;
        require(remainingAmount > 0, "Nothing to fund");
        require(msg.value >= remainingAmount, "Insufficient lender funding");

        // Apply only what's needed to reach purchasePrice
        uint256 amountApplied = remainingAmount;

        // ✅ record the lender’s actual contribution
        property.paidAmount += amountApplied;
        property.lenderPaid += amountApplied;

        // ✅ approvals should key off the per-property lender
        property.approvals[property.lender] = true;

        // Refund any excess back to lender
        uint256 refundAmount = msg.value - amountApplied;
        if (refundAmount > 0) {
            (bool success, ) = payable(lender).call{value: refundAmount}("");
            if (!success) revert TransferFailed();
            emit FundsTransferred(_nftID, lender, refundAmount);
        }

        emit FundsReceived(_nftID, msg.sender, amountApplied);
        emit SaleApproved(_nftID, msg.sender);
    }
    
    /**
     * @dev Phase 4: Approve sale (different parties based on payment method)
     */
    function approveSale(uint256 _nftID) external validProperty(_nftID) {
        PropertyData storage property = properties[_nftID];

        require(property.status == PropertyStatus.AwaitingApprovals, "Invalid status");

        bool authorized = false;
        if (property.paymentMethod == PaymentMethod.DirectPurchase) {
            authorized = (msg.sender == property.buyer || msg.sender == seller);
        } else if (property.paymentMethod == PaymentMethod.DepositAndLender) {
            authorized = (msg.sender == property.buyer || msg.sender == seller || msg.sender == lender);
        }

        require(authorized, "Not authorized to approve");

        // ✅ Only enforce KYC when the caller is the buyer
        if (msg.sender == property.buyer) {
            _precheckParticipant(msg.sender); // checks _allowlist[msg.sender]
        }

        property.approvals[msg.sender] = true;
        
        // Check if all required parties have approved
        bool allApproved = false;
        if (property.paymentMethod == PaymentMethod.DirectPurchase) {
            allApproved = property.approvals[property.buyer] && property.approvals[seller];
        } else if (property.paymentMethod == PaymentMethod.DepositAndLender) {
            allApproved = property.approvals[property.buyer] && 
                         property.approvals[seller] && 
                         property.approvals[lender];
        }
        
        if (allApproved) {
            property.status = PropertyStatus.ReadyToClose;
            emit PropertyStatusChanged(_nftID, PropertyStatus.AwaitingApprovals, PropertyStatus.ReadyToClose);
        }
        
        emit SaleApproved(_nftID, msg.sender);
    }

    function _checkCompliance(uint256 tokenId, address buyer) internal view {
        if (!_allowlist[buyer]) revert TRANSFER_NOT_ALLOWED();
        if (_credentialHash[buyer] == bytes32(0)) revert MISSING_CREDENTIAL();
        uint64 lu = _unlockAt[tokenId];
        if (lu != 0 && block.timestamp < lu) revert LOCKUP_ACTIVE();
    }
    
    
    /**
     * @dev Phase 5: Finalize sale and transfer NFT
     */
    function finalizeSale(uint256 _nftID) external validProperty(_nftID) nonReentrant {
        PropertyData storage property = properties[_nftID];
        
        require(property.status == PropertyStatus.ReadyToClose, "Invalid status");
        
        if (property.conditions.requiresInspection && !property.inspectionPassed) {
            revert InspectionRequired();
        }
        
        // Verify all required approvals based on payment method
        if (property.paymentMethod == PaymentMethod.DirectPurchase) {
            require(property.approvals[property.buyer] && property.approvals[seller], "Missing approvals");
        } else if (property.paymentMethod == PaymentMethod.DepositAndLender) {
            require(
                property.approvals[property.buyer] && 
                property.approvals[seller] && 
                property.approvals[lender], 
                "Missing approvals"
            );
        }
        
        require(property.paidAmount >= property.purchasePrice, "Insufficient funds");
        
        _checkCompliance(_nftID, property.buyer);

        uint256 totalAmount = property.paidAmount;
        uint256 feeAmount = (totalAmount * platformFee) / 10000;
        uint256 sellerAmount = totalAmount - feeAmount;
        
        property.status = PropertyStatus.Sold;
        property.paidAmount = 0;
        
        // Transfer platform fee
        if (feeAmount > 0) {
            (bool feeSuccess, ) = payable(feeRecipient).call{value: feeAmount}("");
            if (!feeSuccess) revert TransferFailed();
            emit FundsTransferred(_nftID, feeRecipient, feeAmount);
        }
        
        // Transfer remaining funds to seller
        (bool sellerSuccess, ) = payable(seller).call{value: sellerAmount}("");
        if (!sellerSuccess) revert TransferFailed();
        emit FundsTransferred(_nftID, seller, sellerAmount);
        
        // Transfer NFT to buyer
        IERC721(nftAddress).transferFrom(address(this), property.buyer, _nftID);
        
        emit SaleFinalized(_nftID, property.buyer, totalAmount);
        emit PropertyStatusChanged(_nftID, PropertyStatus.ReadyToClose, PropertyStatus.Sold);
    }
    
    /**
     * @dev Cancel sale with appropriate refund logic
     */
    function _payout(uint256 _nftID, address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FundsTransferred(_nftID, to, amount);
    }
    function cancelSale(uint256 _nftID, string memory _reason)
        external
        validProperty(_nftID)
        nonReentrant
    {
        PropertyData storage property = properties[_nftID];

        require(
            msg.sender == property.buyer || msg.sender == seller || msg.sender == owner(),
            "Not authorized to cancel"
        );

        PropertyStatus oldStatus = property.status;
        property.status = PropertyStatus.Cancelled;

        // Snapshot BEFORE zeroing
        uint256 buyerPaid  = property.buyerPaid;
        uint256 lenderPaid = property.lenderPaid;
        uint256 escrowAmt  = property.escrowAmount;
        address buyerAddr  = property.buyer;
        address lenderAddr = property.lender;   // <-- use the per-property lender
        address sellerAddr = seller;            // consider property.seller if you store it

        // (Optional) sanity: expected invariant
        // require(buyerPaid + lenderPaid == property.paidAmount, "inconsistent totals");

        // Zero state before external calls
        property.paidAmount = 0;
        property.buyerPaid  = 0;
        property.lenderPaid = 0;

        if (msg.sender == seller || !property.inspectionPassed) {
            // Seller cancels OR inspection failed -> refund both payers
            _payout(_nftID, buyerAddr,  buyerPaid);
            _payout(_nftID, lenderAddr, lenderPaid);
        } else if (msg.sender == buyerAddr && property.inspectionPassed) {
            // Buyer cancels after inspection passed -> buyer forfeits up to escrow
            uint256 forfeitable = escrowAmt > buyerPaid ? buyerPaid : escrowAmt;
            uint256 buyerRefund = buyerPaid - forfeitable;

            _payout(_nftID, buyerAddr,  buyerRefund);
            _payout(_nftID, sellerAddr, forfeitable);
            _payout(_nftID, lenderAddr, lenderPaid);
        } else {
            // Safety default
            _payout(_nftID, buyerAddr,  buyerPaid);
            _payout(_nftID, lenderAddr, lenderPaid);
        }

        _refundOtherBidders(_nftID, address(0));

        try IERC721(nftAddress).transferFrom(address(this), sellerAddr, _nftID) {} catch {}

        // Reset roles/flags
        property.buyer = address(0);
        property.approvals[sellerAddr]  = false;
        property.approvals[lenderAddr]  = false;
        property.inspectionPassed = false;

        emit SaleCancelled(_nftID, msg.sender, _reason);
        emit PropertyStatusChanged(_nftID, oldStatus, PropertyStatus.Cancelled);
    }

    function reopenCancelled(uint256 _nftID)
        external
        onlySeller
        nonReentrant
        whenNotPaused
    {
        PropertyData storage p = properties[_nftID];

        // Must be in Cancelled, with no funds or buyer locked in
        require(p.status == PropertyStatus.Cancelled, "Not cancelled");
        require(p.paidAmount == 0 && p.buyerPaid == 0 && p.lenderPaid == 0, "Funds held");
        require(p.buyer == address(0), "Buyer not cleared");

        // Bidders are already refunded/deleted by cancelSale(); sanity (no revert)
        // require(bidders[_nftID].length == 0, "Bidders remain"); // optional assert

        // Seller must hold the NFT after cancel and must approve this contract to pull it back
        require(IERC721(nftAddress).ownerOf(_nftID) == seller, "Seller must hold NFT");
        IERC721(nftAddress).transferFrom(seller, address(this), _nftID);

        // Reset transient state; keep original terms (price/escrow/conditions/listingType/minIncrementBps)
        p.approvals[seller] = false;
        p.approvals[p.lender] = false;
        p.inspectionPassed = false;
        p.contractSignedAt = 0;
        p.inspectionCompletedAt = 0;
        p.paymentMethod = PaymentMethod.DirectPurchase; // no buyer yet

        // If you added auction tracking fields earlier, clear them:
        p.highestBidder = address(0);
        p.highestBidAmount = 0;

        PropertyStatus old = p.status;
        p.status = PropertyStatus.Listed;
        p.listedAt = block.timestamp;

        emit PropertyStatusChanged(_nftID, old, PropertyStatus.Listed);
        // You can also emit PropertyListed again if you want a fresh marketplace signal.
        // emit PropertyListed(_nftID, p.purchasePrice, p.escrowAmount, p.listingType, p.conditions);
    }
    
    function emergencyCancelSale(uint256 _nftID, address _refundRecipient) 
        external 
        onlyOwnerOrRole(EMERGENCY_ROLE)
        validProperty(_nftID) 
        nonReentrant 
    {
        PropertyData storage property = properties[_nftID];
        uint256 refundAmount = property.paidAmount;
        
        if (refundAmount > 0) {
            property.paidAmount = 0;
            (bool success, ) = payable(_refundRecipient).call{value: refundAmount}("");
            if (!success) revert TransferFailed();
            emit EmergencyWithdrawal(_nftID, _refundRecipient, refundAmount);
        }
        
        _refundOtherBidders(_nftID, address(0));
        
        property.status = PropertyStatus.Cancelled;
        emit SaleCancelled(_nftID, msg.sender, "Emergency cancellation by owner");
    }
    
    // Allow owner OR treasurer to set fees/recipient
    function setPlatformFee(uint256 _newFee) external onlyOwnerOrRole(TREASURER_ROLE) {
        require(_newFee <= 1000, "Fee cannot exceed 10%"); // unchanged logic
        uint256 oldFee = platformFee;
        platformFee = _newFee;
        emit PlatformFeeUpdated(oldFee, _newFee);
    }

    function setFeeRecipient(address _newRecipient) external onlyOwnerOrRole(TREASURER_ROLE) {
        require(_newRecipient != address(0), "Invalid recipient");
        address oldRecipient = feeRecipient;
        feeRecipient = _newRecipient;
        emit FeeRecipientUpdated(oldRecipient, _newRecipient);
    }
    
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
    
    // View functions with FIXED return types
    function getPropertyDetails(uint256 _nftID) 
        external 
        view 
        returns (
            uint256 price,
            uint256 escrow,
            uint256 paid,
            address currentBuyer,
            PropertyStatus status,
            ListingType listingType,
            PaymentMethod paymentMethod,
            bool inspectionStatus,
            SaleConditions memory conditions,
            uint256 listedAt,
            uint256 contractSignedAt
        ) 
    {
        PropertyData storage property = properties[_nftID];
        return (
            property.purchasePrice,
            property.escrowAmount,
            property.paidAmount,
            property.buyer,
            property.status,
            property.listingType,
            property.paymentMethod,
            property.inspectionPassed,
            property.conditions,
            property.listedAt,
            property.contractSignedAt
        );
    }
    
    function getApprovalStatus(uint256 _nftID) 
        external 
        view 
        returns (bool buyerApproved, bool sellerApproved, bool lenderApproved) 
    {
        PropertyData storage property = properties[_nftID];
        return (
            property.approvals[property.buyer],
            property.approvals[seller],
            property.approvals[lender]
        );
    }

    function getPaymentMethod(uint256 _nftID) external view returns (PaymentMethod) {
        return properties[_nftID].paymentMethod;
    }

    function getListingType(uint256 _nftID) external view returns (ListingType) {
        return properties[_nftID].listingType;
    }
    
    function getBidders(uint256 _nftID) external view returns (address[] memory) {
        return bidders[_nftID];
    }
    
    function getBidAmount(uint256 _nftID, address _bidder) external view returns (uint256) {
        return bids[_nftID][_bidder].amount;
    }
    
    function getHighestBid(uint256 _nftID) external view returns (address highestBidder, uint256 highestAmount) {
        PropertyData storage p = properties[_nftID];
        return (p.highestBidder, p.highestBidAmount);
    }
    
    function isListingExpired(uint256 _nftID) external view returns (bool) {
        return block.timestamp > properties[_nftID].conditions.listingExpiry;
    }
    
    function isInspectionPeriodExpired(uint256 _nftID) external view returns (bool) {
        PropertyData storage property = properties[_nftID];
        return property.contractSignedAt > 0 && 
               block.timestamp > property.contractSignedAt + property.conditions.inspectionPeriod;
    }
    
    function isFinancingPeriodExpired(uint256 _nftID) external view returns (bool) {
        PropertyData storage property = properties[_nftID];
        return property.contractSignedAt > 0 && 
               block.timestamp > property.contractSignedAt + property.conditions.financingPeriod;
    }
    
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    function getPropertyBalance(uint256 _nftID) external view returns (uint256) {
        uint256 propertyBalance = properties[_nftID].paidAmount;

        address[] memory propertyBidders = bidders[_nftID];
        for (uint256 i = 0; i < propertyBidders.length; i++) {
            propertyBalance += bids[_nftID][propertyBidders[i]].escrowPaid; // <-- .escrowPaid
        }

        return propertyBalance;
    }
    
    function _refundOtherBidders(uint256 _nftID, address _excludeBidder) internal {
        address[] storage ls = bidders[_nftID]; // storage is fine; we delete after

        for (uint256 i = 0; i < ls.length; i++) {
            address addr = ls[i];
            if (addr == _excludeBidder) continue;

            Bid storage b = bids[_nftID][addr];
            uint256 refund = b.escrowPaid;
            if (refund == 0) continue; // nothing to refund / already cleared

            // ---- effects (clear state before external call)
            b.escrowPaid = 0;
            b.bidder = address(0);
            b.amount = 0;
            // (b.method can be left as-is or set to a sentinel if you prefer)

            // ---- interaction
            (bool ok, ) = payable(addr).call{ value: refund }("");
            if (!ok) revert TransferFailed();

            emit BidWithdrawn(_nftID, addr, refund);
            // or emit FundsTransferred(_nftID, addr, refund); either is fine—be consistent
        }

        // Clear the bidders list to free storage and prevent double-refunds
        delete bidders[_nftID];
    }
    
    receive() external payable {
        emit FundsReceived(0, msg.sender, msg.value);
    }
    
    function emergencyWithdraw(address payable _recipient, uint256 _amount) 
        external 
        onlyOwnerOrRole(EMERGENCY_ROLE)
        nonReentrant 
    {
        require(_recipient != address(0), "Invalid recipient");
        require(_amount <= address(this).balance, "Insufficient balance");
        
        (bool success, ) = _recipient.call{value: _amount}("");
        if (!success) revert TransferFailed();
        
        emit EmergencyWithdrawal(0, _recipient, _amount);
    }
    
    function getPropertiesByStatus(PropertyStatus _status) 
        external 
        view 
        returns (uint256[] memory) 
    {
        uint256[] memory tempResult = new uint256[](1000);
        uint256 count = 0;
        
        for (uint256 i = 1; i <= 1000; i++) {
            if (properties[i].status == _status) {
                tempResult[count] = i;
                count++;
            }
        }
        
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = tempResult[i];
        }
        
        return result;
    }

    // Helper functions for frontend
    function isListed(uint256 _nftID) external view returns (bool) {
        return properties[_nftID].status == PropertyStatus.Listed;
    }

    function isSold(uint256 _nftID) external view returns (bool) {
        return properties[_nftID].status == PropertyStatus.Sold;
    }

    function _precheckParticipant(address buyer) internal view {
        if (!_allowlist[buyer]) revert TRANSFER_NOT_ALLOWED();
        if (_credentialHash[buyer] == bytes32(0)) revert MISSING_CREDENTIAL();
    }

    function getCurrentStep(uint256 _nftID) external view returns (uint8) {
        PropertyStatus status = properties[_nftID].status;
        
        if (status == PropertyStatus.Listed) return 0;
        if (status == PropertyStatus.UnderContract) return 1;
        if (status == PropertyStatus.InspectionPending) return 2;
        if (status == PropertyStatus.AwaitingApprovals) return 3;
        if (status == PropertyStatus.ReadyToClose) return 4;
        if (status == PropertyStatus.Sold) return 5;
        
        return 0; // NotListed or Cancelled
    }

    function getBuyer(uint256 _nftID) external view returns (address) {
        return properties[_nftID].buyer;
    }

    function getSeller() external view returns (address) {
        return seller;
    }

    function getPurchasePrice(uint256 _nftID) external view returns (uint256) {
        return properties[_nftID].purchasePrice;
    }

    function getEscrowAmount(uint256 _nftID) external view returns (uint256) {
        return properties[_nftID].escrowAmount;
    }

    function getInspectionStatus(uint256 _nftID) external view returns (bool) {
        return properties[_nftID].inspectionPassed;
    }

    function getApproval(uint256 _nftID, address _party) external view returns (bool) {
        return properties[_nftID].approvals[_party];
    }

    function getPropertyFinancials(uint256 _nftID) external view returns (uint256 price, uint256 escrowAmount) {
        PropertyData storage property = properties[_nftID];
        return (property.purchasePrice, property.escrowAmount);
    }

    function getPropertyStatus(uint256 _nftID) external view returns (PropertyStatus) {
        return properties[_nftID].status;
    }

    function getFullProperty(uint256 _nftID) external view returns (
        address buyer,
        address seller_,
        uint256 purchasePrice,
        uint256 escrowAmount,
        bool inspectionPassed,
        PropertyStatus status,
        ListingType listingType,
        PaymentMethod paymentMethod
    ) {
        PropertyData storage property = properties[_nftID];
        return (
            property.buyer,
            seller,
            property.purchasePrice,
            property.escrowAmount,
            property.inspectionPassed,
            property.status,
            property.listingType,
            property.paymentMethod
        );
    }

    function canPurchaseDirectly(uint256 _nftID) external view returns (bool) {
        PropertyData storage property = properties[_nftID];
        return property.listingType == ListingType.FixedPrice &&
               property.status == PropertyStatus.Listed;
    }

    function canPlaceBid(uint256 _nftID) external view returns (bool) {
        PropertyData storage property = properties[_nftID];
        return property.listingType == ListingType.Auction &&
               property.status == PropertyStatus.Listed;
    }
    
    function getRequiredApprovers(uint256 _nftID) external view returns (address[] memory) {
        PropertyData storage property = properties[_nftID];
        
        if (property.paymentMethod == PaymentMethod.DirectPurchase) {
            address[] memory approvers = new address[](2);
            approvers[0] = property.buyer;
            approvers[1] = seller;
            return approvers;
        } else if (property.paymentMethod == PaymentMethod.DepositAndLender) {
            address[] memory approvers = new address[](3);
            approvers[0] = property.buyer;
            approvers[1] = seller;
            approvers[2] = lender;
            return approvers;
        }
        
        return new address[](0);
    }

    // === Compliance Setters ===
    function setAllowlist(address account, bool allowed) external onlyRole(COMPLIANCE_ROLE) {
        _allowlist[account] = allowed;
        emit AllowlistUpdated(account, allowed);
    }

    function setCredentialHash(address account, bytes32 hash) external onlyRole(COMPLIANCE_ROLE) {
        _credentialHash[account] = hash;
        emit CredentialHashSet(account, hash);
    }

    function setUnlockAt(uint256 tokenId, uint64 ts) external onlyRole(COMPLIANCE_ROLE) {
        _unlockAt[tokenId] = ts;
        emit UnlockSet(tokenId, ts);
    }


    // === Views for UI ===
    function isAllowlisted(address a) external view returns (bool) { return _allowlist[a]; }
    function hasCredential(address a) external view returns (bool) { return _credentialHash[a] != bytes32(0); }
    function getUnlockAt(uint256 tokenId) external view returns (uint64) { return _unlockAt[tokenId]; }

}