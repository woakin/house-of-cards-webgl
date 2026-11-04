import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const FPS = 30; // Assuming 30 frames per second
const MAX_POINTS = 15000; // Dataset max is 12,521 points per frame
const INITIAL_PREVIEW_FRAME = 41; // Guaranteed within chunk_v2_00.bin (42 frames)

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

interface ParserState {
  buffer: ArrayBuffer | null;
  dataview: DataView | null;
  floatData: Float32Array | null;
  isQuantized: boolean;
  totalFrames: number;
  nextByteOffset: number;
  lastParsedBytes: number;
  frames: FrameData[];
}

function advanceFrameParser(state: ParserState, effectiveLoadedBytes: number): void {
  if (!state.dataview || effectiveLoadedBytes <= state.lastParsedBytes) return;

  const dataview = state.dataview;
  const frames = state.frames;
  const totalFrames = state.totalFrames;
  let byteOffset = state.nextByteOffset;

  if (state.isQuantized) {
    while (frames.length < totalFrames) {
      if (byteOffset + 28 > effectiveLoadedBytes) break;

      const numPoints = dataview.getUint32(byteOffset, true);
      if (numPoints === 0 || numPoints > MAX_POINTS * 2) break;

      const frameSize = 28 + numPoints * 8;
      if (byteOffset + frameSize > effectiveLoadedBytes) break;

      const hOffset = byteOffset + 4;
      const frameMinX = dataview.getFloat32(hOffset, true);
      const frameMaxX = dataview.getFloat32(hOffset + 4, true);
      const frameMinY = dataview.getFloat32(hOffset + 8, true);
      const frameMaxY = dataview.getFloat32(hOffset + 12, true);
      const frameMinZ = dataview.getFloat32(hOffset + 16, true);
      const frameMaxZ = dataview.getFloat32(hOffset + 20, true);

      frames.push({
        numPoints,
        byteOffset: byteOffset + 28,
        frameMinX,
        rangeX: frameMaxX - frameMinX || 1,
        frameMinY,
        rangeY: frameMaxY - frameMinY || 1,
        frameMinZ,
        rangeZ: frameMaxZ - frameMinZ || 1,
      });
      byteOffset += frameSize;
    }
  } else {
    while (frames.length < totalFrames) {
      if (byteOffset + 4 > effectiveLoadedBytes) break;
      const numPoints = dataview.getUint32(byteOffset, true);
      if (numPoints === 0 || numPoints > MAX_POINTS * 2) break;

      const frameSize = 4 + numPoints * 16;
      if (byteOffset + frameSize > effectiveLoadedBytes) break;

      frames.push({
        numPoints,
        byteOffset: byteOffset + 4,
        floatOffset: (byteOffset + 4) / 4,
      });
      byteOffset += frameSize;
    }
  }

  state.nextByteOffset = byteOffset;
  state.lastParsedBytes = effectiveLoadedBytes;
}

