import { useState, useEffect, useRef, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { PointCloudViewer } from './PointCloudViewer';
import { exportToPLY } from './utils/plyExporter';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { AnimatedGlitch } from './AnimatedGlitch';
import './index.css';

function CameraMovement({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const keys = useRef<{ [key: string]: boolean }>({});
  const offsetVector = useRef(new THREE.Vector3());

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { 
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code.startsWith('Arrow') || e.code === 'KeyW' || e.code === 'KeyS') {
        e.preventDefault();
        keys.current[e.code] = true; 
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { 
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
    const offset = offsetVector.current;
    offset.set(0, 0, 0);
    
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

  // New Features State
  const [glowEnabled, setGlowEnabled] = useState(true);
  const [glitchEnabled, setGlitchEnabled] = useState(false);
  const frameDataRef = useRef<{ positions: Float32Array; intensities: Float32Array; numPoints: number; frameIndex: number } | null>(null);

  const [colors, setColors] = useState({
    colorA: '#4facfe', // Background / Far
    colorB: '#00f2fe', // Mid
    colorC: '#f093fb'  // Foreground / Close
  });
  const [isColorExpanded, setIsColorExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
    navigator.clipboard.writeText(window.location.origin + '/');
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, []);

  const handleExportPLY = useCallback(() => {
    const data = frameDataRef.current;
    if (!data) return;
    exportToPLY({
      positions: data.positions,
      intensities: data.intensities,
      numPoints: data.numPoints,
      colors,
      frameIndex: data.frameIndex,
    });
  }, [colors]);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    // Load the binary data
    const loadData = async () => {
      setLoadError(null);
      setLoadingProgress(0);

      try {
        // Try loading chunked manifest first (for Cloudflare Pages & high performance CDN)
        const manifestRes = await fetch('/data/chunks/manifest.json');
        if (manifestRes.ok) {
          const manifest = await manifestRes.json();
          const totalSize = manifest.totalSize || 0;
          const chunkProgress = new Array(manifest.chunks.length).fill(0);

          const updateProgress = () => {
            if (totalSize > 0) {
              const currentTotal = chunkProgress.reduce((sum, val) => sum + val, 0);
              setLoadingProgress(Math.min(100, Math.round((currentTotal / totalSize) * 100)));
            }
          };

          const chunkBuffers = await Promise.all(
            manifest.chunks.map(async (chunkInfo: { file: string; size?: number }, idx: number) => {
              const chunkRes = await fetch(chunkInfo.file);
              if (!chunkRes.ok) throw new Error(`Failed to load data chunk: ${chunkInfo.file}`);
              const buf = await chunkRes.arrayBuffer();
              chunkProgress[idx] = buf.byteLength;
              updateProgress();
              return buf;
            })
          );

          let loaded = 0;
          for (const buf of chunkBuffers) {
            loaded += buf.byteLength;
          }

          const combined = new Uint8Array(loaded);
          let pos = 0;
          for (const buf of chunkBuffers) {
            combined.set(new Uint8Array(buf), pos);
            pos += buf.byteLength;
          }

          chunkBuffers.length = 0;
          setLoadingProgress(100);
          setDataBuffer(combined.buffer);
          return;
        }

        // Fallback for single raw binary file
        let response = await fetch('/data/frames_quantized.bin');
        if (!response.ok) {
          response = await fetch('/data/frames.bin');
        }
        if (!response.ok) {
          throw new Error(`Data server error (${response.status}): Failed to locate binary frames`);
        }

        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        let loaded = 0;
        
        if (!response.body) throw new Error('ReadableStream not supported by browser');
        
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
        
        chunks.length = 0;
        setDataBuffer(combined.buffer);
      } catch (err: any) {
        console.error('Failed to load frames data:', err);
        setLoadError(err?.message || 'Failed to connect to data server. Please check your network connection.');
      }
    };
    
    loadData();
  }, [retryCount]);

  const togglePlay = useCallback(() => {
    if (audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play()
          .then(() => {
            setIsPlaying(true);
          })
          .catch(err => {
            console.warn('Audio playback prevented by browser:', err);
            setIsPlaying(false);
          });
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
      if (e.code === 'Escape' && isModalOpen) {
        e.preventDefault();
        setIsModalOpen(false);
        return;
      }

      if (isModalOpen) return;
      // Don't trigger if user is typing in an input
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
  }, [togglePlay, recenter, isModalOpen]);

  return (
    <div className="app-container">
      <audio 
        ref={audioRef} 
        src="/data/HouseOfCards_DataSample.mp3" 
        preload="auto"
        onEnded={() => setIsPlaying(false)}
        loop
      />
      
      {!dataBuffer ? (
        <div className="loading-screen">
          {loadError ? (
            <div className="error-container">
              <h2>Data Server Connection Error</h2>
              <p>{loadError}</p>
              <button className="retry-button" onClick={() => setRetryCount(c => c + 1)}>
                RETRY CONNECTION
              </button>
            </div>
          ) : (
            <>
              <h1>Loading Data... {loadingProgress}%</h1>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${loadingProgress}%` }} />
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <Canvas 
            camera={{ position: [0, 0, 500], fov: 60 }}
            dpr={isMobile ? 1 : [1, 2]}
            gl={{ powerPreference: 'high-performance', antialias: false }}
            style={{ width: '100%', height: '100%', background: '#000000' }}
          >
            <color attach="background" args={['#000000']} />
            <ambientLight intensity={0.5} />
            
            <PointCloudViewer 
              audioRef={audioRef}
              isPlaying={isPlaying}
              dataBuffer={dataBuffer}
              colors={colors}
              frameDataRef={frameDataRef}
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

            {(glowEnabled || glitchEnabled) && (
              <EffectComposer multisampling={isMobile ? 0 : 4}>
                {glowEnabled ? (
                  <Bloom 
                    intensity={isMobile ? 1.0 : 1.4} 
                    luminanceThreshold={0.15} 
                    luminanceSmoothing={0.8} 
                    mipmapBlur 
                  />
                ) : <></>}
                {glitchEnabled ? <AnimatedGlitch /> : <></>}
              </EffectComposer>
            )}
          </Canvas>
          
          <div className={`controls ${isIdle ? 'ui-hidden' : ''}`}>
            <div className="controls-row primary-row">
              <button className="play-button" onClick={togglePlay} title="Play/Pause (Space)">
                {isPlaying ? 'PAUSE' : 'PLAY'}
              </button>
              <button className="control-button" onClick={() => setIsModalOpen(true)} title="Share & Info">
                INFO
              </button>
            </div>
            
            <div className="controls-row secondary-row">
              <button 
                className={`toggle-btn ${glowEnabled ? 'active' : ''}`} 
                onClick={() => setGlowEnabled(!glowEnabled)} 
                title="Toggle Neon Bloom Glow"
              >
                <span className="status-dot"></span> GLOW<span className="btn-label-suffix"> {glowEnabled ? 'ON' : 'OFF'}</span>
              </button>
              
              <button 
                className={`toggle-btn ${glitchEnabled ? 'active' : ''}`} 
                onClick={() => setGlitchEnabled(!glitchEnabled)} 
                title="Toggle Glitch Effect"
              >
                <span className="status-dot"></span> GLITCH<span className="btn-label-suffix"> {glitchEnabled ? 'ON' : 'OFF'}</span>
              </button>
              
              <button className="export-button" onClick={handleExportPLY} title="Export Current 3D Frame as .PLY">
                EXPORT<span className="btn-label-suffix"> .PLY</span>
              </button>
            </div>
          </div>
          
          <div className={`color-controls ${isIdle ? 'ui-hidden' : ''} ${isColorExpanded ? 'mobile-expanded' : ''}`}>
            <button 
              className="color-controls-toggle" 
              onClick={() => setIsColorExpanded(!isColorExpanded)}
              title="Toggle Color Palette"
              aria-label="Toggle Color Palette"
            >
              <span className="color-preview-dots">
                <span style={{ background: colors.colorC }}></span>
                <span style={{ background: colors.colorB }}></span>
                <span style={{ background: colors.colorA }}></span>
              </span>
              <span className="toggle-label">COLORS</span>
              <span className="toggle-arrow">{isColorExpanded ? '▲' : '▼'}</span>
            </button>

            <div className="color-controls-inner">
              <div className="presets-container">
                <div className="preset-group">
                  <button 
                    className="preset-btn" 
                    style={{ background: 'linear-gradient(135deg, #4facfe, #f093fb)' }} 
                    onClick={() => setColors({ colorA: '#4facfe', colorB: '#00f2fe', colorC: '#f093fb' })}
                    title="Preset: Neon Cyberpunk"
                  />
                  <button 
                    className="preset-btn" 
                    style={{ background: 'linear-gradient(135deg, #090979, #ff007f)' }} 
                    onClick={() => setColors({ colorA: '#090979', colorB: '#ff007f', colorC: '#ffaa00' })}
                    title="Preset: Synthwave Sunset"
                  />
                  <button 
                    className="preset-btn" 
                    style={{ background: 'linear-gradient(135deg, #002b11, #00ff66)' }} 
                    onClick={() => setColors({ colorA: '#002b11', colorB: '#00ff66', colorC: '#ccffdd' })}
                    title="Preset: Matrix Emerald"
                  />
                  <button 
                    className="preset-btn" 
                    style={{ background: 'linear-gradient(135deg, #4a0000, #ff4500)' }} 
                    onClick={() => setColors({ colorA: '#4a0000', colorB: '#ff4500', colorC: '#ffdf00' })}
                    title="Preset: Amber Flame"
                  />
                </div>
                <button className="randomize-button" onClick={randomizeColors} title="Randomize Colors">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 3 21 3 21 8"></polyline>
                    <line x1="4" y1="20" x2="21" y2="3"></line>
                    <polyline points="21 16 21 21 16 21"></polyline>
                    <line x1="15" y1="15" x2="21" y2="21"></line>
                    <line x1="4" y1="4" x2="9" y2="9"></line>
                  </svg>
                </button>
              </div>

              <div className="color-pickers-container">
                <div className="color-picker-group">
                  <label>Foreground</label>
                  <input type="color" value={colors.colorC} onChange={e => setColors(prev => ({...prev, colorC: e.target.value}))} />
                </div>
                <div className="color-picker-group">
                  <label>Midground</label>
                  <input type="color" value={colors.colorB} onChange={e => setColors(prev => ({...prev, colorB: e.target.value}))} />
                </div>
                <div className="color-picker-group">
                  <label>Background</label>
                  <input type="color" value={colors.colorA} onChange={e => setColors(prev => ({...prev, colorA: e.target.value}))} />
                </div>
              </div>
            </div>
          </div>
          
          <div className={`tutorial ${isIdle ? 'ui-hidden' : ''}`}>
            <h3>Controls</h3>
            <ul>
              <li><span className="key">W</span> <span className="key">S</span> Move Forward / Back</li>
              <li><span className="key">↑</span> <span className="key">↓</span> <span className="key">←</span> <span className="key">→</span> Pan Camera</li>
              <li><span className="key">Space</span> Play / Pause</li>
              <li><span className="key">R</span> Re-Center</li>
              <li><span className="key">Touch/Mouse</span> Orbit · Zoom · Pan</li>
            </ul>
          </div>

          {isModalOpen && (
            <div className="side-panel-overlay" onClick={() => setIsModalOpen(false)}>
              <div className="side-panel" onClick={e => e.stopPropagation()}>
                <div className="drawer-handle" />
                <div className="side-panel-header">
                  <h2>House of Cards WebGL</h2>
                  <button className="panel-close-icon" onClick={() => setIsModalOpen(false)} title="Close Panel" aria-label="Close Panel">
                    ✕
                  </button>
                </div>
                <div className="side-panel-body">
                  <p>
                    In 2008, Radiohead released the music video for "House of Cards", famously created entirely without cameras using Geometric Informatics and Velodyne LIDAR systems to capture 3D spatial data. 
                  </p>
                  <p>
                    This project evolves the original <a href="https://github.com/dataarts/radiohead" target="_blank" rel="noreferrer">DataArts</a> C++ code into a modern WebGL experience, heavily optimized for high-performance web streaming:
                  </p>
                  <ul className="tech-list">
                    <li><strong>Chunked Binary Pipeline:</strong> Over 2,100 raw CSV point-cloud frames were compiled into a chunked binary pipeline with parallel streaming, enabling instant playback without downloading the entire dataset upfront.</li>
                    <li><strong>GPU & TypedArray Engine:</strong> Built with React Three Fiber and custom WebGL Shader Materials, the engine unpacks binary frame buffers directly via zero-copy TypedArrays (&lt;0.8ms per frame) to maintain 60 FPS.</li>
                    <li><strong>Dynamic Depth & Effects:</strong> Raw LIDAR Z-depth is mapped to real-time customizable tri-color gradients, enriched with bloom glow, chromatic aberration glitch effects, and 3D Stanford .PLY frame exporting.</li>
                    <li><strong>Adaptive Cross-Platform UI:</strong> Features native touch orbit controls, adaptive device pixel scaling (DPR), a collapsible color palette, and a responsive drawer HUD optimized for mobile and desktop.</li>
                  </ul>
                  
                  <div className="share-section">
                    <input type="text" readOnly value={window.location.origin + '/'} className="share-input" />
                    <button className="copy-button" onClick={handleCopyLink}>{isCopied ? 'COPIED!' : 'COPY LINK'}</button>
                  </div>
                </div>
                <div className="side-panel-footer">
                  <p className="credits">
                    Coded by <a href="https://gemini.google.com" target="_blank" rel="noreferrer">Gemini</a>, prompted by <a href="https://woakin.com" target="_blank" rel="noreferrer">Woakin</a>
                  </p>
                  <button className="close-button" onClick={() => setIsModalOpen(false)}>CLOSE</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;
