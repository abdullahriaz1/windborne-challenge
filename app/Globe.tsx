'use client';

import { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, extend, useThree } from '@react-three/fiber';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';

extend({ OrbitControlsImpl });

interface GlobeProps {
  data: number[][];
  getAltitudeColor: (alt: number, minAlt: number, maxAlt: number) => string;
  minAlt: number;
  maxAlt: number;
  onMarkerClick: (coord: number[], index: number) => void;
  allHourData?: number[][][];
  isAnimating?: boolean;
  onAnimationProgress?: (progress: number, hour: number) => void;
  showStems?: boolean;
  userInteracted?: boolean;
  onWelcomeChange?: (show: boolean, opacity?: number) => void;
}

function Globe({ data, getAltitudeColor, minAlt, maxAlt, onMarkerClick, allHourData, isAnimating, onAnimationProgress, showStems = true, userInteracted = false, onWelcomeChange }: GlobeProps) {
  const globeRef = useRef<THREE.Mesh>(null);
  const animationStartTime = useRef<number | null>(null);
  const currentDataRef = useRef(data);
  const markerRefs = useRef<THREE.Mesh[]>([]);
  const pillarRefs = useRef<THREE.Mesh[]>([]);
  const outlineRefs = useRef<THREE.Mesh[][]>([]);
  const originalPillarHeights = useRef<number[]>([]);
  const lastPositions = useRef<THREE.Vector3[]>([]);
  const tailRefs = useRef<THREE.Group[]>([]);
  const smoothedVelocities = useRef<THREE.Vector3[]>([]);
  const lastProgressReport = useRef(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const cameraAnimationStart = useRef<number | null>(null);
  const hasAnimated = useRef(false);
  const orbitStartTime = useRef<number | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [welcomeOpacity, setWelcomeOpacity] = useState(0);
  const [pageClicked, setPageClicked] = useState(false);
  const welcomeAnimationStart = useRef<number | null>(null);
  
  // Notify parent when welcome visibility or opacity changes
  useEffect(() => {
    if (onWelcomeChange) {
      onWelcomeChange(showWelcome, welcomeOpacity);
    }
  }, [showWelcome, welcomeOpacity, onWelcomeChange]);
  
  // Add global click listener to stop animations on any page click
  useEffect(() => {
    const handleClick = () => setPageClicked(true);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);
  
  // Pre-calculate colors for each balloon to avoid recalculating every frame
  const balloonColors = useMemo(() => {
    return data.map(coord => getAltitudeColor(coord[2], minAlt, maxAlt));
  }, [data, minAlt, maxAlt, getAltitudeColor]);

  // Load Earth texture
  const earthTexture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    return loader.load('https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg');
  }, []);

  // Update ref when base data changes
  useEffect(() => {
    if (!isAnimating) {
      currentDataRef.current = data;
    }
  }, [data, isAnimating]);

  // Interpolation function with longitude wrapping
  const interpolateCoordinates = (coord1: number[], coord2: number[], t: number) => {
    const [lat1, lon1, alt1] = coord1;
    const [lat2, lon2, alt2] = coord2;
    
    let lonDiff = lon2 - lon1;
    if (lonDiff > 180) lonDiff -= 360;
    else if (lonDiff < -180) lonDiff += 360;
    
    let interpolatedLon = lon1 + lonDiff * t;
    if (interpolatedLon > 180) interpolatedLon -= 360;
    else if (interpolatedLon < -180) interpolatedLon += 360;
    
    return [
      lat1 + (lat2 - lat1) * t,
      interpolatedLon,
      alt1 + (alt2 - alt1) * t,
    ];
  };

  // Animation loop using Three.js useFrame (runs at 60fps without React re-renders)
  useFrame(({ camera, clock }) => {
    // Camera zoom-in and orbit animation on initial load
    if (!hasAnimated.current) {
      if (cameraAnimationStart.current === null) {
        cameraAnimationStart.current = Date.now();
        orbitStartTime.current = clock.getElapsedTime();
        welcomeAnimationStart.current = Date.now();
      }
      
      const elapsed = Date.now() - cameraAnimationStart.current;
      const duration = 6000; // 6 second animation
      const progress = Math.min(elapsed / duration, 1);
      
      // Welcome text fade animation (6 seconds total: 2s fade in, 2s hold, 2s fade out)
      if (showWelcome) {
        const fadeInDuration = 2000; // 2 seconds
        const fadeOutStart = 4000; // Start fade out at 4 seconds
        
        if (elapsed < fadeInDuration) {
          // Fade in (0 to 2 seconds)
          setWelcomeOpacity(elapsed / fadeInDuration);
        } else if (elapsed < fadeOutStart) {
          // Hold at full opacity (2 to 4 seconds)
          setWelcomeOpacity(1);
        } else if (elapsed < duration) {
          // Fade out (4 to 6 seconds)
          const fadeOutProgress = (elapsed - fadeOutStart) / 2000;
          setWelcomeOpacity(1 - fadeOutProgress);
        } else {
          // Hide after 6 seconds
          setShowWelcome(false);
          setWelcomeOpacity(0);
        }
      }
      
      // Smooth easing function (ease-out)
      const eased = 1 - Math.pow(1 - progress, 3);
      
      // Interpolate radius from 15 to 5 while orbiting
      const radius = 15 - (eased * 10);
      const speed = 0.15;
      const angle = (clock.getElapsedTime() - (orbitStartTime.current || 0)) * speed;
      
      camera.position.x = Math.sin(angle) * radius;
      camera.position.z = Math.cos(angle) * radius;
      camera.lookAt(0, 0, 0);
      
      if (progress >= 1) {
        hasAnimated.current = true;
      }
    }
    
    // Continue auto-orbit after zoom completes, until user clicks anywhere on page
    if (hasAnimated.current && !pageClicked) {
      const radius = 5;
      const speed = 0.15;
      const angle = (clock.getElapsedTime() - orbitStartTime.current!) * speed;
      camera.position.x = Math.sin(angle) * radius;
      camera.position.z = Math.cos(angle) * radius;
      camera.lookAt(0, 0, 0);
    }
    
    // Always update positions from current data (for both static and animated states)
    const sourceData = (isAnimating && allHourData && allHourData.length > 0) ? null : currentDataRef.current;
    
    if (!isAnimating || !allHourData || allHourData.length === 0) {
      // Not animating - hide tails
      if (animationStartTime.current !== null) {
        animationStartTime.current = null;
        // Hide all tails when animation stops
        lastPositions.current = [];
        smoothedVelocities.current = [];
        tailRefs.current.forEach(tail => {
          if (tail) {
            tail.visible = false;
          }
        });
      }
      return;
    }

    if (animationStartTime.current === null) {
      animationStartTime.current = Date.now();
    }

    const elapsed = Date.now() - animationStartTime.current;
    const totalDuration = 24 * 5 * 1000; // 2 minutes total
    const progress = Math.min(elapsed / totalDuration, 1);

    // Calculate current position in the 23-hour range
    const totalHours = allHourData.length - 1;
    const currentPosition = progress * totalHours;
    const hourIndex = Math.floor(currentPosition);
    const t = currentPosition - hourIndex;

    const currentHourData = allHourData[hourIndex];
    const nextHourData = allHourData[Math.min(hourIndex + 1, totalHours)];

    if (currentHourData && nextHourData) {
      // Interpolate and update positions directly
      currentHourData.forEach((coord, idx) => {
        if (nextHourData[idx]) {
          const interpolated = interpolateCoordinates(coord, nextHourData[idx], t);
          
          // Update marker and pillar positions directly
          const marker = markerRefs.current[idx];
          const pillar = pillarRefs.current[idx];
          
          if (marker && pillar) {
            const [lat, lon, alt] = interpolated;
            const basePosition = latLonToVector3(lat, lon, 2.0);
            const topPosition = latLonToVector3(lat, lon, 2.0, alt);
            
            // Update marker position
            marker.position.set(topPosition.x, topPosition.y, topPosition.z);
            
            // Update color based on current altitude
            const newColor = getAltitudeColor(alt, minAlt, maxAlt);
            const colorObj = new THREE.Color(newColor);
            
            // Update velocity-based tail
            const tail = tailRefs.current[idx];
            if (tail) {
              if (lastPositions.current[idx]) {
                // Calculate instantaneous velocity
                const velocity = new THREE.Vector3().subVectors(topPosition, lastPositions.current[idx]);
                
                // Smooth velocity using exponential moving average
                if (!smoothedVelocities.current[idx]) {
                  smoothedVelocities.current[idx] = velocity.clone();
                } else {
                  smoothedVelocities.current[idx].lerp(velocity, 0.15); // Increased smoothing
                }
                
                const smoothedVel = smoothedVelocities.current[idx];
                const speed = smoothedVel.length();
                
                if (speed > 0.00001) {
                  // Direction of movement - cone tip should point in velocity direction
                  const direction = smoothedVel.clone().normalize();
                  
                  // Scale tail length by speed with minimum length
                  const tailLength = Math.max(Math.min(speed * 60, 0.6), 0.08); // Min 0.08, max 0.6
                  
                  // Position tail at balloon position
                  tail.position.copy(topPosition);
                  
                  // Orient tail so cone tip points in direction of movement
                  const up = new THREE.Vector3(0, 1, 0);
                  const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);
                  tail.quaternion.copy(quaternion);
                  
                  // Scale tail length
                  tail.scale.set(1, tailLength, 1);
                  
                  // Update tail color (slightly darker than balloon)
                  const tailMesh = tail.children[0] as THREE.Mesh;
                  if (tailMesh && tailMesh.material instanceof THREE.MeshStandardMaterial) {
                    const darkerColor = colorObj.clone().multiplyScalar(0.7);
                    tailMesh.material.color.copy(darkerColor);
                    tailMesh.material.emissive.copy(darkerColor);
                  }
                  tail.visible = true;
                } else {
                  tail.visible = false;
                }
              }
              
              // Store current position for next frame
              lastPositions.current[idx] = topPosition.clone();
            }
            if (marker.material instanceof THREE.MeshStandardMaterial) {
              marker.material.color.copy(colorObj);
              marker.material.emissive.copy(colorObj);
            }
            if (pillar.material instanceof THREE.MeshStandardMaterial) {
              pillar.material.color.copy(colorObj);
              pillar.material.emissive.copy(colorObj);
            }
            
            // Update outline positions if this balloon is selected
            if (outlineRefs.current[idx]) {
              outlineRefs.current[idx].forEach(outline => {
                if (outline) {
                  outline.position.set(topPosition.x, topPosition.y, topPosition.z);
                }
              });
            }
            
            // Update pillar
            const newPillarHeight = topPosition.distanceTo(basePosition);
            const midpoint = new THREE.Vector3().lerpVectors(basePosition, topPosition, 0.5);
            pillar.position.set(midpoint.x, midpoint.y, midpoint.z);
            
            // Scale pillar based on ratio of new height to original height
            const originalHeight = originalPillarHeights.current[idx] || newPillarHeight;
            const scaleY = newPillarHeight / originalHeight;
            pillar.scale.set(1, scaleY, 1);
            
            // Update rotation
            const direction = new THREE.Vector3().subVectors(topPosition, basePosition).normalize();
            const up = new THREE.Vector3(0, 1, 0);
            const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);
            pillar.quaternion.copy(quaternion);
          }
        }
      });

      // Report progress back to parent (throttled to every 1%)
      const currentPercent = Math.floor(progress * 100); // 0-100 (1% increments)
      if (onAnimationProgress && currentPercent !== lastProgressReport.current) {
        const currentHour = 23 - hourIndex;
        onAnimationProgress(progress, currentHour);
        lastProgressReport.current = currentPercent;
      }
    }
  });

  // Convert lat/lon to 3D coordinates on sphere with altitude
  const latLonToVector3 = (lat: number, lon: number, radius: number, altitude: number = 0) => {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);

    // Exaggerate altitude for visibility (scale factor)
    const altitudeScale = 0.02; // Adjust this to make altitude more/less visible
    const adjustedRadius = radius + (altitude * altitudeScale);

    const x = -(adjustedRadius * Math.sin(phi) * Math.cos(theta));
    const z = adjustedRadius * Math.sin(phi) * Math.sin(theta);
    const y = adjustedRadius * Math.cos(phi);

    return new THREE.Vector3(x, y, z);
  };

  // Memoize markers and trails to prevent recreation
  const markers = useMemo(() => {
    return data.map((coord: number[], idx: number) => {
        const [lat, lon, alt] = coord;
        const basePosition = latLonToVector3(lat, lon, 2.0);
        const topPosition = latLonToVector3(lat, lon, 2.0, alt);
        const color = balloonColors[idx];
        
        // Calculate pillar height and midpoint
        const pillarHeight = topPosition.distanceTo(basePosition);
        const midpoint = new THREE.Vector3().lerpVectors(basePosition, topPosition, 0.5);
        
        // Store original height for scaling calculations
        if (!originalPillarHeights.current[idx]) {
          originalPillarHeights.current[idx] = pillarHeight;
        }
        
        // Calculate rotation to align pillar with surface normal
        const direction = new THREE.Vector3().subVectors(topPosition, basePosition).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);

        return (
          <group key={idx}>
            {/* Velocity-based tail - group to handle offset */}
            <group ref={(el) => { if (el) tailRefs.current[idx] = el as any; }} visible={false}>
              <mesh position={[0, 0.5, 0]}>
                <coneGeometry args={[0.035, 1, 12]} />
                <meshStandardMaterial
                  color="#ffffff"
                  emissive="#ffffff"
                  emissiveIntensity={1.2}
                  metalness={0.3}
                  roughness={0.4}
                />
              </mesh>
            </group>
            
            {/* Pillar showing altitude */}
            {showStems && (
              <mesh 
                ref={(el) => { if (el) pillarRefs.current[idx] = el; }}
                position={midpoint} 
                quaternion={quaternion}
              >
                <cylinderGeometry args={[0.003, 0.003, pillarHeight, 8]} />
                <meshStandardMaterial
                  color={color}
                  transparent
                  opacity={0.7}
                  emissive={color}
                  emissiveIntensity={0.5}
                  metalness={0.8}
                  roughness={0.2}
                />
              </mesh>
            )}
            
            {/* Top marker sphere - clickable */}
            <mesh 
              ref={(el) => { if (el) markerRefs.current[idx] = el; }}
              position={topPosition}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedIndex(idx);
                onMarkerClick(coord, idx);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                document.body.style.cursor = 'default';
              }}
            >
              <sphereGeometry args={[0.035, 20, 20]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={1.2}
                metalness={0.3}
                roughness={0.4}
              />
            </mesh>
            
            {/* Bright white outline for selected balloon */}
            {selectedIndex === idx && (
              <>
                <mesh 
                  position={topPosition}
                  ref={(el) => { 
                    if (el) {
                      if (!outlineRefs.current[idx]) outlineRefs.current[idx] = [];
                      outlineRefs.current[idx][0] = el;
                    }
                  }}
                >
                  <sphereGeometry args={[0.048, 20, 20]} />
                  <meshBasicMaterial
                    color="#ffffff"
                    transparent
                    opacity={1.0}
                    side={THREE.BackSide}
                  />
                </mesh>
                <mesh 
                  position={topPosition}
                  ref={(el) => { 
                    if (el) {
                      if (!outlineRefs.current[idx]) outlineRefs.current[idx] = [];
                      outlineRefs.current[idx][1] = el;
                    }
                  }}
                >
                  <sphereGeometry args={[0.055, 20, 20]} />
                  <meshBasicMaterial
                    color="#ffffff"
                    transparent
                    opacity={0.7}
                    side={THREE.BackSide}
                  />
                </mesh>
                <mesh 
                  position={topPosition}
                  ref={(el) => { 
                    if (el) {
                      if (!outlineRefs.current[idx]) outlineRefs.current[idx] = [];
                      outlineRefs.current[idx][2] = el;
                    }
                  }}
                >
                  <sphereGeometry args={[0.065, 20, 20]} />
                  <meshBasicMaterial
                    color="#ffffff"
                    transparent
                    opacity={0.4}
                    side={THREE.BackSide}
                  />
                </mesh>
              </>
            )}
          </group>
        );
      });
  }, [data, balloonColors, showStems, selectedIndex]);

  // Create starfield background
  const stars = useMemo(() => {
    const starsGeometry = [];
    for (let i = 0; i < 1000; i++) {
      // Generate stars in a shell between radius 10 and 50 to avoid being too close to Earth
      const radius = 10 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);
      
      starsGeometry.push(x, y, z);
    }
    return new Float32Array(starsGeometry);
  }, []);

  return (
    <>
      {/* Starfield background */}
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={stars.length / 3}
            array={stars}
            itemSize={3}
            args={[stars, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.1}
          color="#ffffff"
          sizeAttenuation={true}
          transparent={true}
          opacity={1.0}
        />
      </points>

      {/* Earth sphere with realistic texture */}
      <mesh ref={globeRef}>
        <sphereGeometry args={[2, 64, 64]} />
        <meshStandardMaterial
          map={earthTexture}
          roughness={0.7}
          metalness={0.1}
        />
      </mesh>

      {/* Coordinate markers with altitude */}
      {markers}

      {/* Realistic atmosphere glow effect */}
      <mesh>
        <sphereGeometry args={[2.05, 64, 64]} />
        <meshBasicMaterial
          color="#4a9eff"
          transparent
          opacity={0.06}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Lighting - maximum brightness on all sides */}
      <ambientLight intensity={1.5} />
      <hemisphereLight intensity={0.8} groundColor="#ffffff" />
      <directionalLight position={[5, 3, 5]} intensity={0.6} />
      <directionalLight position={[-5, -3, -5]} intensity={0.6} />
      <directionalLight position={[0, 5, 0]} intensity={0.5} />
      <directionalLight position={[0, -5, 0]} intensity={0.5} />
    </>
  );
}

