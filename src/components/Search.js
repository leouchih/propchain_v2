import { useEffect, useId, useRef, useState } from "react";

const DEFAULT_DEBOUNCE = 0;

export default function Search({
  searchQuery,
  setSearchQuery,
  onSearch,                // optional
  debounceMs = DEFAULT_DEBOUNCE,
}) {
  const [localQuery, setLocalQuery] = useState(searchQuery ?? "");
  const [isFocused, setIsFocused] = useState(false);

  const inputId = useId();
  const timerRef = useRef(null);

  // keep input in sync when parent changes query
  useEffect(() => {
    setLocalQuery(searchQuery ?? "");
  }, [searchQuery]);

  // debounced propagation of query -> parent
  useEffect(() => {
    if (debounceMs <= 0) {
      setSearchQuery?.(localQuery);
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSearchQuery?.(localQuery);
    }, debounceMs);
    return () => clearTimeout(timerRef.current);
  }, [localQuery, debounceMs, setSearchQuery]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch?.(localQuery.trim());
  };

  const handleClear = () => {
    setLocalQuery("");
    setSearchQuery?.("");
    onSearch?.("");
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      handleClear();
      e.currentTarget.blur();
    }
  };

  return (
    <header className="search-header">
      <div className="search-container">
        <h2 className="search-title">Find Your Dream Property</h2>
        <p className="search-subtitle">Search, Explore, and Purchase Real Estate on the Blockchain</p>

        <form
          className={`search-box ${isFocused ? "search-box--focused" : ""}`}
          onSubmit={handleSubmit}
          role="search"
          aria-label="Property search"
        >
          <i className="fa fa-search search-icon" aria-hidden="true"></i>

          <label htmlFor={inputId} className="sr-only">Search properties</label>
          <input
            id={inputId}
            type="text"
            className="search-input"
            placeholder="Enter an address, neighborhood, city, or ZIP code"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={onKeyDown}
            autoComplete="off"
          />

          {localQuery && (
            <button
              type="button"
              className="search-clear"
              onClick={handleClear}
              aria-label="Clear search"
              title="Clear search"
            >
              <i className="fa fa-times" aria-hidden="true"></i>
            </button>
          )}

          <button type="submit" className="search-button" aria-label="Search">
            Search
          </button>
        </form>
      </div>
    </header>
  );
}
