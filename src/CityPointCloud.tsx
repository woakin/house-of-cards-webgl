import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface CityPointCloudProps {
  colors: { colorA: string; colorB: string; colorC: string };
}

const CITY_POINTS = 25000;

export function CityPointCloud({ colors }: CityPointCloudProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const geomRef = useRef<THREE.BufferGeometry>(null);

  const [positions, intensities] = useMemo(() => {
    const pos = new Float32Array(CITY_POINTS * 3);
    const intens = new Float32Array(CITY_POINTS * 1);

    let idx = 0;
    // Generate Skyscrapers Grid
    const numBuildings = 36;
    const pointsPerBuilding = Math.floor(18000 / numBuildings);

    for (let b = 0; b < numBuildings; b++) {
      const gridX = (b % 6) - 2.5;
      const gridZ = Math.floor(b / 6) - 2.5;
      const centerX = gridX * 120 + (Math.random() - 0.5) * 30;
      const centerZ = gridZ * 120 + (Math.random() - 0.5) * 30;
      const height = 150 + Math.random() * 300;
      const width = 30 + Math.random() * 25;

      for (let p = 0; p < pointsPerBuilding; p++) {
        if (idx >= CITY_POINTS) break;
        const hFraction = Math.random();
        const y = hFraction * height - 100;
        
        // Wall points vs inner points
        const angle = Math.random() * Math.PI * 2;
        const rad = (Math.random() > 0.3 ? 1.0 : Math.random()) * width;
        const x = centerX + Math.cos(angle) * rad;
        const z = centerZ + Math.sin(angle) * rad;

        pos[idx * 3] = x;
        pos[idx * 3 + 1] = y;
        pos[idx * 3 + 2] = z;

        intens[idx] = Math.random() * 35 + 5;
        idx++;
      }
    }

    // Generate Ground Grid & Velodyne LiDAR Ring Waves
    const remaining = CITY_POINTS - idx;
    for (let i = 0; i < remaining; i++) {
      const radius = 100 + Math.random() * 500;
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = -100 + (Math.random() - 0.5) * 10;

      pos[idx * 3] = x;
      pos[idx * 3 + 1] = y;
      pos[idx * 3 + 2] = z;

      intens[idx] = Math.random() * 25 + 5;
      idx++;
    }

    return [pos, intens];
  }, []);

  const shaderMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      colorA: { value: new THREE.Color(colors.colorA) },
      colorB: { value: new THREE.Color(colors.colorB) },
      colorC: { value: new THREE.Color(colors.colorC) },
      pointSize: { value: 2.0 },
    },
    vertexShader: `
      attribute float intensity;
      varying float vIntensity;
      varying float vY;
      uniform float pointSize;
      
      void main() {
        vIntensity = intensity;
        vY = position.y;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = pointSize * (120.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 colorA;
      uniform vec3 colorB;
      uniform vec3 colorC;
      varying float vIntensity;
      varying float vY;
      
      void main() {
        vec2 xy = gl_PointCoord.xy - vec2(0.5);
        float ll = length(xy);
        if (ll > 0.5) discard;
        
        float t = clamp((vY + 100.0) / 300.0, 0.0, 1.0);
        vec3 mixColor = (t < 0.5) ? mix(colorA, colorB, t * 2.0) : mix(colorB, colorC, (t - 0.5) * 2.0);
        
        float normalizedInt = clamp(vIntensity / 40.0, 0.0, 1.0);
        float alpha = (0.5 - ll) * 2.5;
        gl_FragColor = vec4(mixColor * (normalizedInt * 0.8 + 0.5), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  useEffect(() => {
    return () => {
      shaderMaterial.dispose();
      if (geomRef.current) {
        geomRef.current.dispose();
      }
    };
  }, [shaderMaterial]);

  useFrame((_state, delta) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * 0.05;
    }

    shaderMaterial.uniforms.colorA.value.set(colors.colorA);
    shaderMaterial.uniforms.colorB.value.set(colors.colorB);
    shaderMaterial.uniforms.colorC.value.set(colors.colorC);
  });

  return (
    <points ref={pointsRef} position={[0, 0, 0]}>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-intensity" args={[intensities, 1]} />
      </bufferGeometry>
      <primitive object={shaderMaterial} attach="material" />
    </points>
  );
}