function Controls({ onChange }: { onChange: () => void }) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  
  useEffect(() => {
    const controls = new OrbitControlsImpl(camera, gl.domElement);
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.zoomSpeed = 0.6;
    controls.panSpeed = 0.5;
    controls.rotateSpeed = 0.4;
    controls.addEventListener('change', onChange);
    controlsRef.current = controls;
    
    return () => {
      controls.removeEventListener('change', onChange);
      controls.dispose();
    };
  }, [camera, gl, onChange]);
  
  useFrame(() => controlsRef.current?.update());
  
  return null;
}

function GlobeWithControls({ data, getAltitudeColor, minAlt, maxAlt, onMarkerClick, allHourData, isAnimating, onAnimationProgress, showStems, onWelcomeChange }: GlobeProps) {
  const [userInteracted, setUserInteracted] = useState(false);
  
  return (
    <>
      <Globe 
        data={data} 
        getAltitudeColor={getAltitudeColor} 
        minAlt={minAlt} 
        maxAlt={maxAlt} 
        onMarkerClick={onMarkerClick}
        allHourData={allHourData}
        isAnimating={isAnimating}
        onAnimationProgress={onAnimationProgress}
        showStems={showStems}
        onWelcomeChange={onWelcomeChange}
      />
      <Controls onChange={() => setUserInteracted(true)} />
    </>
  );
}

