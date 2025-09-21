import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X, Maximize2, Play, Pause } from 'lucide-react';

const EnhancedImageGallery = ({ 
  images = [], 
  autoSlideDelay = 5000,
  showThumbnails = true,
  showCounter = true,
  showFullscreen = true,
  showAutoplay = true 
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAutoplay, setIsAutoplay] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Sample images for demo
  const sampleImages = [
    'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&h=600&fit=crop',
    'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&h=600&fit=crop',
    'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&h=600&fit=crop',
    'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&h=600&fit=crop',
    'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&h=600&fit=crop'
  ];

  const gallery = images.length > 0 ? images : sampleImages;

  // Auto-slide functionality
  useEffect(() => {
    if (!isAutoplay || gallery.length <= 1) return;
    
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % gallery.length);
    }, autoSlideDelay);

    return () => clearInterval(interval);
  }, [isAutoplay, gallery.length, autoSlideDelay]);

  // Navigation functions
  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % gallery.length);
  };

  const goToPrev = () => {
    setCurrentIndex((prev) => (prev - 1 + gallery.length) % gallery.length);
  };

  const goToSlide = (index) => {
    setCurrentIndex(index);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (!isFullscreen) return;
      
      switch (e.key) {
        case 'ArrowLeft':
          goToPrev();
          break;
        case 'ArrowRight':
          goToNext();
          break;
        case 'Escape':
          setIsFullscreen(false);
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [isFullscreen]);

  // Handle image loading
  const handleImageLoad = () => {
    setIsLoading(false);
  };

  const handleImageError = () => {
    setIsLoading(false);
  };

  if (gallery.length === 0) {
    return (
      <div className="gallery-placeholder">
        <div className="placeholder-content">
          <div className="placeholder-icon">🏠</div>
          <p>No images available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="enhanced-gallery">
      {/* Main Image Display */}
      <div className="gallery-main">
        <div className="image-container">
          {isLoading && (
            <div className="image-loader">
              <div className="loader-spinner"></div>
            </div>
          )}
          
          <img
            src={gallery[currentIndex]}
            alt={`Property image ${currentIndex + 1}`}
            className="main-image"
            onLoad={handleImageLoad}
            onError={handleImageError}
            style={{ opacity: isLoading ? 0 : 1 }}
          />

          {/* Navigation Arrows */}
          {gallery.length > 1 && (
            <>
              <button 
                className="nav-button nav-prev" 
                onClick={goToPrev}
                aria-label="Previous image"
              >
                <ChevronLeft size={24} />
              </button>
              
              <button 
                className="nav-button nav-next" 
                onClick={goToNext}
                aria-label="Next image"
              >
                <ChevronRight size={24} />
              </button>
            </>
          )}

          {/* Image Overlay Controls */}
          <div className="image-overlay">
            {showCounter && gallery.length > 1 && (
              <div className="image-counter">
                {currentIndex + 1} / {gallery.length}
              </div>
            )}

            <div className="overlay-controls">
              {showAutoplay && gallery.length > 1 && (
                <button
                  className="control-button"
                  onClick={() => setIsAutoplay(!isAutoplay)}
                  title={isAutoplay ? 'Pause slideshow' : 'Start slideshow'}
                >
                  {isAutoplay ? <Pause size={16} /> : <Play size={16} />}
                </button>
              )}
              
              {showFullscreen && (
                <button
                  className="control-button"
                  onClick={() => setIsFullscreen(true)}
                  title="View fullscreen"
                >
                  <Maximize2 size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {isAutoplay && gallery.length > 1 && (
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{
                  animationDuration: `${autoSlideDelay}ms`
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Thumbnail Strip */}
      {showThumbnails && gallery.length > 1 && (
        <div className="gallery-thumbnails">
          <div className="thumbnails-container">
            {gallery.map((image, index) => (
              <button
                key={index}
                className={`thumbnail ${index === currentIndex ? 'active' : ''}`}
                onClick={() => goToSlide(index)}
                aria-label={`View image ${index + 1}`}
              >
                <img src={image} alt={`Thumbnail ${index + 1}`} />
                {index === currentIndex && <div className="thumbnail-overlay" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div className="fullscreen-modal" onClick={() => setIsFullscreen(false)}>
          <div className="fullscreen-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="fullscreen-close"
              onClick={() => setIsFullscreen(false)}
              aria-label="Close fullscreen"
            >
              <X size={24} />
            </button>

            <img
              src={gallery[currentIndex]}
              alt={`Property image ${currentIndex + 1}`}
              className="fullscreen-image"
            />

            {gallery.length > 1 && (
              <>
                <button 
                  className="fullscreen-nav fullscreen-prev" 
                  onClick={goToPrev}
                  aria-label="Previous image"
                >
                  <ChevronLeft size={32} />
                </button>
                
                <button 
                  className="fullscreen-nav fullscreen-next" 
                  onClick={goToNext}
                  aria-label="Next image"
                >
                  <ChevronRight size={32} />
                </button>
              </>
            )}

            <div className="fullscreen-counter">
              {currentIndex + 1} / {gallery.length}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .enhanced-gallery {
          width: 100%;
          max-width: 800px;
          margin: 0 auto;
          background: #ffffff;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        }

        .gallery-placeholder {
          aspect-ratio: 16/9;
          background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
        }

        .placeholder-content {
          text-align: center;
          color: #64748b;
        }

        .placeholder-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
          opacity: 0.5;
        }

        .gallery-main {
          position: relative;
          aspect-ratio: 16/9;
          background: #000;
          overflow: hidden;
        }

        .image-container {
          position: relative;
          width: 100%;
          height: 100%;
        }

        .main-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: opacity 0.3s ease;
        }

        .image-loader {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 2;
        }

        .loader-spinner {
          width: 40px;
          height: 40px;
          border: 3px solid rgba(255, 255, 255, 0.3);
          border-top: 3px solid #ffffff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .nav-button {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          background: rgba(0, 0, 0, 0.6);
          color: white;
          border: none;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s ease;
          z-index: 3;
          backdrop-filter: blur(10px);
        }

        .nav-button:hover {
          background: rgba(0, 0, 0, 0.8);
          transform: translateY(-50%) scale(1.1);
        }

        .nav-prev {
          left: 16px;
        }

        .nav-next {
          right: 16px;
        }

        .image-overlay {
          position: absolute;
          top: 0;
          right: 0;
          left: 0;
          padding: 20px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          background: linear-gradient(to bottom, rgba(0, 0, 0, 0.3), transparent);
          z-index: 2;
        }

        .image-counter {
          background: rgba(0, 0, 0, 0.7);
          color: white;
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: 500;
          backdrop-filter: blur(10px);
        }

        .overlay-controls {
          display: flex;
          gap: 8px;
        }

        .control-button {
          background: rgba(0, 0, 0, 0.7);
          color: white;
          border: none;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
        }

        .control-button:hover {
          background: rgba(0, 0, 0, 0.9);
          transform: scale(1.1);
        }

        .progress-bar {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: rgba(255, 255, 255, 0.3);
          z-index: 2;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #06b6d4);
          width: 0;
          animation: progress-fill linear forwards;
        }

        @keyframes progress-fill {
          from { width: 0; }
          to { width: 100%; }
        }

        .gallery-thumbnails {
          padding: 16px;
          background: #f8fafc;
          border-top: 1px solid #e2e8f0;
        }

        .thumbnails-container {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding: 4px 0;
          scrollbar-width: thin;
          scrollbar-color: #cbd5e1 transparent;
        }

        .thumbnails-container::-webkit-scrollbar {
          height: 6px;
        }

        .thumbnails-container::-webkit-scrollbar-track {
          background: transparent;
        }

        .thumbnails-container::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 3px;
        }

        .thumbnail {
          position: relative;
          flex-shrink: 0;
          width: 80px;
          height: 60px;
          border: 2px solid transparent;
          border-radius: 8px;
          overflow: hidden;
          cursor: pointer;
          transition: all 0.3s ease;
          background: none;
          padding: 0;
        }

        .thumbnail:hover {
          border-color: #3b82f6;
          transform: scale(1.05);
        }

        .thumbnail.active {
          border-color: #3b82f6;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
        }

        .thumbnail img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .thumbnail-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(59, 130, 246, 0.2);
        }

        .fullscreen-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.95);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(10px);
        }

        .fullscreen-content {
          position: relative;
          max-width: 95vw;
          max-height: 95vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .fullscreen-image {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          border-radius: 8px;
        }

        .fullscreen-close {
          position: absolute;
          top: 20px;
          right: 20px;
          background: rgba(0, 0, 0, 0.7);
          color: white;
          border: none;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s ease;
          z-index: 10;
        }

        .fullscreen-close:hover {
          background: rgba(0, 0, 0, 0.9);
          transform: scale(1.1);
        }

        .fullscreen-nav {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          background: rgba(0, 0, 0, 0.7);
          color: white;
          border: none;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .fullscreen-nav:hover {
          background: rgba(0, 0, 0, 0.9);
          transform: translateY(-50%) scale(1.1);
        }

        .fullscreen-prev {
          left: 30px;
        }

        .fullscreen-next {
          right: 30px;
        }

        .fullscreen-counter {
          position: absolute;
          bottom: 30px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.7);
          color: white;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 16px;
          font-weight: 500;
        }

        /* Mobile Responsive */
        @media (max-width: 768px) {
          .nav-button {
            width: 40px;
            height: 40px;
          }

          .nav-prev {
            left: 12px;
          }

          .nav-next {
            right: 12px;
          }

          .image-overlay {
            padding: 16px;
          }

          .thumbnail {
            width: 60px;
            height: 45px;
          }

          .fullscreen-nav {
            width: 48px;
            height: 48px;
          }

          .fullscreen-prev {
            left: 20px;
          }

          .fullscreen-next {
            right: 20px;
          }

          .fullscreen-close {
            top: 16px;
            right: 16px;
            width: 40px;
            height: 40px;
          }
        }
      `}</style>
    </div>
  );
};

export default EnhancedImageGallery;