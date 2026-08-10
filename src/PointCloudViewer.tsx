import { useState, useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const FPS = 30; // Assuming 30 frames per second
const MAX_POINTS = 20000; // Pre-allocate buffer

interface FrameData {
  numPoints: number;
  byteOffset: number;
  floatOffset?: number;
  headerOffset?: number;
}

interface QuantMetadata {
  isQuantized: boolean;
}

export function PointCloudViewer({ 
  audioRef,
  isPlaying,
  dataBuffer,
  colors
}: { 
  audioRef: React.RefObject<HTMLAudioElement | null>,
  isPlaying: boolean,
  dataBuffer: ArrayBuffer,
  colors: { colorA: string, colorB: string, colorC: string }
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const geomRef = useRef<THREE.BufferGeometry>(null);

  // Parse the binary header to index the frames
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [floatData, setFloatData] = useState<Float32Array | null>(null);
  const [quantMeta, setQuantMeta] = useState<QuantMetadata | null>(null);
  
  useEffect(() => {
    if (!dataBuffer) return;
    
    console.time('parse_binary');
    const dataview = new DataView(dataBuffer);
    const magicView = new Uint8Array(dataBuffer, 0, 4);
    const isQuant = magicView[0] === 0x48 && magicView[1] === 0x4F && magicView[2] === 0x43 && magicView[3] === 0x51; // 'HOCQ'

    if (isQuant) {
      const numFrames = dataview.getUint32(4, true);
      setQuantMeta({ isQuantized: true });

      let byteOffset = 8;
      const parsedFrames: FrameData[] = [];
      for (let i = 0; i < numFrames; i++) {
        const numPoints = dataview.getUint32(byteOffset, true);
        parsedFrames.push({
          numPoints,
          byteOffset: byteOffset + 28,
          headerOffset: byteOffset + 4,
        });
        byteOffset += 28 + numPoints * 8;
      }
      setFrames(parsedFrames);
    } else {
      setQuantMeta(null);
      const headerView = new Uint32Array(dataBuffer, 0, 1);
      const numFrames = headerView[0];
      
      let byteOffset = 4;
      const parsedFrames: FrameData[] = [];
      
      for (let i = 0; i < numFrames; i++) {
        const numPoints = dataview.getUint32(byteOffset, true);
        parsedFrames.push({
          numPoints,
          byteOffset: byteOffset + 4,
          floatOffset: (byteOffset + 4) / 4
        });
        byteOffset += 4 + numPoints * 16;
      }
      
      setFrames(parsedFrames);
      setFloatData(new Float32Array(dataBuffer));
    }
    
    console.timeEnd('parse_binary');
  }, [dataBuffer]);

  // Pre-allocate geometry attributes
  const [positions, intensities] = useMemo(() => {
    return [
      new Float32Array(MAX_POINTS * 3),
      new Float32Array(MAX_POINTS * 1),
    ];
  }, []);

  const [currentFrame, setCurrentFrame] = useState(-1);

  useFrame(() => {
    if (!audioRef.current || frames.length === 0 || !dataBuffer) return;
    
    const time = (!isPlaying && audioRef.current.currentTime === 0) 
      ? 14.0 
      : audioRef.current.currentTime;

    let targetFrame = Math.floor(time * FPS);
    
    if (targetFrame >= frames.length) {
      targetFrame = frames.length - 1;
    }
    
    if (targetFrame !== currentFrame) {
      const frame = frames[targetFrame];
      const numPoints = frame.numPoints;
      
      if (quantMeta && quantMeta.isQuantized && frame.headerOffset !== undefined) {
        const dataview = new DataView(dataBuffer);
        const hOffset = frame.headerOffset;
        
        const frameMinX = dataview.getFloat32(hOffset, true);
        const frameMaxX = dataview.getFloat32(hOffset + 4, true);
        const frameMinY = dataview.getFloat32(hOffset + 8, true);
        const frameMaxY = dataview.getFloat32(hOffset + 12, true);
        const frameMinZ = dataview.getFloat32(hOffset + 16, true);
        const frameMaxZ = dataview.getFloat32(hOffset + 20, true);
        
        const rangeX = frameMaxX - frameMinX || 1;
        const rangeY = frameMaxY - frameMinY || 1;
        const rangeZ = frameMaxZ - frameMinZ || 1;
        
        const pointsStart = frame.byteOffset;

        let pointIdx = 0;
        for (let i = 0; i < numPoints; i++) {
          const pOffset = pointsStart + i * 8;
          const qX = dataview.getUint16(pOffset, true);
          const qY = dataview.getUint16(pOffset + 2, true);
          const qZ = dataview.getUint16(pOffset + 4, true);
          const intensity = dataview.getUint8(pOffset + 6);

          positions[pointIdx * 3] = frameMinX + (qX / 65535) * rangeX;
          positions[pointIdx * 3 + 1] = frameMinY + (qY / 65535) * rangeY;
          positions[pointIdx * 3 + 2] = frameMinZ + (qZ / 65535) * rangeZ;

          intensities[pointIdx] = intensity;

          pointIdx++;
        }
      } else if (floatData && frame.floatOffset !== undefined) {
        const frameStart = frame.floatOffset;
        let pointIdx = 0;
        for (let i = 0; i < numPoints; i++) {
          const floatIdx = frameStart + i * 4;
          
          positions[pointIdx * 3] = floatData[floatIdx];
          positions[pointIdx * 3 + 1] = floatData[floatIdx + 1];
          positions[pointIdx * 3 + 2] = floatData[floatIdx + 2];
          
          intensities[pointIdx] = floatData[floatIdx + 3];
          
          pointIdx++;
        }
      }
      
      if (geomRef.current) {
        geomRef.current.attributes.position.needsUpdate = true;
        geomRef.current.attributes.intensity.needsUpdate = true;
        geomRef.current.setDrawRange(0, numPoints);
      }
      
      setCurrentFrame(targetFrame);
    }
  });

  const shaderMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      colorA: { value: new THREE.Color(colors.colorA) },
      colorB: { value: new THREE.Color(colors.colorB) },
      colorC: { value: new THREE.Color(colors.colorC) },
      pointSize: { value: 2.2 },
    },
    vertexShader: `
      attribute float intensity;
      varying float vIntensity;
      varying float vZ;
      uniform float pointSize;
      
      void main() {
        vIntensity = intensity;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        
        // Pass original Z position to fragment shader for depth coloring
        vZ = position.z;
        
        gl_PointSize = pointSize * (100.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 colorA;
      uniform vec3 colorB;
      uniform vec3 colorC;
      
      varying float vIntensity;
      varying float vZ;
      
      void main() {
        // Map intensity (assume typically 0..255 or 0..1, lets normalize roughly if it's 0-255)
        // From looking at the CSV, intensity might be like 15-40, so let's scale it.
        float normalizedInt = clamp(vIntensity / 40.0, 0.0, 1.0);
        
        // Soft circular point
        vec2 xy = gl_PointCoord.xy - vec2(0.5);
        float ll = length(xy);
        if (ll > 0.5) discard;
        
        // Create depth-based gradient
        // Based on the raw binary data, the face bounds are mostly between Z = -250 and Z = -50.
        // We'll normalize this range to 0.0 - 1.0
        float t = clamp((vZ + 250.0) / 200.0, 0.0, 1.0);
        
        // Mix colors based on depth (Z)
        vec3 mixColor;
        if (t < 0.5) {
            // Smoothly mix Background (A) and Midground (B)
            mixColor = mix(colorA, colorB, t * 2.0);
        } else {
            // Smoothly mix Midground (B) and Foreground (C)
            mixColor = mix(colorB, colorC, (t - 0.5) * 2.0);
        }
        
        float alpha = (0.5 - ll) * 2.5; // Slightly harder edge for better definition
        gl_FragColor = vec4(mixColor * (normalizedInt * 0.8 + 0.5), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []); // Keep material instance the same, we'll update uniforms below

  useEffect(() => {
    shaderMaterial.uniforms.colorA.value.set(colors.colorA);
    shaderMaterial.uniforms.colorB.value.set(colors.colorB);
    shaderMaterial.uniforms.colorC.value.set(colors.colorC);
  }, [colors, shaderMaterial]);

  if (frames.length === 0) return null;

  return (
    <points ref={pointsRef} rotation={[0, 0, Math.PI]} position={[80, 150, 0]}>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute 
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute 
          attach="attributes-intensity"
          args={[intensities, 1]}
        />
      </bufferGeometry>
      <primitive object={shaderMaterial} attach="material" />
    </points>
  );
}
