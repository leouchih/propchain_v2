//SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract RealEstate is ERC721URIStorage, ERC721Enumerable, Ownable, ReentrancyGuard, Pausable, AccessControl {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    bytes32 public constant ADMIN_ROLE    = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant METADATA_ROLE = keccak256("METADATA_ROLE");
    
    // Property metadata structure
    struct PropertyInfo {
        string propertyType;    // e.g., "residential", "commercial", "land"
        uint256 squareFootage;
        string location;        // City, State format
        uint256 yearBuilt;
        uint256 bedrooms;
        uint256 bathrooms;
        bool isActive;
        uint256 createdAt;
    }
    
    // Mappings
    mapping(uint256 => PropertyInfo) public propertyInfo;
    mapping(address => bool) public authorizedMinters;
    mapping(string => bool) private usedTokenURIs;
    
    // Events
    event PropertyMinted(address indexed minter, uint256 indexed tokenId, string uri, PropertyInfo propertyData);
    event PropertyInfoUpdated(uint256 indexed tokenId, PropertyInfo propertyData);
    event MinterAuthorized(address indexed minter);
    event MinterRevoked(address indexed minter);
    event BaseURIUpdated(string newBaseURI);
    
    // Custom errors for gas efficiency
    error EmptyTokenURI();
    error TokenURIAlreadyUsed();
    error UnauthorizedMinter();
    error InvalidPropertyInfo();
    error PropertyNotExists();
    error PropertyInactive();
    
    string private _baseTokenURI;
    
    constructor() ERC721("Enhanced Real Estate", "EREAL") {
        // Default admin & convenience roles to deployer (owner)
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());
        _grantRole(MINTER_ROLE, _msgSender());
        _grantRole(METADATA_ROLE, _msgSender());

        // (optional) configure role admins
        _setRoleAdmin(MINTER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(METADATA_ROLE, ADMIN_ROLE);
    }
    
    modifier onlyAuthorizedMinter() {
        if (!hasRole(MINTER_ROLE, _msgSender())) revert UnauthorizedMinter();
        _;
    }

    modifier onlyAdminOrOwner() {
        require(owner() == _msgSender() || hasRole(ADMIN_ROLE, _msgSender()), "Not admin/owner");
        _;
    }
    
    modifier tokenExists(uint256 tokenId) {
        if (!_exists(tokenId)) revert PropertyNotExists();
        _;
    }
    
    /**
     * @dev Enhanced mint function with property metadata
     */
    function mint(
        address to,
        string memory uri,
        PropertyInfo memory propertyData
    ) public onlyAuthorizedMinter whenNotPaused returns (uint256) {
        if (bytes(uri).length == 0) revert EmptyTokenURI();
        if (usedTokenURIs[uri]) revert TokenURIAlreadyUsed();
        if (!isValidPropertyInfo(propertyData)) revert InvalidPropertyInfo();
        
        _tokenIds.increment();
        uint256 newItemId = _tokenIds.current();
        
        // Mark URI as used
        usedTokenURIs[uri] = true;
        
        // Store property information
        propertyData.isActive = true;
        propertyData.createdAt = block.timestamp;
        propertyInfo[newItemId] = propertyData;
        
        // Mint the token
        _mint(to, newItemId);
        _setTokenURI(newItemId, uri);
        
        emit PropertyMinted(to, newItemId, uri, propertyData);
        
        return newItemId;
    }
    
    /**
     * @dev Simplified mint function for backward compatibility
     */
    function mint(string memory uri) public onlyAuthorizedMinter whenNotPaused returns (uint256) {
        PropertyInfo memory defaultProperty = PropertyInfo({
            propertyType: "residential",
            squareFootage: 0,
            location: "Unknown",
            yearBuilt: 0,
            bedrooms: 0,
            bathrooms: 0,
            isActive: true,
            createdAt: block.timestamp
        });
        
        return mint(msg.sender, uri, defaultProperty);
    }
    
    /**
     * @dev Batch mint multiple properties
     * (still safe to keep nonReentrant if you want)
     */
    function batchMint(
        address[] memory recipients,
        string[] memory uris,
        PropertyInfo[] memory propertyDataArray
    ) external onlyAuthorizedMinter nonReentrant whenNotPaused returns (uint256[] memory) {
        require(recipients.length == uris.length && uris.length == propertyDataArray.length, 
                "Array lengths must match");
        require(recipients.length <= 20, "Batch size too large"); // Gas limit protection
        
        uint256[] memory tokenIds = new uint256[](recipients.length);
        
        for (uint256 i = 0; i < recipients.length; i++) {
            tokenIds[i] = mint(recipients[i], uris[i], propertyDataArray[i]);
        }
        
        return tokenIds;
    }
    
    /**
     * @dev Update property information (only owner of token or authorized)
     */
    function updatePropertyInfo(uint256 tokenId, PropertyInfo memory newPropertyData)
        external
        tokenExists(tokenId)
    {
        require(
            ownerOf(tokenId) == _msgSender() ||
            owner() == _msgSender() ||
            hasRole(METADATA_ROLE, _msgSender()),
            "Not authorized to update"
        );
        if (!isValidPropertyInfo(newPropertyData)) revert InvalidPropertyInfo();
        
        // Preserve original creation time and active status unless owner
        if (msg.sender != owner()) {
            newPropertyData.createdAt = propertyInfo[tokenId].createdAt;
            newPropertyData.isActive = propertyInfo[tokenId].isActive;
        }
        
        propertyInfo[tokenId] = newPropertyData;
        emit PropertyInfoUpdated(tokenId, newPropertyData);
    }
    
    /**
     * @dev Deactivate/reactivate a property (only owner)
     */
    function setPropertyActive(uint256 tokenId, bool isActive)
        external
        tokenExists(tokenId)
        onlyAdminOrOwner
    {
        propertyInfo[tokenId].isActive = isActive;
        emit PropertyInfoUpdated(tokenId, propertyInfo[tokenId]);
    }
    
    /**
     * @dev Authorize/revoke minting privileges
     */
    function setAuthorizedMinter(address minter, bool authorized)
        external
        onlyAdminOrOwner
    {
        if (authorized) {
            _grantRole(MINTER_ROLE, minter);
            emit MinterAuthorized(minter);
        } else {
            _revokeRole(MINTER_ROLE, minter);
            emit MinterRevoked(minter);
        }
    }
    
    /**
     * @dev Set base URI for metadata
     */
    function setBaseURI(string memory baseURI)
        external
        onlyAdminOrOwner
    {
        _baseTokenURI = baseURI;
        emit BaseURIUpdated(baseURI);
    }
    
    /**
     * @dev Emergency pause functionality
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @dev Get all properties owned by an address
     */
    function getPropertiesByOwner(address owner) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory properties = new uint256[](balance);
        
        for (uint256 i = 0; i < balance; i++) {
            properties[i] = tokenOfOwnerByIndex(owner, i);
        }
        
        return properties;
    }
    
    /**
     * @dev Get properties by type
     */
    function getPropertiesByType(string memory propertyType) external view returns (uint256[] memory) {
        uint256 totalSupply = totalSupply();
        uint256[] memory tempResult = new uint256[](totalSupply);
        uint256 count = 0;
        
        for (uint256 i = 1; i <= totalSupply; i++) {
            if (_exists(i) && 
                keccak256(bytes(propertyInfo[i].propertyType)) == keccak256(bytes(propertyType)) &&
                propertyInfo[i].isActive) {
                tempResult[count] = i;
                count++;
            }
        }
        
        // Resize array to actual count
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = tempResult[i];
        }
        
        return result;
    }
    
    /**
     * @dev Validate property information
     */
    function isValidPropertyInfo(PropertyInfo memory propertyData) internal pure returns (bool) {
        return bytes(propertyData.propertyType).length > 0 && 
               bytes(propertyData.location).length > 0;
    }
    
    /**
     * @dev Override functions to resolve inheritance conflicts
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    )
        internal
        override(ERC721, ERC721Enumerable)
        whenNotPaused
    {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function _burn(uint256 tokenId)
        internal
        override(ERC721, ERC721URIStorage)
    {
        super._burn(tokenId);
        delete propertyInfo[tokenId];
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable, ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _baseURI() internal view override returns (string memory) {  
        return _baseTokenURI;
    }
    
    /**
     * @dev Get total supply of active properties
     */
    function totalActiveSupply() external view returns (uint256) {
        uint256 total = totalSupply();
        uint256 activeCount = 0;
        
        for (uint256 i = 1; i <= total; i++) {
            if (_exists(i) && propertyInfo[i].isActive) {
                activeCount++;
            }
        }
        
        return activeCount;
    }
    
    /**
     * @dev Check if a token URI has been used
     */
    function isTokenURIUsed(string memory uri) external view returns (bool) {
        return usedTokenURIs[uri];
    }
}