export default function GlobeVisualization({ data, getAltitudeColor, minAlt, maxAlt, onMarkerClick, allHourData, isAnimating, onAnimationProgress, showStems }: GlobeProps) {
  const [showWelcome, setShowWelcome] = useState(true);
  const [welcomeOpacity, setWelcomeOpacity] = useState(0);
  
  const handleWelcomeChange = (show: boolean, opacity?: number) => {
    setShowWelcome(show);
    if (opacity !== undefined) {
      setWelcomeOpacity(opacity);
    }
  };
  
  return (
    <div className="h-[800px] w-full rounded-lg overflow-hidden border border-gray-800 bg-black shadow-2xl shadow-cyan-500/10 relative">
      {/* Welcome text overlay */}
      {showWelcome && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
             style={{ opacity: welcomeOpacity, transition: 'opacity 0.1s ease-out' }}>
          <div className="text-white text-6xl font-bold font-mono tracking-wider text-center"
               style={{ textShadow: '0 0 30px rgba(0,0,0,0.9), 0 0 60px rgba(0,0,0,0.7)' }}>
            Welcome to Windbourne's Engineering Challenge
          </div>
        </div>
      )}
      
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
        <GlobeWithControls
          data={data} 
          getAltitudeColor={getAltitudeColor} 
          minAlt={minAlt} 
          maxAlt={maxAlt} 
          onMarkerClick={onMarkerClick}
          allHourData={allHourData}
          isAnimating={isAnimating}
          onAnimationProgress={onAnimationProgress}
          showStems={showStems}
          onWelcomeChange={handleWelcomeChange}
        />
      </Canvas>
    </div>
  );
}
