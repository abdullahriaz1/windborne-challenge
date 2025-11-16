'use client';

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';

const GlobeVisualization = dynamic(() => import('./Globe'), { 
  ssr: false,
  loading: () => <div className="h-[600px] w-full rounded-lg overflow-hidden border border-gray-300 flex items-center justify-center bg-gray-900 text-white">Loading globe...</div>
});

export default function Home() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentHour, setCurrentHour] = useState(0);
  const [selectedBalloon, setSelectedBalloon] = useState<{
    coord: number[];
    index: number;
    location: string | null;
    loadingLocation: boolean;
  } | null>(null);
  const lastLocationUpdateHour = useRef<number>(-1);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationProgress, setAnimationProgress] = useState(0);
  const [allHourData, setAllHourData] = useState<any[]>([]);
  const [showStems, setShowStems] = useState(true);

  const fetchData = (hour: number) => {
    setLoading(true);
    setError(null);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const hourStr = hour.toString().padStart(2, '0');

    fetch(`/api/treasure?hour=${hourStr}`, {
      signal: controller.signal,
    })
      .then(response => {
        clearTimeout(timeoutId);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        setData(data);
        setCurrentHour(hour);
        setLoading(false);
      })
      .catch(err => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          setError('Request timed out after 10 seconds');
        } else {
          setError(`${err.message}`);
        }
        setLoading(false);
      });

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  };

  useEffect(() => {
    // Start with 01 since 00.json doesn't exist
    fetchData(1);
  }, []);

  const fetchAllHourData = async () => {
    setLoading(true);
    const hourDataArray: any[] = [];
    
    try {
      // Fetch hours 23 down to 1 (00.json doesn't exist)
      for (let hour = 23; hour >= 1; hour--) {
        const hourStr = hour.toString().padStart(2, '0');
        const response = await fetch(`/api/treasure?hour=${hourStr}`);
        const hourData = await response.json();
        hourDataArray.push(hourData);
      }
      
      setAllHourData(hourDataArray);
      setLoading(false);
      return hourDataArray;
    } catch (err) {
      setError('Failed to load animation data');
      setLoading(false);
      return null;
    }
  };


  const handleAnimationProgress = (progress: number, hour: number) => {
    setAnimationProgress(progress);
    setCurrentHour(hour);
  };

  // Update selected balloon location when hour changes during animation
  useEffect(() => {
    if (isAnimating && selectedBalloon && allHourData.length > 0) {
      // Only update if hour has changed (not on initial selection)
      if (currentHour !== lastLocationUpdateHour.current && lastLocationUpdateHour.current !== -1) {
        lastLocationUpdateHour.current = currentHour;
        
        // Get the current hour's data
        const hourIndex = 23 - currentHour;
        if (hourIndex >= 0 && hourIndex < allHourData.length) {
          const currentHourData = allHourData[hourIndex];
          const balloonCoord = currentHourData[selectedBalloon.index];
          
          if (balloonCoord) {
            // Update the coordinate and fetch new location
            setSelectedBalloon(prev => prev ? { ...prev, coord: balloonCoord, loadingLocation: true } : null);
            
            // Fetch location for new coordinates
            fetchLocationForCoord(balloonCoord, selectedBalloon.index);
          }
        }
      }
    }
  }, [currentHour, isAnimating, selectedBalloon, allHourData]);

  const fetchLocationForCoord = async (coord: number[], index: number) => {
    const [lat, lon, alt] = coord;
    try {
      const nominatimResponse = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`,
        {
          headers: {
            'User-Agent': 'Windborne Balloon Tracker',
          },
        }
      );
      const nominatimData = await nominatimResponse.json();
      
      let locationText = '';
      
      if (nominatimData.display_name && !nominatimData.error) {
        locationText = nominatimData.display_name;
      } else if (nominatimData.address) {
        const parts = [];
        if (nominatimData.address.country) parts.push(nominatimData.address.country);
        if (nominatimData.address.state) parts.push(nominatimData.address.state);
        locationText = parts.join(', ') || getOceanName(lat, lon);
      } else {
        locationText = getOceanName(lat, lon);
      }
      
      setSelectedBalloon(prev => prev && prev.index === index ? {
        ...prev,
        location: locationText,
        loadingLocation: false,
      } : prev);
    } catch (err) {
      setSelectedBalloon(prev => prev && prev.index === index ? {
        ...prev,
        location: getOceanName(lat, lon),
        loadingLocation: false,
      } : prev);
    }
  };

  const startAnimation = async () => {
    // Fetch data if not already loaded
    if (allHourData.length === 0) {
      setLoading(true);
      const fetchedData = await fetchAllHourData();
      setLoading(false);
      if (!fetchedData) return;
    }

    setIsAnimating(true);
    setAnimationProgress(0);
  };

  const stopAnimation = () => {
    setIsAnimating(false);
    setAnimationProgress(0);
    setCurrentHour(1);
  };

  const getOceanName = (lat: number, lon: number) => {
    // Simple ocean detection based on coordinates
    // Pacific Ocean
    if ((lon >= 100 || lon <= -70) && lat >= -60 && lat <= 60) {
      if (lon >= 100 && lon <= 180) return 'Western Pacific Ocean';
      if (lon >= -180 && lon <= -70) return 'Eastern Pacific Ocean';
    }
    // Atlantic Ocean
    if (lon >= -70 && lon <= 20 && lat >= -60 && lat <= 70) {
      if (lat >= 0) return 'North Atlantic Ocean';
      return 'South Atlantic Ocean';
    }
    // Indian Ocean
    if (lon >= 20 && lon <= 100 && lat >= -60 && lat <= 30) {
      return 'Indian Ocean';
    }
    // Arctic Ocean
    if (lat >= 66) return 'Arctic Ocean';
    // Southern Ocean
    if (lat <= -60) return 'Southern Ocean';
    
    return 'Open Ocean';
  };

  const handleMarkerClick = async (coord: number[], index: number) => {
    setSelectedBalloon({
      coord,
      index,
      location: null,
      loadingLocation: true,
    });
    
    // Reset the last update hour so it updates on next hour change
    lastLocationUpdateHour.current = currentHour;
    
    // Fetch location
    fetchLocationForCoord(coord, index);
  };

  // Calculate altitude color - dark navy blue (low) -> dark blue (medium) -> dark green (high)
  const getAltitudeColor = (alt: number, minAlt: number, maxAlt: number) => {
    const normalized = (alt - minAlt) / (maxAlt - minAlt);
    // Dark Navy Blue -> Dark Blue -> Dark Green (no light colors)
    let r, g, b;
    
    if (normalized < 0.5) {
      // Dark Navy Blue to Dark Blue
      const t = normalized / 0.5;
      r = Math.round(0 + t * 20);
      g = Math.round(30 + t * 50);
      b = Math.round(80 + t * 60);
    } else {
      // Dark Blue to Dark Green
      const t = (normalized - 0.5) / 0.5;
      r = Math.round(20 - t * 20);
      g = Math.round(80 + t * 60);
      b = Math.round(140 - t * 100);
    }
    
    return `rgb(${r}, ${g}, ${b})`;
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans">
      {/* Header */}
      <div className="border-b border-gray-800 bg-black/50 backdrop-blur-sm">
        <div className="max-w-[1920px] mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-2xl font-bold tracking-wider">WINDBORNE ENGINEERING CHALLENGE</div>
            <div className="text-xs text-gray-500 uppercase tracking-widest">Stratospheric Data Network</div>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div className="text-gray-400">LIVE TRACKING</div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-green-500 font-mono">OPERATIONAL</span>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="text-red-500 p-4 text-center">Error: {error}</div>}
      {data && Array.isArray(data) && (() => {
        const altitudes = data.map((coord: number[]) => coord[2]);
        const minAlt = Math.min(...altitudes);
        const maxAlt = Math.max(...altitudes);

        return (
          <div className="max-w-[1920px] mx-auto p-8">
            {/* Control Panel */}
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="text-sm text-gray-500 uppercase tracking-widest">Mission Control</div>
                <div className="h-4 w-px bg-gray-800"></div>
                <div className="font-mono text-sm text-gray-400">
                  {data.length} ACTIVE BALLOONS
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowStems(!showStems)}
                  className={`
                    px-5 py-2.5 rounded border font-mono text-xs uppercase tracking-wider transition-all
                    ${showStems 
                      ? 'bg-blue-500/10 border-blue-500/50 text-blue-400 hover:bg-blue-500/20' 
                      : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
                    }
                  `}
                >
                  {showStems ? 'ALTITUDE MARKERS: ON' : 'ALTITUDE MARKERS: OFF'}
                </button>
                <button
                  onClick={isAnimating ? stopAnimation : startAnimation}
                  disabled={loading}
                  className={`
                    px-6 py-2.5 rounded border font-mono text-xs uppercase tracking-wider transition-all
                    ${isAnimating 
                      ? 'bg-red-500/10 border-red-500/50 text-red-400 hover:bg-red-500/20' 
                      : 'bg-green-500/10 border-green-500/50 text-green-400 hover:bg-green-500/20'
                    }
                    ${loading ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  {isAnimating ? '⏸ STOP PLAYBACK' : '▶ START PLAYBACK'}
                </button>
              </div>
            </div>

            {/* Animation Timeline */}
            {isAnimating && (
              <div className="mb-6 bg-gray-900/50 border border-gray-800 rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <div className="text-xs text-gray-500 uppercase tracking-widest">Temporal Playback</div>
                  <div className="font-mono text-sm text-cyan-400">
                    T-{currentHour === 0 ? '00:00:00' : `${currentHour.toString().padStart(2, '0')}:00:00`}
                  </div>
                </div>
                <div className="relative w-full h-1 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="absolute h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-100 ease-linear"
                    style={{ width: `${animationProgress * 100}%` }}
                  />
                  <div 
                    className="absolute h-full w-1 bg-white shadow-lg shadow-cyan-500/50"
                    style={{ left: `${animationProgress * 100}%`, transform: 'translateX(-50%)' }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-gray-600 mt-2 font-mono">
                  <span>T-24:00:00</span>
                  <span>T-00:00:00</span>
                </div>
              </div>
            )}
            
            <GlobeVisualization 
              data={data} 
              getAltitudeColor={getAltitudeColor}
              minAlt={minAlt}
              maxAlt={maxAlt}
              onMarkerClick={handleMarkerClick}
              allHourData={allHourData}
              isAnimating={isAnimating}
              onAnimationProgress={handleAnimationProgress}
              showStems={showStems}
            />
            
            {/* Balloon Telemetry Panel */}
            {selectedBalloon && (
              <div className="mt-6 bg-gray-900/50 border border-cyan-500/30 rounded-lg overflow-hidden">
                <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-b border-cyan-500/30 px-4 py-3 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
                    <h3 className="text-sm font-mono uppercase tracking-wider text-cyan-400">
                      BALLOON-{selectedBalloon.index.toString().padStart(4, '0')}
                    </h3>
                  </div>
                  <button
                    onClick={() => setSelectedBalloon(null)}
                    className="text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-black/30 border border-gray-800 rounded p-3">
                      <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Latitude</div>
                      <div className="font-mono text-lg text-white">{selectedBalloon.coord[0].toFixed(4)}°</div>
                    </div>
                    <div className="bg-black/30 border border-gray-800 rounded p-3">
                      <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Longitude</div>
                      <div className="font-mono text-lg text-white">{selectedBalloon.coord[1].toFixed(4)}°</div>
                    </div>
                    <div className="bg-black/30 border border-gray-800 rounded p-3">
                      <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Altitude</div>
                      <div className="font-mono text-lg text-cyan-400">{selectedBalloon.coord[2].toFixed(0)} m</div>
                    </div>
                  </div>
                  <div className="bg-black/30 border border-gray-800 rounded p-3">
                    <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Geographic Position</div>
                    <div className="text-sm text-gray-300">
                      {selectedBalloon.loadingLocation ? (
                        <div className="flex items-center gap-2">
                          <div className="w-1 h-1 bg-cyan-400 rounded-full animate-pulse"></div>
                          <span className="text-gray-500 font-mono">ACQUIRING LOCATION DATA...</span>
                        </div>
                      ) : (
                        <span className="font-mono">{selectedBalloon.location || 'UNKNOWN REGION'}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Info Footer */}
            <div className="mt-8 border-t border-gray-800 pt-6">
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div className="bg-gray-900/30 border border-gray-800 rounded p-4">
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Controls</div>
                  <div className="space-y-1 text-xs text-gray-400 font-mono">
                    <div>• ROTATE: Click + Drag</div>
                    <div>• ZOOM: Scroll Wheel</div>
                    <div>• PAN: Right Click + Drag</div>
                    <div>• SELECT: Click Balloon</div>
                  </div>
                </div>
                <div className="bg-gray-900/30 border border-gray-800 rounded p-4">
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Altitude Scale</div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 font-mono">LOW</span>
                    <div className="flex h-4 flex-1 rounded overflow-hidden border border-blue-500/30">
                      {Array.from({ length: 20 }, (_, i) => {
                        const normalized = i / 19;
                        // Dark navy blue to dark blue to dark green gradient
                        let r, g, b;
                        if (normalized < 0.5) {
                          const t = normalized / 0.5;
                          r = Math.round(0 + t * 20); g = Math.round(30 + t * 50); b = Math.round(80 + t * 60);
                        } else {
                          const t = (normalized - 0.5) / 0.5;
                          r = Math.round(20 - t * 20); g = Math.round(80 + t * 60); b = Math.round(140 - t * 100);
                        }
                        return (
                          <div
                            key={i}
                            style={{ backgroundColor: `rgb(${r}, ${g}, ${b})`, flex: 1 }}
                          />
                        );
                      })}
                    </div>
                    <span className="text-xs text-gray-400 font-mono">HIGH</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-2">Altitude exaggerated 20x for visibility</div>
                </div>
              </div>
              <p className="text-center mb-4 text-xs">
                Range: {minAlt.toFixed(1)}m - {maxAlt.toFixed(1)}m
              </p>
              
              {/* Hour pagination */}
              <div className="border-t border-gray-300 dark:border-gray-700 pt-4">
                <p className="text-center mb-3 font-semibold">Select Time (Hours Ago)</p>
                <div className="grid grid-cols-12 gap-2">
                  {Array.from({ length: 24 }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => fetchData(i)}
                      disabled={loading}
                      className={`
                        px-3 py-2 rounded text-sm font-medium transition-colors
                        ${currentHour === i 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                        }
                        ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                      `}
                    >
                      {i}h
                    </button>
                  ))}
                </div>
                <p className="text-center mt-2 text-xs">
                  Currently viewing: {currentHour === 0 ? 'Now' : `${currentHour} hour${currentHour > 1 ? 's' : ''} ago`}
                </p>
              </div>
            </div>
          </div>
        );
      })()}
      
      {/* Footer */}
      <footer className="border-t border-gray-800 bg-black/50 backdrop-blur-sm mt-12">
        <div className="max-w-[1920px] mx-auto px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500 uppercase tracking-widest">
              Built by Abdullah Riaz
            </div>
            <div className="flex items-center gap-6">
              <a
                href="https://www.linkedin.com/in/abdullah-riaz-ucsc/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-gray-400 hover:text-cyan-400 transition-colors text-sm font-mono"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                </svg>
                LINKEDIN
              </a>
              <a
                href="https://github.com/abdullahriaz1"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-gray-400 hover:text-cyan-400 transition-colors text-sm font-mono"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                GITHUB
              </a>
              <a
                href="https://www.abdullahriaz.io/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-gray-400 hover:text-cyan-400 transition-colors text-sm font-mono"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>
                </svg>
                PORTFOLIO
              </a>
              <a
                href="mailto:abdullahriaz03@outlook.com"
                className="flex items-center gap-2 text-gray-400 hover:text-cyan-400 transition-colors text-sm font-mono"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                </svg>
                EMAIL
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
