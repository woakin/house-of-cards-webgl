import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { ChromaticAberration } from '@react-three/postprocessing';
import * as THREE from 'three';

export function AnimatedGlitch() {
  const offsetRef = useRef(new THREE.Vector2(0.004, 0.004));

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    // Subtle rhythmic cybernetic glitch pulse
    const glitchX = 0.003 + Math.sin(t * 12.0) * 0.002 + (Math.random() > 0.95 ? 0.008 : 0.0);
    const glitchY = 0.003 + Math.cos(t * 8.0) * 0.002;
    offsetRef.current.set(glitchX, glitchY);
  });

  const initialOffset = useMemo(() => new THREE.Vector2(0.004, 0.004), []);

  return (
    <ChromaticAberration 
      ref={undefined}
      offset={offsetRef.current || initialOffset} 
      radialModulation={false}
      modulationOffset={0}
    />
  );
}
