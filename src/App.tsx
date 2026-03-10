import { useState, useEffect, useRef, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { PointCloudViewer } from './PointCloudViewer';

function CameraMovement({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const keys = useRef<{ [key: string]: boolean }>({});

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { 
      if (e.code.startsWith('Arrow') || e.code === 'KeyW' || e.code === 'KeyS') {
        e.preventDefault();
        keys.current[e.code] = true; 
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { 
      if (e.code.startsWith('Arrow') || e.code === 'KeyW' || e.code === 'KeyS') {
        e.preventDefault();
        keys.current[e.code] = false; 
      }
    };
    
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp, { passive: false });
    
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useFrame((_state, delta) => {
    if (!controlsRef.current) return;
    const controls = controlsRef.current;
    const camera = controls.object;
    
    // FPS-like fluid movement: 500 units per second
    const speed = 500 * delta; 
    const offset = new THREE.Vector3();
    
    if (keys.current['ArrowLeft']) offset.x -= 1;
    if (keys.current['ArrowRight']) offset.x += 1;
    if (keys.current['ArrowUp']) offset.y += 1;
    if (keys.current['ArrowDown']) offset.y -= 1;
    if (keys.current['KeyW']) offset.z -= 1;
    if (keys.current['KeyS']) offset.z += 1;
    
    if (offset.lengthSq() > 0) {
      offset.normalize().multiplyScalar(speed);
      // apply the camera's rotation to the offset vector
      offset.applyQuaternion(camera.quaternion);
      
      camera.position.add(offset);
      controls.target.add(offset);
      controls.update();
    }
  });

  return null;
}

function App() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const [dataBuffer, setDataBuffer] = useState<ArrayBuffer | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [colors, setColors] = useState({
    colorA: '#4facfe', // Background / Far
    colorB: '#00f2fe', // Mid
    colorC: '#f093fb'  // Foreground / Close
  });

  const [isIdle, setIsIdle] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    let timeoutId: number;
    const resetIdle = (e?: Event) => {
      setIsIdle(false);
      // Determine if it's a direct interaction (not just a hovering mouse)
      if (e && ['mousedown', 'keydown', 'touchstart', 'wheel'].includes(e.type)) {
        setHasInteracted(true);
      }
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => setIsIdle(true), 3000);
    };

    resetIdle();
    window.addEventListener('mousemove', resetIdle);
    window.addEventListener('keydown', resetIdle);
    window.addEventListener('touchstart', resetIdle);
    window.addEventListener('wheel', resetIdle);
    window.addEventListener('mousedown', resetIdle);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousemove', resetIdle);
      window.removeEventListener('keydown', resetIdle);
      window.removeEventListener('touchstart', resetIdle);
      window.removeEventListener('wheel', resetIdle);
      window.removeEventListener('mousedown', resetIdle);
    };
  }, []);

  const randomizeColors = useCallback(() => {
    const hueA = Math.floor(Math.random() * 360);
    const hueB = (hueA + 120 + Math.random() * 60) % 360;
    const hueC = (hueB + 120 + Math.random() * 60) % 360;
    
    // Convert HSL to HEX helper (assuming 100% Saturation, 50% Lightness for vibrant neon)
    const l = 0.5;
    const s = 1.0;
    const h2k = (h: number) => {
      const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const color = l - s * Math.min(l, 1 - l) * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    };

    setColors({ colorA: h2k(hueA), colorB: h2k(hueB), colorC: h2k(hueC) });
  }, []);

  const [isCopied, setIsCopied] = useState(false);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText('https://github.com/woakin/house-of-cards-webgl');
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, []);

  useEffect(() => {
    // Load the binary data
    const loadData = async () => {
      try {
        const response = await fetch('/data/frames.bin');
        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        
        let loaded = 0;
        
        if (!response.body) return;
        
        const reader = response.body.getReader();
        const chunks = [];
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          if (value) {
            chunks.push(value);
            loaded += value.length;
            if (total > 0) {
              setLoadingProgress(Math.round((loaded / total) * 100));
            }
          }
        }
        
        const combined = new Uint8Array(loaded);
        let pos = 0;
        for (const chunk of chunks) {
          combined.set(chunk, pos);
          pos += chunk.length;
        }
        
        setDataBuffer(combined.buffer);
      } catch (err) {
        console.error('Failed to load frames.bin', err);
      }
    };
    
    loadData();
  }, []);

  const togglePlay = useCallback(() => {
    if (audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play();
        setIsPlaying(true);
      } else {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, []);

  const recenter = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input (not applicable here but good practice)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      if (e.code === 'Space') {
        e.preventDefault(); // Prevent page scrolling
        togglePlay();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        recenter();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, recenter]);

  return (
    <div className="app-container">
      <audio 
        ref={audioRef} 
        src="/data/HouseOfCards_DataSample.mp3" 
        onEnded={() => setIsPlaying(false)}
        loop
      />
      
      {!dataBuffer ? (
        <div className="loading-screen">
          <h1>Loading Data... {loadingProgress}%</h1>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${loadingProgress}%` }} />
          </div>
        </div>
      ) : (
        <>
          <Canvas 
            camera={{ position: [0, 0, 500], fov: 60 }}
            style={{ width: '100vw', height: '100vh', background: '#000' }}
          >
            <color attach="background" args={['#050510']} />
            <ambientLight intensity={0.5} />
            
            {/* The point cloud */}
            <PointCloudViewer 
              audioRef={audioRef} 
              isPlaying={isPlaying} 
              dataBuffer={dataBuffer} 
              colors={colors}
            />
            
            <OrbitControls 
              ref={controlsRef}
              enableDamping 
              dampingFactor={0.05} 
              minDistance={150} 
              maxDistance={2000} 
              makeDefault
              autoRotate={!isPlaying && !hasInteracted}
              autoRotateSpeed={2.0}
            />
            
            {/* Fluid keyboard movement component */}
            <CameraMovement controlsRef={controlsRef} />
            {/* <Stats /> */}
          </Canvas>
          
          <div className={`controls ${isIdle ? 'ui-hidden' : ''}`}>
            <button className="play-button" onClick={togglePlay} title="Play/Pause (Space)">
              {isPlaying ? 'PAUSE' : 'PLAY'}
            </button>
            <button className="control-button" onClick={() => setIsModalOpen(true)} title="Share this Visualization">
              SHARE
            </button>
            <div className="info">
              <p>House of Cards WebGL</p>
              <p className="subtitle">
                Original LIDAR data by <a href="https://github.com/dataarts/radiohead" target="_blank" rel="noreferrer">Radiohead / DataArts</a>
              </p>
            </div>
          </div>
          
          <div className={`color-controls ${isIdle ? 'ui-hidden' : ''}`}>
            <div className="color-picker-group">
              <label>Foreground</label>
              <input type="color" value={colors.colorC} onChange={e => setColors({...colors, colorC: e.target.value})} />
            </div>
            <div className="color-picker-group">
              <label>Midground</label>
              <input type="color" value={colors.colorB} onChange={e => setColors({...colors, colorB: e.target.value})} />
            </div>
            <div className="color-picker-group">
              <label>Background</label>
              <input type="color" value={colors.colorA} onChange={e => setColors({...colors, colorA: e.target.value})} />
            </div>
            <button className="randomize-button" onClick={randomizeColors} title="Randomize Colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 3 21 3 21 8"></polyline>
                <line x1="4" y1="20" x2="21" y2="3"></line>
                <polyline points="21 16 21 21 16 21"></polyline>
                <line x1="15" y1="15" x2="21" y2="21"></line>
                <line x1="4" y1="4" x2="9" y2="9"></line>
              </svg>
            </button>
          </div>
          
          <div className={`tutorial ${isIdle ? 'ui-hidden' : ''}`}>
            <h3>Controls</h3>
            <ul>
              <li><span className="key">W</span> <span className="key">S</span> Move Forward / Back</li>
              <li><span className="key">↑</span> <span className="key">↓</span> <span className="key">←</span> <span className="key">→</span> Pan Camera</li>
              <li><span className="key">Space</span> Play / Pause</li>
              <li><span className="key">R</span> Re-Center</li>
              <li><span className="key">Mouse</span> Orbit / Zoom</li>
            </ul>
          </div>

          {isModalOpen && (
            <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
              <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h2>House of Cards WebGL</h2>
                <div className="modal-body">
                  <p>
                    In 2008, Radiohead released the music video for "House of Cards", famously created entirely without cameras using Geometric Informatics and Velodyne LIDAR systems to capture 3D spatial data. 
                  </p>
                  <p>
                    This project evolves the original <a href="https://github.com/dataarts/radiohead" target="_blank" rel="noreferrer">DataArts</a> C++ code into a modern WebGL experience, heavily optimized for the web:
                  </p>
                  <ul className="tech-list">
                    <li><strong>Data Architecture:</strong> Over 2,100 raw CSV point-cloud frames were parsed via a custom Node.js pipeline and compiled into a single heavily optimized 410MB Binary ArrayBuffer, enabling instant streaming in the browser.</li>
                    <li><strong>GPU-Accelerated Rendering:</strong> Built with React Three Fiber, the engine preallocates a static geometry matrix and iteratively streams the raw byte-data into a custom WebGL Shader Material operating at 60 FPS.</li>
                    <li><strong>Dynamic Depth Shading:</strong> The classic monochrome data is enriched via a custom vertex and fragment shader. A mathematical clamping algorithm perfectly maps the raw LIDAR Z-depth (ranging specifically from -250 to -50 units) to a real-time, user-customizable interpolating color gradient.</li>
                  </ul>
                  
                  <div className="share-section">
                    <input type="text" readOnly value="https://github.com/woakin/house-of-cards-webgl" className="share-input" />
                    <button className="copy-button" onClick={handleCopyLink}>{isCopied ? 'COPIED!' : 'COPY LINK'}</button>
                  </div>
                </div>
                <p className="credits">
                  Coded by <a href="https://gemini.google.com" target="_blank" rel="noreferrer">Gemini</a>, prompted by <a href="https://woakin.com" target="_blank" rel="noreferrer">Woakin</a>
                </p>
                <button className="close-button" onClick={() => setIsModalOpen(false)}>CLOSE</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;
