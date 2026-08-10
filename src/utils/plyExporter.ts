import * as THREE from 'three';

interface ExportOptions {
  positions: Float32Array;
  intensities: Float32Array;
  numPoints: number;
  colors: { colorA: string; colorB: string; colorC: string };
  frameIndex?: number;
}

export function exportToPLY({ positions, intensities, numPoints, colors, frameIndex = 1 }: ExportOptions): void {
  if (!positions || numPoints <= 0) {
    console.warn('No point cloud data available for PLY export');
    return;
  }

  const colA = new THREE.Color(colors.colorA);
  const colB = new THREE.Color(colors.colorB);
  const colC = new THREE.Color(colors.colorC);

  const header = [
    'ply',
    'format ascii 1.0',
    `comment Radiohead House of Cards WebGL Point Cloud - Frame ${frameIndex}`,
    `element vertex ${numPoints}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'end_header',
  ].join('\n');

  const lines: string[] = [header];
  const mixColor = new THREE.Color();

  for (let i = 0; i < numPoints; i++) {
    const x = positions[i * 3].toFixed(4);
    const y = positions[i * 3 + 1].toFixed(4);
    const z = positions[i * 3 + 2].toFixed(4);
    const rawZ = positions[i * 3 + 2];
    const intensity = intensities[i] || 0;
    const normalizedInt = Math.min(1.0, Math.max(0.0, intensity / 40.0));

    // Depth-based color mapping matching shader
    const t = Math.min(1.0, Math.max(0.0, (rawZ + 250.0) / 200.0));
    if (t < 0.5) {
      mixColor.copy(colA).lerp(colB, t * 2.0);
    } else {
      mixColor.copy(colB).lerp(colC, (t - 0.5) * 2.0);
    }

    const brightness = normalizedInt * 0.8 + 0.5;
    const r = Math.min(255, Math.max(0, Math.round(mixColor.r * brightness * 255)));
    const g = Math.min(255, Math.max(0, Math.round(mixColor.g * brightness * 255)));
    const b = Math.min(255, Math.max(0, Math.round(mixColor.b * brightness * 255)));

    lines.push(`${x} ${y} ${z} ${r} ${g} ${b}`);
  }

  const plyContent = lines.join('\n');
  const blob = new Blob([plyContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `HouseOfCards_Frame_${String(frameIndex).padStart(4, '0')}.ply`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
