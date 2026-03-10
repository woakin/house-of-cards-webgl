# House of Cards 3D WebGL Viewer

An interactive, real-time 3D WebGL point cloud visualization of Radiohead's "House of Cards" music video data. Built with React Three Fiber, Vite, and custom shaders.

![House of Cards Preview](./public/vite.svg) *Replace with a real screenshot*

## Overview

This project renders the raw LiDAR data captured during the filming of Radiohead's "House of Cards" music video. Because the raw dataset is over 400MB in its full, uncompressed form, it is highly recommended to run this project locally to experience the visualizer at maximum fidelity (60 FPS, millions of points) without bandwidth constraints.

## Features
- **High-Performance WebGL Shader:** Custom vertex and fragment shaders capable of rendering ~2.5 million points dynamically.
- **Audio Synchronization:** The 3D playback is strictly synchronized to the music track.
- **Depth-Based Color Grading:** Points are dynamically colored based on their Z-depth relative to the camera.
- **Interactive UI:** Features a "Randomize Vibe" button for instant color palette swaps and idle UI fade-outs for an immersive experience.
- **Snap & Share:** Take high-resolution screenshots of the point cloud natively from the browser canvas.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer recommended)
- Git

## Installation & Setup

Because the raw Lidar data is massive, it is **not** included in this repository. You must download the CSV files separately and compile them into the optimized binary format using the provided script.

### 1. Clone the repository
\`\`\`bash
git clone https://github.com/YOUR_USERNAME/house-of-cards-webgl.git
cd house-of-cards-webgl
npm install
\`\`\`

### 2. Download the Raw Data
1. Download the open-source "House of Cards" CSV dataset (originally released by Google DataArts).
2. You should have a folder containing files named `1.csv` through `2101.csv`.
3. Place all these `.csv` files inside a new folder named `data` at the root of the project:
   \`\`\`text
   house-of-cards-webgl/
   ├── data/
   │   ├── 1.csv
   │   ├── 2.csv
   │   └── ...
   ├── public/
   ├── scripts/
   ├── src/
   ...
   \`\`\`

### 3. Convert Data to Binary
We use a custom Node.js script to parse the thousands of CSV files and pack them into a single, highly-optimized `Float32` binary buffer (`frames.bin`).

Run the conversion script:
\`\`\`bash
node scripts/convert.js
\`\`\`
*This process may take a minute. It will output `public/data/frames.bin` (~390MB).*

### 4. Run the Development Server
Once the binary file is generated, you can start the local Vite server:
\`\`\`bash
npm run dev
\`\`\`
Open [http://localhost:3000](http://localhost:3000) in your browser to experience the visualization!

## Controls
- **Left Click & Drag:** Orbit camera
- **Right Click & Drag:** Pan camera
- **Scroll Wheel:** Zoom in/out
- **Spacebar:** Play / Pause Audio
- **R:** Reset camera view

## License
Code is provided as-is. The original LiDAR data and audio track belong to Radiohead / DataArts.
