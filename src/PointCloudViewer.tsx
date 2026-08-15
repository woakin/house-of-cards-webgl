import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const FPS = 30; // Assuming 30 frames per second
const MAX_POINTS = 35000; // Pre-allocate buffer safely for large frames

interface FrameData {
  numPoints: number;
  byteOffset: number;
  floatOffset?: number;
  frameMinX?: number;
  rangeX?: number;
  frameMinY?: number;
  rangeY?: number;
  frameMinZ?: number;
  rangeZ?: number;
}

export function PointCloudViewer({ 
  audioRef,
  isPlaying,
  dataBuffer,
  colors,
  frameDataRef
}: { 
  audioRef: React.RefObject<HTMLAudioElement | null>,
  isPlaying: boolean,
  dataBuffer: ArrayBuffer,
  colors: { colorA: string, colorB: string, colorC: string },
  frameDataRef?: React.MutableRefObject<{ positions: Float32Array; intensities: Float32Array; numPoints: number; frameIndex: number } | null>
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const geomRef = useRef<THREE.BufferGeometry>(null);

  // Parse the binary header to index the frames
  const { frames, floatData, isQuantized } = useMemo(() => {
    if (!dataBuffer) return { frames: [] as FrameData[], floatData: null, isQuantized: false };
    
    console.time('parse_binary');
    const dataview = new DataView(dataBuffer);
    const magicView = new Uint8Array(dataBuffer, 0, 4);
    const isQuant = magicView[0] === 0x48 && magicView[1] === 0x4F && magicView[2] === 0x43 && magicView[3] === 0x51; // 'HOCQ'

    const parsedFrames: FrameData[] = [];
    let parsedFloatData: Float32Array | null = null;

    if (isQuant) {
      const numFrames = dataview.getUint32(4, true);
      let byteOffset = 8;
      for (let i = 0; i < numFrames; i++) {
        const numPoints = dataview.getUint32(byteOffset, true);
        const hOffset = byteOffset + 4;

        const frameMinX = dataview.getFloat32(hOffset, true);
        const frameMaxX = dataview.getFloat32(hOffset + 4, true);
        const frameMinY = dataview.getFloat32(hOffset + 8, true);
        const frameMaxY = dataview.getFloat32(hOffset + 12, true);
        const frameMinZ = dataview.getFloat32(hOffset + 16, true);
        const frameMaxZ = dataview.getFloat32(hOffset + 20, true);

        parsedFrames.push({
          numPoints,
          byteOffset: byteOffset + 28,
          frameMinX,
          rangeX: frameMaxX - frameMinX || 1,
          frameMinY,
          rangeY: frameMaxY - frameMinY || 1,
          frameMinZ,
          rangeZ: frameMaxZ - frameMinZ || 1,
        });
        byteOffset += 28 + numPoints * 8;
      }
    } else {
      const headerView = new Uint32Array(dataBuffer, 0, 1);
      const numFrames = headerView[0];
      
      let byteOffset = 4;
      for (let i = 0; i < numFrames; i++) {
        const numPoints = dataview.getUint32(byteOffset, true);
        parsedFrames.push({
          numPoints,
          byteOffset: byteOffset + 4,
          floatOffset: (byteOffset + 4) / 4
        });
        byteOffset += 4 + numPoints * 16;
      }
      parsedFloatData = new Float32Array(dataBuffer);
    }
    
    console.timeEnd('parse_binary');
    return { frames: parsedFrames, floatData: parsedFloatData, isQuantized: isQuant };
  }, [dataBuffer]);

  // Static initial buffers for geometry attributes
  const initialPositions = useMemo(() => new Float32Array(MAX_POINTS * 3), []);
  const initialIntensities = useMemo(() => new Float32Array(MAX_POINTS * 1), []);

  const dataView = useMemo(() => {
    return dataBuffer ? new DataView(dataBuffer) : null;
  }, [dataBuffer]);

  const u8View = useMemo(() => {
    return dataBuffer ? new Uint8Array(dataBuffer) : null;
  }, [dataBuffer]);

  const u16View = useMemo(() => {
    return dataBuffer ? new Uint16Array(dataBuffer) : null;
  }, [dataBuffer]);

  const currentFrameRef = useRef(-1);

  const shaderMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      colorA: { value: new THREE.Color('#4facfe') },
      colorB: { value: new THREE.Color('#00f2fe') },
      colorC: { value: new THREE.Color('#f093fb') },
      pointSize: { value: 2.8 },
    },
    vertexShader: `
      attribute float intensity;
      varying float vIntensity;
      varying float vZ;
      uniform float pointSize;
      
      void main() {
        vIntensity = intensity;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vZ = position.z;
        // Clamp point size to guarantee crisp visibility at all camera distances
        gl_PointSize = clamp(pointSize * (160.0 / -mvPosition.z), 1.5, 12.0);
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
        float normalizedInt = clamp(vIntensity / 40.0, 0.0, 1.0);
        
        vec2 xy = gl_PointCoord.xy - vec2(0.5);
        float ll = length(xy);
        if (ll > 0.5) discard;
        
        float t = clamp((vZ + 250.0) / 200.0, 0.0, 1.0);
        
        vec3 mixColor;
        if (t < 0.5) {
            mixColor = mix(colorA, colorB, t * 2.0);
        } else {
            mixColor = mix(colorB, colorC, (t - 0.5) * 2.0);
        }
        
        // Smooth anti-aliased circular particle edge
        float alpha = smoothstep(0.5, 0.0, ll);
        gl_FragColor = vec4(mixColor * (normalizedInt * 0.85 + 0.45), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  useFrame(() => {
    if (!audioRef.current || frames.length === 0 || !dataBuffer || !dataView || !geomRef.current) return;
    
    const time = (!isPlaying && audioRef.current.currentTime === 0) 
      ? 14.0 
      : audioRef.current.currentTime;

    let targetFrame = Math.floor(time * FPS);
    
    if (targetFrame >= frames.length) {
      targetFrame = frames.length - 1;
    }
    if (targetFrame < 0) {
      targetFrame = 0;
    }
    
    if (targetFrame !== currentFrameRef.current) {
      const frame = frames[targetFrame];
      if (!frame) return;
      
      const numPoints = frame.numPoints;
      const pointsToProcess = Math.min(numPoints, MAX_POINTS);

      const posAttr = geomRef.current.attributes.position;
      const intAttr = geomRef.current.attributes.intensity;
      if (!posAttr || !intAttr) return;

      const positions = posAttr.array as Float32Array;
      const intensities = intAttr.array as Float32Array;
      
      if (isQuantized && frame.frameMinX !== undefined && u16View && u8View) {
        const frameMinX = frame.frameMinX;
        const frameMinY = frame.frameMinY!;
        const frameMinZ = frame.frameMinZ!;
        const rangeX = frame.rangeX!;
        const rangeY = frame.rangeY!;
        const rangeZ = frame.rangeZ!;
        
        const pointsStart = frame.byteOffset;
        const inv65535 = 1 / 65535;

        for (let i = 0; i < pointsToProcess; i++) {
          const pOffset = pointsStart + i * 8;
          const u16Idx = pOffset >> 1;
          const qX = u16View[u16Idx];
          const qY = u16View[u16Idx + 1];
          const qZ = u16View[u16Idx + 2];
          const intensity = u8View[pOffset + 6];

          positions[i * 3] = frameMinX + (qX * inv65535) * rangeX;
          positions[i * 3 + 1] = frameMinY + (qY * inv65535) * rangeY;
          positions[i * 3 + 2] = frameMinZ + (qZ * inv65535) * rangeZ;

          intensities[i] = intensity;
        }
      } else if (floatData && frame.floatOffset !== undefined) {
        const frameStart = frame.floatOffset;
        for (let i = 0; i < pointsToProcess; i++) {
          const floatIdx = frameStart + i * 4;
          
          positions[i * 3] = floatData[floatIdx];
          positions[i * 3 + 1] = floatData[floatIdx + 1];
          positions[i * 3 + 2] = floatData[floatIdx + 2];
          
          intensities[i] = floatData[floatIdx + 3];
        }
      }
      
      posAttr.needsUpdate = true;
      intAttr.needsUpdate = true;
      geomRef.current.setDrawRange(0, pointsToProcess);
      
      currentFrameRef.current = targetFrame;

      if (frameDataRef) {
        frameDataRef.current = {
          positions,
          intensities,
          numPoints: pointsToProcess,
          frameIndex: targetFrame + 1,
        };
      }
    }
  });

  useEffect(() => {
    const geom = geomRef.current;
    return () => {
      shaderMaterial.dispose();
      if (geom) {
        geom.dispose();
      }
    };
  }, [shaderMaterial]);

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
          args={[initialPositions, 3]}
        />
        <bufferAttribute 
          attach="attributes-intensity"
          args={[initialIntensities, 1]}
        />
      </bufferGeometry>
      <primitive object={shaderMaterial} attach="material" />
    </points>
  );
}