export function PointCloudViewer({ 
  audioRef,
  isPlaying,
  dataBuffer,
  loadedBytes,
  loadedBytesRef,
  colors,
  frameDataRef
}: { 
  audioRef: React.RefObject<HTMLAudioElement | null>,
  isPlaying: boolean,
  dataBuffer: ArrayBuffer,
  loadedBytes?: number,
  loadedBytesRef?: React.RefObject<number>,
  colors: { colorA: string, colorB: string, colorC: string },
  frameDataRef?: React.MutableRefObject<{ positions: Float32Array; intensities: Float32Array; numPoints: number; frameIndex: number } | null>
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const geomRef = useRef<THREE.BufferGeometry>(null);

  // Incremental frame header parser state (parses each frame exactly once across chunks)
  const parserState = useMemo<ParserState>(() => {
    if (!dataBuffer || dataBuffer.byteLength < 8) {
      return {
        buffer: null,
        dataview: null,
        floatData: null,
        isQuantized: false,
        totalFrames: 0,
        nextByteOffset: 0,
        lastParsedBytes: 0,
        frames: [],
      };
    }

    const dataview = new DataView(dataBuffer);
    const magicView = new Uint8Array(dataBuffer, 0, 4);
    const isQuant =
      magicView[0] === 0x48 &&
      magicView[1] === 0x4f &&
      magicView[2] === 0x43 &&
      magicView[3] === 0x51; // 'HOCQ'

    const totalFrames = isQuant ? dataview.getUint32(4, true) : dataview.getUint32(0, true);
    return {
      buffer: dataBuffer,
      dataview,
      floatData: isQuant ? null : new Float32Array(dataBuffer),
      isQuantized: isQuant,
      totalFrames,
      nextByteOffset: isQuant ? 8 : 4,
      lastParsedBytes: 0,
      frames: [],
    };
  }, [dataBuffer]);

  // Static initial buffers for geometry attributes
  const initialPositions = useMemo(() => new Float32Array(MAX_POINTS * 3), []);
  const initialIntensities = useMemo(() => new Float32Array(MAX_POINTS * 1), []);

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
    if (!audioRef.current || !dataBuffer || !geomRef.current) return;

    const currentLoaded = loadedBytesRef?.current ?? loadedBytes ?? dataBuffer.byteLength;
    if (currentLoaded > parserState.lastParsedBytes) {
      advanceFrameParser(parserState, currentLoaded);
    }

    const { frames, floatData, isQuantized } = parserState;
    if (frames.length === 0) return;

    let targetFrame: number;
    if (!isPlaying && audioRef.current.currentTime === 0) {
      targetFrame = Math.min(INITIAL_PREVIEW_FRAME, frames.length - 1);
    } else {
      targetFrame = Math.floor(audioRef.current.currentTime * FPS);
      if (targetFrame >= frames.length) {
        targetFrame = frames.length - 1;
      } else if (targetFrame < 0) {
        targetFrame = 0;
      }
    }

    if (targetFrame !== currentFrameRef.current) {
      const frame = frames[targetFrame];
      if (!frame) return;

      const numPoints = frame.numPoints;
      const pointsToProcess = Math.min(numPoints, MAX_POINTS);

      const posAttr = geomRef.current.attributes.position as THREE.BufferAttribute | undefined;
      const intAttr = geomRef.current.attributes.intensity as THREE.BufferAttribute | undefined;
      if (!posAttr || !intAttr) return;

      const positions = posAttr.array as Float32Array;
      const intensities = intAttr.array as Float32Array;

      if (isQuantized && frame.frameMinX !== undefined && u16View && u8View) {
        const frameMinX = frame.frameMinX;
        const frameMinY = frame.frameMinY!;
        const frameMinZ = frame.frameMinZ!;
        const scaleX = frame.rangeX! / 65535;
        const scaleY = frame.rangeY! / 65535;
        const scaleZ = frame.rangeZ! / 65535;

        let pOffset = frame.byteOffset + 6;
        let u16Idx = frame.byteOffset >> 1;
        let outIdx = 0;

        for (let i = 0; i < pointsToProcess; i++) {
          positions[outIdx] = frameMinX + u16View[u16Idx] * scaleX;
          positions[outIdx + 1] = frameMinY + u16View[u16Idx + 1] * scaleY;
          positions[outIdx + 2] = frameMinZ + u16View[u16Idx + 2] * scaleZ;
          intensities[i] = u8View[pOffset];

          u16Idx += 4;
          pOffset += 8;
          outIdx += 3;
        }
      } else if (floatData && frame.floatOffset !== undefined) {
        let floatIdx = frame.floatOffset;
        let outIdx = 0;
        for (let i = 0; i < pointsToProcess; i++) {
          positions[outIdx] = floatData[floatIdx];
          positions[outIdx + 1] = floatData[floatIdx + 1];
          positions[outIdx + 2] = floatData[floatIdx + 2];
          intensities[i] = floatData[floatIdx + 3];

          floatIdx += 4;
          outIdx += 3;
        }
      }

      posAttr.clearUpdateRanges();
      posAttr.addUpdateRange(0, pointsToProcess * 3);
      posAttr.needsUpdate = true;

      intAttr.clearUpdateRanges();
      intAttr.addUpdateRange(0, pointsToProcess);
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

  if (parserState.totalFrames === 0) return null;

  return (
    <points ref={pointsRef} rotation={[0, 0, Math.PI]} position={[80, 150, 0]}>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute 
          attach="attributes-position"
          args={[initialPositions, 3]}
          usage={THREE.DynamicDrawUsage}
        />
        <bufferAttribute 
          attach="attributes-intensity"
          args={[initialIntensities, 1]}
          usage={THREE.DynamicDrawUsage}
        />
      </bufferGeometry>
      <primitive object={shaderMaterial} attach="material" />
    </points>
  );
}
