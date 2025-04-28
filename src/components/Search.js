import { useState } from "react";

const Search = ({ searchQuery, setSearchQuery }) => {
  const [isFocused, setIsFocused] = useState(false);

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const handleClear = () => {
    setSearchQuery("");
  };

  return (
    <header className="search-header">
      <div className="search-container">
        <h2 className="search-title">Find Your Dream Property</h2>
        <p className="search-subtitle">
          Search, Explore, and Purchase Real Estate on the Blockchain
        </p>

        <div className={`search-box ${isFocused ? "search-box--focused" : ""}`}>
          <i className="fa fa-search search-icon"></i>
          <input
            type="text"
            className="search-input"
            placeholder="Enter an address, neighborhood, city, or ZIP code"
            value={searchQuery}
            onChange={handleSearchChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />
          {searchQuery && (
            <button className="search-clear" onClick={handleClear}>
              <i className="fa fa-times"></i>
            </button>
          )}
          <button className="search-button">Search</button>
        </div>

        <div className="search-filters">
          <button className="filter-tag">For Sale</button>
          <button className="filter-tag">New Listing</button>
          <button className="filter-tag">
            Price <i className="fa fa-chevron-down"></i>
          </button>
          <button className="filter-tag">
            Features <i className="fa fa-chevron-down"></i>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Search;
